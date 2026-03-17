"""Tests for the phase_handlers module."""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from lectern.phase_handlers import (
    ConceptPhaseResult,
    ExportPhaseResult,
    ConceptPhaseHandler,
    ExportPhaseHandler,
)


class TestConceptPhaseResult:
    """Tests for ConceptPhaseResult dataclass."""

    def test_default_values(self):
        """Test default values are set correctly."""
        result = ConceptPhaseResult(
            success=True,
            concept_map={"page_count": 10},
            slide_set_name="Test Slides",
            pages=[{} for _ in range(10)],
            total_text_chars=8000,
            uploaded_pdf={"uri": "test-uri"},
        )
        assert result.success is True
        assert result.concept_map["page_count"] == 10
        assert result.ai is None

    def test_with_ai_client(self):
        """Test result with AI client."""
        mock_ai = AsyncMock()
        result = ConceptPhaseResult(
            success=True,
            concept_map={},
            slide_set_name="Test",
            pages=[],
            total_text_chars=0,
            uploaded_pdf={},
            ai=mock_ai,
        )
        assert result.ai is mock_ai


class TestExportPhaseResult:
    """Tests for ExportPhaseResult dataclass."""

    def test_result_values(self):
        """Test result values are set correctly."""
        result = ExportPhaseResult(
            success=True,
            created=10,
            failed=2,
            total=12,
        )
        assert result.success is True
        assert result.created == 10
        assert result.failed == 2
        assert result.total == 12


class TestConceptPhaseHandler:
    """Tests for ConceptPhaseHandler."""

    def test_handler_initialization(self):
        """Test handler is initialized correctly."""
        handler = ConceptPhaseHandler(
            pdf_path="/test/file.pdf",
            deck_name="Test Deck",
            model_name="Basic",
            focus_prompt="Focus on X",
        )
        assert handler.pdf_path == "/test/file.pdf"
        assert handler.deck_name == "Test Deck"
        assert handler.model_name == "Basic"
        assert handler.focus_prompt == "Focus on X"

    @pytest.mark.asyncio
    @patch("lectern.phase_handlers.LecternAIClient")
    @patch("lectern.phase_handlers.sample_examples_from_deck")
    async def test_run_returns_failure_on_upload_error(
        self, mock_sample, mock_ai_class
    ):
        """Test run returns failure when PDF upload fails."""
        mock_ai = AsyncMock()
        mock_ai.upload_pdf.side_effect = Exception("Upload failed")
        mock_ai_class.return_value = mock_ai
        mock_sample.return_value = ""

        handler = ConceptPhaseHandler(
            pdf_path="/test/file.pdf",
            deck_name="Test Deck",
            model_name="Basic",
        )

        events = []
        result = None
        async for item in handler.run(file_size=100000, context_deck=""):
            if isinstance(item, ConceptPhaseResult):
                result = item
            else:
                events.append(item)

        # Should have failure events
        assert any(e["type"] == "error" for e in events)
        # In case of upload failure, it returns early and might not yield ConceptPhaseResult
        # Actually in ConceptPhaseHandler.run, if upload fails, it returns.
        assert result is None or result.success is False


class TestExportPhaseHandler:
    """Tests for ExportPhaseHandler."""

    def test_handler_initialization(self):
        """Test handler is initialized correctly."""
        handler = ExportPhaseHandler(
            deck_name="Test Deck",
            slide_set_name="Test Slides",
            additional_tags=["tag1", "tag2"],
        )
        assert handler.deck_name == "Test Deck"
        assert handler.slide_set_name == "Test Slides"
        assert handler.additional_tags == ["tag1", "tag2"]

    @pytest.mark.asyncio
    @patch("lectern.phase_handlers.export_card_to_anki")
    async def test_run_exports_cards_successfully(self, mock_export):
        """Test successful card export."""
        mock_export.return_value = MagicMock(success=True, note_id=123)

        handler = ExportPhaseHandler(
            deck_name="Test Deck",
            slide_set_name="Test Slides",
            additional_tags=[],
        )

        cards = [{"front": "Q1", "back": "A1"}, {"front": "Q2", "back": "A2"}]

        events = []
        result = None
        async for item in handler.run(cards):
            if isinstance(item, ExportPhaseResult):
                result = item
            else:
                events.append(item)

        assert result is not None
        assert result.success is True
        assert result.created == 2
        assert result.failed == 0
        assert result.total == 2
        assert mock_export.call_count == 2

    @pytest.mark.asyncio
    @patch("lectern.phase_handlers.export_card_to_anki")
    async def test_run_handles_failures(self, mock_export):
        """Test handling of export failures."""
        # First succeeds, second fails
        mock_export.side_effect = [
            MagicMock(success=True, note_id=123),
            MagicMock(success=False, error="Duplicate note"),
        ]

        handler = ExportPhaseHandler(
            deck_name="Test Deck",
            slide_set_name="Test Slides",
            additional_tags=[],
        )

        cards = [{"front": "Q1", "back": "A1"}, {"front": "Q2", "back": "A2"}]

        events = []
        result = None
        async for item in handler.run(cards):
            if isinstance(item, ExportPhaseResult):
                result = item
            else:
                events.append(item)

        assert result is not None
        assert result.success is True
        assert result.created == 1
        assert result.failed == 1
        assert result.total == 2

    @pytest.mark.asyncio
    @patch("lectern.phase_handlers.export_card_to_anki")
    async def test_run_emits_progress_events(self, mock_export):
        """Test that progress events are emitted."""
        mock_export.return_value = MagicMock(success=True, note_id=123)

        handler = ExportPhaseHandler(
            deck_name="Test Deck",
            slide_set_name="Test Slides",
            additional_tags=[],
        )

        cards = [{"front": "Q1", "back": "A1"}]

        events = []
        async for item in handler.run(cards):
            if not isinstance(item, ExportPhaseResult):
                events.append(item)

        # Should have step_start, progress_start, note, progress_update, step_end
        event_types = [e["type"] for e in events]
        assert "step_start" in event_types
        assert "progress_start" in event_types
        assert "note" in event_types
        assert "progress_update" in event_types
        assert "step_end" in event_types
