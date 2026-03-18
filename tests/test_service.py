"""
Unit tests for LecternGenerationService.

Tests the core orchestration logic including:
- Validation and setup
- Event emission
- Stop check handling
- Card deduplication
"""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from lectern.ai_client import UploadedDocument
from lectern.lectern_service import LecternGenerationService, ServiceEvent


# --- Fixtures ---


@pytest.fixture
def service():
    """Create a fresh service instance."""
    return LecternGenerationService()


@pytest.fixture(autouse=True)
def mock_extract_pdf_metadata():
    """Mock extract_pdf_metadata globally for service tests (used by InitializationPhase)."""
    with patch("lectern.orchestration.phases.extract_pdf_metadata") as mock:
        mock.return_value = {
            "page_count": 3,
            "text_chars": 1200,
            "image_count": 0,
        }
        yield mock


@pytest.fixture
def mock_history_manager():
    """Prevent test pollution: mock HistoryManager for all service tests."""
    with patch("lectern.lectern_service.HistoryManager") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.add_entry.return_value = "test-entry-id"
        mock_cls.return_value = mock_instance
        yield mock_cls


@pytest.fixture
def mock_pdf_pages():
    """Mock PageContent objects."""

    class MockPage:
        def __init__(self, page_num: int, text: str):
            self.page_number = page_num
            self.text = text
            self.images = []

        def __dict__(self):
            return {
                "page_number": self.page_number,
                "text": self.text,
                "images": self.images,
            }

    return [
        MockPage(1, "Introduction to Machine Learning"),
        MockPage(2, "Supervised vs Unsupervised Learning"),
        MockPage(3, "Neural Networks Basics"),
    ]


@pytest.fixture
def generation_env(mock_pdf_pages):
    """Common patched environment for service integration tests."""
    anki_connected = {
        "connected": True,
        "version_ok": True,
        "collection_available": True,
    }

    with patch(
        "lectern.orchestration.phases.get_connection_info",
        new_callable=AsyncMock,
        return_value=anki_connected,
    ) as mock_info, patch(
        "lectern.orchestration.phases.sample_examples_from_deck",
        new_callable=AsyncMock,
        return_value="",
    ) as mock_examples, patch(
        "lectern.providers.gemini_provider.LecternAIClient"
    ) as mock_ai_class, patch(
        "lectern.orchestration.phases.os.path.exists", return_value=True
    ), patch(
        "lectern.orchestration.phases.os.path.getsize", return_value=1024
    ):

        mock_ai = MagicMock()
        mock_ai.log_path = "/tmp/test.log"
        mock_ai.concept_map = AsyncMock(return_value={"concepts": [], "relations": []})
        mock_ai.concept_map_from_file = AsyncMock(
            return_value={
                "concepts": [],
                "relations": [],
                "page_count": 3,
                "estimated_text_chars": 1200,
                "slide_set_name": "Test Lecture",
            }
        )
        mock_ai.upload_pdf = AsyncMock(
            return_value={
                "uri": "gs://fake.pdf",
                "mime_type": "application/pdf",
            }
        )
        mock_ai.upload_document = AsyncMock(
            return_value=UploadedDocument(
                uri="gs://fake.pdf", mime_type="application/pdf", duration_ms=100
            )
        )
        mock_ai.generate_more_cards = AsyncMock(
            return_value={"cards": [], "done": True}
        )
        mock_ai.get_history = AsyncMock(return_value=[])
        mock_ai.reflect = AsyncMock(return_value={"cards": []})
        mock_ai.drain_warnings = MagicMock(return_value=[])
        mock_ai_class.return_value = mock_ai

        yield {
            "ai": mock_ai,
            "ai_class": mock_ai_class,
            "check": mock_info,
            "examples": mock_examples,
        }


# --- Tests for ServiceEvent ---


class TestServiceEvent:
    def test_service_event_creation(self):
        """Test ServiceEvent dataclass creation."""
        event = ServiceEvent(type="info", message="Test message")
        assert event.type == "info"
        assert event.message == "Test message"
        assert event.data == {}


# --- Tests for run() validation ---


class TestServiceValidation:
    @pytest.mark.asyncio
    async def test_run_with_nonexistent_pdf(self, service):
        """Test that service yields error for missing PDF."""
        with patch("lectern.orchestration.phases.os.path.exists", return_value=False):
            events = []
            async for event in service.run(
                pdf_path="/nonexistent/path.pdf",
                deck_name="Test Deck",
                model_name="gemini-3-flash-preview",
                tags=[],
            ):
                events.append(event)

            error_events = [e for e in events if e.type == "error"]
            assert len(error_events) == 1
            assert "not found" in error_events[0].message.lower()

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("os.path.exists", return_value=True)
    @patch("os.path.getsize", return_value=1024)
    async def test_run_with_anki_disconnected(
        self, mock_getsize, mock_exists, mock_info, service
    ):
        """Test that service yields error when AnkiConnect is down."""
        mock_info.return_value = {"connected": False, "error": "Connection refused"}

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
        ):
            events.append(event)

        error_events = [e for e in events if e.type == "error"]
        assert len(error_events) >= 1
        assert "could not use ankiconnect" in error_events[0].message.lower()


# --- Tests for stop_check ---


class TestStopCheck:
    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_stop_check_aborts_early(
        self, mock_getsize, mock_exists, mock_ai_client_class, mock_info, service
    ):
        """Test that stop_check callback halts generation."""
        mock_info.return_value = {"connected": True, "collection_available": True}

        # Mock AI to prevent crashes if it gets far
        mock_ai = MagicMock()
        mock_ai.upload_document = AsyncMock(return_value=MagicMock(uri="gs://mock"))
        mock_ai.drain_warnings = MagicMock(return_value=[])
        mock_ai_client_class.return_value = mock_ai

        stop_flag = True  # Stop immediately

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            stop_check=lambda: stop_flag,
        ):
            events.append(event)
            if len(events) > 20:
                break

        assert any(e.type == "cancelled" for e in events) or any(
            "stopped" in e.message.lower() for e in events
        )


# --- Integration-style tests ---


class TestServiceIntegration:
    @pytest.mark.asyncio
    async def test_full_flow_emits_expected_events(self, service, generation_env):
        """Test that a full run emits the expected event sequence."""
        env = generation_env
        env["ai"].generate_more_cards.return_value = {
            "cards": [
                {
                    "fields": {"Front": "Q1", "Back": "A1"},
                    "slide_number": 1,
                    "slide_topic": "Topic",
                },
            ],
            "done": True,
        }

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
        ):
            events.append(event)

        event_types = [e.type for e in events if e.type != "control_snapshot"]
        assert "step_start" in event_types
        assert "step_end" in event_types
        assert any(e.type == "card" for e in events)
        assert any(e.type == "done" for e in events)

    @pytest.mark.asyncio
    @patch(
        "lectern.orchestration.phases.ConceptMappingPhase.execute",
        new_callable=AsyncMock,
    )
    @patch(
        "lectern.orchestration.phases.InitializationPhase.execute",
        new_callable=AsyncMock,
    )
    async def test_run_executes_initialization_then_concept_phase(
        self,
        mock_init_execute,
        mock_concept_execute,
        service,
        generation_env,
    ):
        env = generation_env
        env["ai"].generate_more_cards.return_value = {
            "cards": [{"fields": {"Front": "Q1", "Back": "A1"}}],
            "done": True,
        }

        call_order: list[str] = []

        async def _init_side_effect(context, emitter, ai_client):
            call_order.append("init")
            context.pdf.page_count = 3
            context.pdf.text_chars = 1200
            context.pdf.image_count = 0

        async def _concept_side_effect(context, emitter, ai_client):
            call_order.append("concept")
            context.pages = [{}, {}, {}]
            context.concept_map = {"concepts": [], "relations": []}
            context.slide_set_name = "Test Lecture"
            context.pdf.metadata_pages = 3
            context.pdf.metadata_chars = 1200

        mock_init_execute.side_effect = _init_side_effect
        mock_concept_execute.side_effect = _concept_side_effect

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
        ):
            events.append(event)

        assert call_order == ["init", "concept"]
        assert mock_init_execute.await_count == 1
        assert mock_concept_execute.await_count == 1
        assert any(e.type == "done" for e in events)

    @pytest.mark.asyncio
    async def test_focus_prompt_passed_to_ai_client(self, service, generation_env):
        """Test that focus_prompt is correctly passed to LecternAIClient."""
        env = generation_env

        async for _ in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
            focus_prompt="Focus on key terms",
        ):
            pass

        env["ai_class"].assert_called()
        _, kwargs = env["ai_class"].call_args
        assert kwargs.get("focus_prompt") == "Focus on key terms"

    @pytest.mark.asyncio
    async def test_generation_requires_canonical_card_shape(
        self, service, generation_env
    ):
        """Generation fails fast when AI does not return canonical keys."""
        env = generation_env
        env["ai"].generate_more_cards.side_effect = RuntimeError(
            "AI response could not be parsed into canonical card schema."
        )

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
        ):
            events.append(event)

        assert any(
            e.type == "error" and "canonical card schema" in e.message.lower()
            for e in events
        )

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("os.path.exists", return_value=True)
    @patch("os.path.getsize", return_value=1024)
    async def test_stop_check_during_generation(
        self,
        mock_getsize,
        mock_exists,
        mock_ai_client_class,
        mock_info,
        service,
    ):
        """Test stop_check during the generation loop."""
        mock_info.return_value = {"connected": True, "collection_available": True}

        mock_ai = MagicMock()
        mock_ai.upload_document = AsyncMock(
            return_value=MagicMock(
                uri="gs://mock", mime_type="application/pdf", duration_ms=100
            )
        )
        mock_ai.concept_map_from_file = AsyncMock(return_value={})
        mock_ai.generate_more_cards = AsyncMock(
            return_value={"cards": [{"fields": {"Front": "Q1"}}]}
        )
        mock_ai.drain_warnings = MagicMock(return_value=[])
        mock_ai_client_class.return_value = mock_ai

        stop_flag = False

        def stop_check():
            return stop_flag

        events = []
        async for e in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini",
            tags=[],
            stop_check=stop_check,
            skip_export=True,
        ):
            events.append(e)
            if e.type == "progress_start":
                stop_flag = True

        assert stop_flag
        assert any(e.type == "cancelled" for e in events) or any(
            "stopped" in e.message.lower() for e in events
        )

    @pytest.mark.asyncio
    @patch("lectern.cost_estimator.extract_pdf_metadata")
    @patch("lectern.cost_estimator._compose_multimodal_content")
    @patch("lectern.cost_estimator.LecternAIClient")
    @patch("os.path.exists", return_value=True)
    async def test_estimate_cost(
        self,
        mock_exists,
        mock_ai_client_class,
        mock_compose,
        mock_extract_metadata,
        service,
    ):
        """Test the estimate_cost async method."""
        mock_extract_metadata.return_value = {
            "page_count": 1,
            "text_chars": 600,
            "image_count": 0,
        }
        mock_ai = MagicMock()
        mock_ai.upload_pdf = AsyncMock(
            return_value={
                "uri": "gs://fake.pdf",
                "mime_type": "application/pdf",
            }
        )
        mock_ai.count_tokens_for_pdf = AsyncMock(return_value=100)
        mock_ai_client_class.return_value = mock_ai

        result = await service.estimate_cost(
            "/fake/path.pdf", model_name="gemini-3-flash"
        )

        assert "tokens" in result
        assert result["pages"] == 1
        assert result["estimated_card_count"] == 3

    @pytest.mark.asyncio
    @patch("lectern.cost_estimator._compose_multimodal_content")
    @patch("lectern.cost_estimator.LecternAIClient")
    async def test_verify_image_token_cost(
        self,
        mock_ai_client_class,
        mock_compose,
        service,
    ):
        """Test image token verification via token-delta method."""
        mock_compose.side_effect = [
            [{"role": "user", "parts": [{"text": "t"}]}],
            [{"role": "user", "parts": [{"text": "t+img"}]}],
        ]
        mock_ai = MagicMock()
        mock_ai.count_tokens = AsyncMock(side_effect=[100, 358])
        mock_ai_client_class.return_value = mock_ai

        result = await service.verify_image_token_cost(
            model_name="gemini-3-flash-preview"
        )
        assert result["delta_per_image"] == 258

    @pytest.mark.asyncio
    async def test_run_with_empty_pdf_content(self, service, generation_env):
        """Test that service surfaces native upload failures clearly."""
        env = generation_env
        env["ai"].upload_document.side_effect = RuntimeError("Upload failed")

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini",
            tags=[],
        ):
            events.append(event)

        assert any(
            "critical error" in e.message.lower() for e in events if e.type == "error"
        )

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=0)
    async def test_run_with_zero_byte_file(self, mock_getsize, mock_exists, service):
        """Test that service yields error for empty file."""
        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf", deck_name="T", model_name="M", tags=[]
        ):
            events.append(event)

        assert any("empty" in e.message.lower() for e in events if e.type == "error")

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.export_card_to_anki", new_callable=AsyncMock)
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_run_with_export(
        self,
        mock_getsize,
        mock_exists,
        mock_export,
        mock_ai_client_class,
        mock_info_phases,
        service,
    ):
        """Test the full run including Anki export."""
        anki_ok = {"connected": True, "collection_available": True}
        mock_info_phases.return_value = anki_ok

        mock_ai = MagicMock()
        mock_ai.upload_document = AsyncMock(
            return_value=UploadedDocument(
                uri="gs://mock", mime_type="application/pdf", duration_ms=100
            )
        )
        mock_ai.concept_map_from_file = AsyncMock(
            return_value={"slide_set_name": "Test Set"}
        )
        mock_ai.generate_more_cards = AsyncMock(
            return_value={"cards": [{"fields": {"Front": "Q", "Back": "A"}}]}
        )
        mock_ai.get_history = AsyncMock(return_value=[])
        mock_ai.reflect = AsyncMock(return_value={"cards": []})
        mock_ai.drain_warnings = MagicMock(return_value=[])
        mock_ai_client_class.return_value = mock_ai

        mock_export_result = MagicMock()
        mock_export_result.success = True
        mock_export_result.note_id = 12345
        mock_export.return_value = mock_export_result

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini",
            tags=[],
            skip_export=False,
        ):
            events.append(event)

        assert any(e.type == "note" for e in events)
        mock_export.assert_called()

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_pdf_parsing_exception(
        self, mock_getsize, mock_exists, mock_ai_class, mock_info, service
    ):
        """Test handling of exception during native upload."""
        mock_info.return_value = {"connected": True, "collection_available": True}
        mock_ai = mock_ai_class.return_value
        mock_ai.upload_document = AsyncMock(side_effect=RuntimeError("Upload failed"))

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf", deck_name="T", model_name="M", tags=[]
        ):
            events.append(event)

        assert any(
            e.type == "error" and "critical error" in e.message.lower() for e in events
        )

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch(
        "lectern.orchestration.phases.sample_examples_from_deck", new_callable=AsyncMock
    )
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    @patch("lectern.lectern_service.HistoryManager")
    async def test_example_sampling_exception(
        self,
        mock_history_class,
        mock_getsize,
        mock_exists,
        mock_samples,
        mock_info,
        service,
    ):
        """Test that example sampling exception yields warning but continues."""
        mock_info.return_value = {"connected": True, "collection_available": True}
        mock_samples.side_effect = Exception("Anki error")

        with patch(
            "lectern.providers.gemini_provider.LecternAIClient"
        ) as mock_ai_class:
            mock_ai = mock_ai_class.return_value
            mock_ai.upload_document = AsyncMock(
                return_value=MagicMock(uri="gs://mock", duration_ms=100)
            )
            mock_ai.concept_map_from_file = AsyncMock(
                return_value={"slide_set_name": "Test"}
            )
            mock_ai.generate_more_cards = AsyncMock(
                return_value={"cards": [{"fields": {"Front": "Q1"}}]}
            )
            mock_ai.get_history = AsyncMock(return_value=[])
            mock_ai.reflect = AsyncMock(return_value={"cards": []})
            mock_ai.drain_warnings = MagicMock(return_value=[])

            events = []
            async for event in service.run(
                pdf_path="/fake/path.pdf",
                deck_name="T",
                model_name="M",
                tags=[],
                skip_export=True,
            ):
                events.append(event)

        assert any(
            e.type == "info" and "Skipping style example sampling" in e.message
            for e in events
        )
        assert any(e.type == "done" for e in events)

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_script_mode_density_calculation(
        self, mock_getsize, mock_exists, mock_ai_class, mock_info, service
    ):
        """Test that script mode uses text-based density calculation."""
        mock_info.return_value = {"connected": True, "collection_available": True}

        with patch("lectern.orchestration.phases.extract_pdf_metadata") as mock_meta:
            mock_meta.return_value = {
                "page_count": 1,
                "text_chars": 3000,
                "image_count": 0,
            }

            mock_ai = mock_ai_class.return_value
            mock_ai.upload_document = AsyncMock(
                return_value=MagicMock(uri="gs://mock", duration_ms=100)
            )
            mock_ai.concept_map_from_file = AsyncMock(
                return_value={
                    "page_count": 1,
                    "estimated_text_chars": 3000,
                }
            )
            mock_ai.generate_more_cards = AsyncMock(return_value={"cards": []})
            mock_ai.get_history = AsyncMock(return_value=[])
            mock_ai.reflect = AsyncMock(return_value={"cards": []})
            mock_ai.drain_warnings = MagicMock(return_value=[])

            events = []
            async for event in service.run(
                pdf_path="/fake/path.pdf",
                deck_name="T",
                model_name="M",
                tags=[],
                target_card_count=6,
                skip_export=True,
            ):
                events.append(event)

        assert any("Script mode" in e.message for e in events if e.type == "info")

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_reflection_logic_and_stop_check(
        self, mock_getsize, mock_exists, mock_ai_class, mock_info, service
    ):
        """Test reflection loop and stop_check during reflection."""
        mock_info.return_value = {"connected": True, "collection_available": True}
        mock_ai = mock_ai_class.return_value
        mock_ai.upload_document = AsyncMock(
            return_value=MagicMock(uri="gs://mock", duration_ms=100)
        )
        mock_ai.concept_map_from_file = AsyncMock(
            return_value={
                "page_count": 50,
                "estimated_text_chars": 20000,
                "slide_set_name": "Test",
            }
        )
        mock_ai.get_history = AsyncMock(return_value=[])
        mock_ai.generate_more_cards = AsyncMock(
            return_value={"cards": [{"fields": {"Front": f"Q{i}"}} for i in range(30)]}
        )
        mock_ai.reflect = AsyncMock(
            return_value={"cards": [{"fields": {"Front": "Refined"}}]}
        )
        mock_ai.drain_warnings = MagicMock(return_value=[])

        stop_flag = False
        async for e in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="T",
            model_name="M",
            tags=[],
            stop_check=lambda: stop_flag,
            skip_export=True,
        ):
            if e.type == "step_start" and "Reflection" in e.message:
                stop_flag = True

        assert stop_flag

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.export_card_to_anki", new_callable=AsyncMock)
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_export_failure_reporting(
        self,
        mock_getsize,
        mock_exists,
        mock_export,
        mock_ai_class,
        mock_info_phases,
        service,
    ):
        """Test that individual export failures are reported as warnings."""
        anki_ok = {"connected": True, "collection_available": True}
        mock_info_phases.return_value = anki_ok
        mock_ai = mock_ai_class.return_value
        mock_ai.upload_document = AsyncMock(
            return_value=UploadedDocument(
                uri="gs://mock", mime_type="application/pdf", duration_ms=100
            )
        )
        mock_ai.concept_map_from_file = AsyncMock(return_value={})
        mock_ai.generate_more_cards = AsyncMock(
            return_value={"cards": [{"fields": {"Front": "Q"}}]}
        )
        mock_ai.get_history = AsyncMock(return_value=[])
        mock_ai.reflect = AsyncMock(return_value={"cards": []})
        mock_ai.drain_warnings = MagicMock(return_value=[])
        mock_export.return_value = MagicMock(success=False, error="Anki busy")

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="T",
            model_name="M",
            tags=[],
            skip_export=False,
        ):
            events.append(event)

        assert any(
            e.type == "warning" and "Failed to create note" in e.message for e in events
        )

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=5000)
    @patch("lectern.lectern_service.HistoryManager")
    async def test_script_mode_and_entry_id(
        self,
        mock_history_class,
        mock_getsize,
        mock_exists,
        mock_ai_class,
        mock_info,
        service,
    ):
        """Test script mode and providing entry_id."""
        mock_info.return_value = {"connected": True, "collection_available": True}

        with patch("lectern.orchestration.phases.extract_pdf_metadata") as mock_meta:
            mock_meta.return_value = {
                "page_count": 1,
                "text_chars": 5000,
                "image_count": 0,
            }

            mock_ai = mock_ai_class.return_value
            mock_ai.upload_document = AsyncMock(
                return_value=UploadedDocument(
                    uri="gs://mock", mime_type="application/pdf", duration_ms=100
                )
            )
            mock_ai.concept_map_from_file = AsyncMock(
                return_value={"page_count": 1, "estimated_text_chars": 5000}
            )
            mock_ai.generate_more_cards = AsyncMock(
                return_value={"cards": [{"fields": {"Front": "Q"}}]}
            )
            mock_ai.get_history = AsyncMock(return_value=[])
            mock_ai.reflect = AsyncMock(return_value={"cards": []})
            mock_ai.drain_warnings = MagicMock(return_value=[])

            events = []
            async for event in service.run(
                pdf_path="/fake/path.pdf",
                deck_name="T",
                model_name="M",
                tags=[],
                entry_id="existing_id",
                skip_export=True,
            ):
                events.append(event)

        assert any("Script mode" in e.message for e in events)

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.providers.gemini_provider.LecternAIClient")
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_dynamic_reflection_rounds_large_doc(
        self, mock_getsize, mock_exists, mock_ai_class, mock_info, service
    ):
        """Test dynamic reflection rounds for a 100+ page document."""
        mock_info.return_value = {"connected": True, "collection_available": True}

        with patch("lectern.orchestration.phases.extract_pdf_metadata") as mock_meta:
            mock_meta.return_value = {
                "page_count": 110,
                "text_chars": 44000,
                "image_count": 0,
            }

            mock_ai = mock_ai_class.return_value
            mock_ai.upload_document = AsyncMock(
                return_value=MagicMock(uri="gs://mock", duration_ms=100)
            )
            mock_ai.concept_map_from_file = AsyncMock(
                return_value={"page_count": 110, "estimated_text_chars": 44000}
            )
            mock_ai.generate_more_cards = AsyncMock(
                return_value={
                    "cards": [{"fields": {"Front": f"Q{i}"}} for i in range(60)]
                }
            )
            mock_ai.get_history = AsyncMock(return_value=[])
            mock_ai.reflect = AsyncMock(return_value={"cards": []})
            mock_ai.drain_warnings = MagicMock(return_value=[])

            events = []
            async for event in service.run(
                pdf_path="/fake/path.pdf",
                deck_name="T",
                model_name="M",
                tags=[],
                skip_export=True,
            ):
                events.append(event)

        assert any(
            "Reflection Round" in e.message
            for e in events
            if e.type in ("status", "info")
        )

    @pytest.mark.asyncio
    @patch("lectern.cost_estimator.extract_pdf_metadata")
    @patch("lectern.cost_estimator._compose_multimodal_content")
    @patch("lectern.cost_estimator.LecternAIClient")
    async def test_estimate_cost_pricing_matching(
        self, mock_ai_client_class, mock_compose, mock_extract_metadata, service
    ):
        """Test pricing matching for different models in estimate_cost."""
        mock_extract_metadata.return_value = {
            "page_count": 1,
            "text_chars": 600,
            "image_count": 0,
        }
        mock_ai = mock_ai_client_class.return_value
        mock_ai.upload_pdf = AsyncMock(
            return_value={"uri": "gs://fake.pdf", "mime_type": "application/pdf"}
        )
        mock_ai.count_tokens_for_pdf = AsyncMock(return_value=100)

        result = await service.estimate_cost(
            "/fake/path.pdf", model_name="gemini-3-pro"
        )
        assert result["model"] == "gemini-3-pro"

    @pytest.mark.asyncio
    @patch("lectern.cost_estimator.extract_pdf_metadata")
    @patch("lectern.cost_estimator._compose_multimodal_content")
    @patch("lectern.cost_estimator.LecternAIClient")
    async def test_estimate_cost_mode_card_count_behavior(
        self,
        mock_ai_client_class,
        mock_compose,
        mock_extract_metadata,
        service,
    ):
        """Test that estimate_cost card count follows script/slides mode formulas."""
        mock_extract_metadata.return_value = {
            "page_count": 1,
            "text_chars": 600,
            "image_count": 0,
        }
        mock_ai = mock_ai_client_class.return_value
        mock_ai.upload_pdf = AsyncMock(
            return_value={"uri": "gs://fake.pdf", "mime_type": "application/pdf"}
        )
        mock_ai.count_tokens_for_pdf = AsyncMock(return_value=100)

        script_result = await service.estimate_cost(
            "/fake/path.pdf", model_name="gemini-3-flash", target_card_count=8
        )
        assert script_result["estimated_card_count"] == 8

    @pytest.mark.asyncio
    @patch("lectern.orchestration.phases.get_connection_info", new_callable=AsyncMock)
    @patch("lectern.orchestration.phases.os.path.exists", return_value=True)
    @patch("lectern.orchestration.phases.os.path.getsize", return_value=1024)
    async def test_critical_error_graceful_exit(
        self, mock_getsize, mock_exists, mock_info, service
    ):
        """Test that critical exceptions yield error events and exit gracefully."""
        mock_info.side_effect = Exception("System Crash")

        events = []
        async for event in service.run(
            pdf_path="/fake/path.pdf", deck_name="T", model_name="M", tags=[]
        ):
            events.append(event)

        assert any(e.type == "error" and "Critical error" in e.message for e in events)
