
import pytest
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import config
from lectern_service import LecternGenerationService

@pytest.fixture
def service():
    """Create a fresh service instance."""
    return LecternGenerationService()

@pytest.fixture
def mock_pdf_pages_large():
    """Mock PageContent objects for a large PDF."""
    class MockPage:
        def __init__(self, page_num: int, text: str):
            self.page_number = page_num
            self.text = text
            self.images = []

        def __dict__(self):
            return {"page_number": self.page_number, "text": self.text, "images": self.images}

    # Create 100 pages to trigger large deck boost if not in exam mode
    return [MockPage(i, f"Page {i}") for i in range(1, 101)]

class TestExamModeCap:
    @patch('lectern_service.check_connection')
    @patch('lectern_service.sample_examples_from_deck')
    @patch('lectern_service.get_deck_slide_set_patterns')
    @patch('lectern_service.extract_content_from_pdf')
    @patch('lectern_service.extract_pdf_title')
    @patch('lectern_service.infer_slide_set_name_with_ai')
    @patch('lectern_service.LecternAIClient')
    @patch('os.path.exists')
    @patch('os.path.getsize')
    def test_exam_mode_cap_enforced(
        self,
        mock_getsize,
        mock_exists,
        mock_ai_client_class,
        mock_infer_name,
        mock_extract_title,
        mock_extract_pdf,
        mock_patterns,
        mock_examples,
        mock_check,
        service,
        mock_pdf_pages_large
    ):
        """Test that exam mode enforces the safety cap regardless of deck size."""
        # Setup mocks
        mock_exists.return_value = True
        mock_getsize.return_value = 1024
        mock_check.return_value = True
        mock_examples.return_value = ""
        mock_patterns.return_value = {"slide_sets": []}
        mock_extract_pdf.return_value = mock_pdf_pages_large
        mock_extract_title.return_value = "Test Lecture"
        mock_infer_name.return_value = "Lecture 1"

        # Mock AI client
        mock_ai = MagicMock()
        mock_ai.log_path = "/tmp/test.log"
        mock_ai.concept_map.return_value = {}
        # We simulate that it generates enough cards to hit the cap if allowed,
        # but the run method should stop based on the calculated cap.
        # Here we just want to check the "progress_start" event which reveals the cap.
        mock_ai.generate_more_cards.return_value = {
            "cards": [],
            "done": True
        }
        mock_ai.get_history.return_value = []
        mock_ai_client_class.return_value = mock_ai

        # Run with exam_mode=True
        events = list(service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
            enable_reflection=False,
            exam_mode=True
        ))

        # Check for progress_start event
        progress_events = [e for e in events if e.type == "progress_start" and e.data.get("label") == "Generation"]
        assert len(progress_events) == 1

        total_cap = progress_events[0].data["total"]
        expected_cap = int(len(mock_pdf_pages_large) * config.EXAM_MODE_SAFETY_CAP)

        print(f"Exam Mode: Total Cap: {total_cap}, Expected: {expected_cap}")
        assert total_cap == expected_cap

    @patch('lectern_service.check_connection')
    @patch('lectern_service.sample_examples_from_deck')
    @patch('lectern_service.get_deck_slide_set_patterns')
    @patch('lectern_service.extract_content_from_pdf')
    @patch('lectern_service.extract_pdf_title')
    @patch('lectern_service.infer_slide_set_name_with_ai')
    @patch('lectern_service.LecternAIClient')
    @patch('os.path.exists')
    @patch('os.path.getsize')
    def test_normal_mode_large_deck_boost(
        self,
        mock_getsize,
        mock_exists,
        mock_ai_client_class,
        mock_infer_name,
        mock_extract_title,
        mock_extract_pdf,
        mock_patterns,
        mock_examples,
        mock_check,
        service,
        mock_pdf_pages_large
    ):
        """Test that normal mode applies boost for large decks."""
        # Setup mocks
        mock_exists.return_value = True
        mock_getsize.return_value = 1024
        mock_check.return_value = True
        mock_examples.return_value = ""
        mock_patterns.return_value = {"slide_sets": []}
        mock_extract_pdf.return_value = mock_pdf_pages_large
        mock_extract_title.return_value = "Test Lecture"
        mock_infer_name.return_value = "Lecture 1"

        # Mock AI client
        mock_ai = MagicMock()
        mock_ai.log_path = "/tmp/test.log"
        mock_ai.concept_map.return_value = {}
        mock_ai.generate_more_cards.return_value = {
            "cards": [],
            "done": True
        }
        mock_ai.get_history.return_value = []
        mock_ai_client_class.return_value = mock_ai

        # Run with exam_mode=False
        events = list(service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
            enable_reflection=False,
            exam_mode=False
        ))

        # Check for progress_start event
        progress_events = [e for e in events if e.type == "progress_start" and e.data.get("label") == "Generation"]
        assert len(progress_events) == 1

        total_cap = progress_events[0].data["total"]
        # Normal mode with 100 pages should boost target to 2.0
        expected_cap = int(len(mock_pdf_pages_large) * 2.0)

        print(f"Normal Mode: Total Cap: {total_cap}, Expected: {expected_cap}")
        assert total_cap == expected_cap
