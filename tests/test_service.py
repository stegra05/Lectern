"""
Unit tests for LecternGenerationService.

Tests the core orchestration logic including:
- Validation and setup
- Event emission
- Stop check handling
- Card deduplication
"""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from typing import Dict, Any, List

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from lectern_service import LecternGenerationService, ServiceEvent


# --- Fixtures ---

@pytest.fixture
def service():
    """Create a fresh service instance."""
    return LecternGenerationService()


@pytest.fixture
def mock_pdf_pages():
    """Mock PageContent objects."""
    class MockPage:
        def __init__(self, page_num: int, text: str):
            self.page_number = page_num
            self.text = text
            self.images = []
        
        def __dict__(self):
            return {"page_number": self.page_number, "text": self.text, "images": self.images}
    
    return [
        MockPage(1, "Introduction to Machine Learning"),
        MockPage(2, "Supervised vs Unsupervised Learning"),
        MockPage(3, "Neural Networks Basics"),
    ]


# --- Tests for ServiceEvent ---

class TestServiceEvent:
    def test_service_event_creation(self):
        """Test ServiceEvent dataclass creation."""
        event = ServiceEvent(type="info", message="Test message")
        assert event.type == "info"
        assert event.message == "Test message"
        assert event.data == {}
    
    def test_service_event_with_data(self):
        """Test ServiceEvent with data payload."""
        event = ServiceEvent(type="card", message="New card", data={"card": {"Front": "Q"}})
        assert event.data["card"]["Front"] == "Q"


# --- Tests for run() validation ---

class TestServiceValidation:
    def test_run_with_nonexistent_pdf(self, service):
        """Test that service yields error for missing PDF."""
        events = list(service.run(
            pdf_path="/nonexistent/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[]
        ))
        
        # First event should be an error about missing PDF
        assert len(events) >= 1
        error_events = [e for e in events if e.type == "error"]
        assert len(error_events) == 1
        assert "not found" in error_events[0].message.lower()
    
    @patch('lectern_service.check_connection')
    @patch('lectern_service.extract_content_from_pdf')
    @patch('os.path.exists')
    @patch('os.path.getsize')
    def test_run_with_anki_disconnected(
        self, 
        mock_getsize,
        mock_exists, 
        mock_extract, 
        mock_check,
        service
    ):
        """Test that service yields error when AnkiConnect is down."""
        mock_exists.return_value = True
        mock_getsize.return_value = 1024
        mock_check.return_value = False  # AnkiConnect not connected
        
        events = list(service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[]
        ))
        
        error_events = [e for e in events if e.type == "error"]
        assert len(error_events) >= 1
        assert "ankiconnect" in error_events[0].message.lower()


# --- Tests for stop_check ---

class TestStopCheck:
    @patch('lectern_service.check_connection')
    @patch('lectern_service.extract_content_from_pdf')
    @patch('os.path.exists')
    @patch('os.path.getsize')
    def test_stop_check_aborts_early(
        self,
        mock_getsize,
        mock_exists,
        mock_extract,
        mock_check,
        service
    ):
        """Test that stop_check callback halts generation."""
        mock_exists.return_value = True
        mock_getsize.return_value = 1024
        mock_check.return_value = True
        mock_extract.return_value = []
        
        stop_flag = False
        def stop_check():
            return stop_flag
        
        # Start generation, then signal stop
        events = []
        gen = service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            stop_check=stop_check
        )
        
        # Consume first few events
        for _ in range(3):
            try:
                events.append(next(gen))
            except StopIteration:
                break
        
        # Signal stop
        stop_flag = True
        
        # Generator should stop yielding
        remaining = list(gen)
        
        # Should not have continued past the stop point
        assert len(remaining) < 10  # Some cleanup events are OK


# --- Tests for _get_card_key ---

class TestCardDeduplication:
    def test_get_card_key_basic(self, service):
        """Test card key extraction for Basic cards."""
        card = {
            "model_name": "Basic",
            "fields": {"Front": "What is gradient descent?", "Back": "An optimization algorithm."}
        }
        key = service._get_card_key(card)
        assert key == "what is gradient descent?"
    
    def test_get_card_key_cloze(self, service):
        """Test card key extraction for Cloze cards."""
        card = {
            "model_name": "Cloze",
            "fields": {"Text": "The derivative of {{c1::x^n}} is {{c2::nx^(n-1)}}."}
        }
        key = service._get_card_key(card)
        assert "derivative" in key
        assert "{{c1::x^n}}" in key
    
    def test_get_card_key_normalizes_whitespace(self, service):
        """Test that card keys normalize whitespace."""
        card1 = {"fields": {"Front": "What   is   ML?"}}
        card2 = {"fields": {"Front": "What is ML?"}}
        
        assert service._get_card_key(card1) == service._get_card_key(card2)
    
    def test_get_card_key_empty_fields(self, service):
        """Test card key with empty fields."""
        card = {"fields": {}}
        key = service._get_card_key(card)
        assert key == ""


# --- Integration-style tests ---

class TestServiceIntegration:
    @patch('lectern_service.check_connection')
    @patch('lectern_service.sample_examples_from_deck')
    @patch('lectern_service.get_deck_slide_set_patterns')
    @patch('lectern_service.extract_content_from_pdf')
    @patch('lectern_service.extract_pdf_title')
    @patch('lectern_service.infer_slide_set_name_with_ai')
    @patch('lectern_service.LecternAIClient')
    @patch('os.path.exists')
    @patch('os.path.getsize')
    def test_full_flow_emits_expected_events(
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
        mock_pdf_pages
    ):
        """Test that a full run emits the expected event sequence."""
        # Setup mocks
        mock_exists.return_value = True
        mock_getsize.return_value = 1024
        mock_check.return_value = True
        mock_examples.return_value = ""
        mock_patterns.return_value = {"slide_sets": []}
        mock_extract_pdf.return_value = mock_pdf_pages
        mock_extract_title.return_value = "Test Lecture"
        mock_infer_name.return_value = "Lecture 1 Introduction"
        
        # Mock AI client
        mock_ai = MagicMock()
        mock_ai.log_path = "/tmp/test.log"
        mock_ai.concept_map.return_value = {"concepts": [], "relations": []}
        mock_ai.generate_more_cards.return_value = {
            "cards": [
                {"model_name": "Basic", "fields": {"Front": "Q1", "Back": "A1"}},
            ],
            "done": True
        }
        mock_ai.get_history.return_value = []
        mock_ai_client_class.return_value = mock_ai
        
        # Run with skip_export to avoid Anki dependency
        events = list(service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
            enable_reflection=False,
        ))
        
        # Check event types
        event_types = [e.type for e in events]
        
        # Should have step_start/step_end pairs
        assert "step_start" in event_types
        assert "step_end" in event_types
        
        # Should have card events
        card_events = [e for e in events if e.type == "card"]
        assert len(card_events) >= 1
        
        # Should end with done
        assert events[-1].type == "done"
        assert events[-1].data["total"] >= 1

    @patch('lectern_service.check_connection')
    @patch('lectern_service.sample_examples_from_deck')
    @patch('lectern_service.get_deck_slide_set_patterns')
    @patch('lectern_service.extract_content_from_pdf')
    @patch('lectern_service.extract_pdf_title')
    @patch('lectern_service.infer_slide_set_name_with_ai')
    @patch('lectern_service.LecternAIClient')
    @patch('os.path.exists')
    @patch('os.path.getsize')
    def test_focus_prompt_passed_to_ai_client(
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
        mock_pdf_pages
    ):
        """Test that focus_prompt is correctly passed to LecternAIClient."""
        # Setup mocks
        mock_exists.return_value = True
        mock_getsize.return_value = 1024
        mock_check.return_value = True
        mock_examples.return_value = ""
        mock_patterns.return_value = {"slide_sets": []}
        mock_extract_pdf.return_value = mock_pdf_pages
        mock_extract_title.return_value = "Test Lecture"
        mock_infer_name.return_value = "Lecture 1 Introduction"

        # Mock AI client
        mock_ai = MagicMock()
        mock_ai.log_path = "/tmp/test.log"
        mock_ai.concept_map.return_value = {"concepts": [], "relations": []}
        mock_ai.generate_more_cards.return_value = {
            "cards": [],
            "done": True
        }
        mock_ai.get_history.return_value = []
        mock_ai_client_class.return_value = mock_ai

        # Run with focus_prompt
        list(service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Test Deck",
            model_name="gemini-3-flash-preview",
            tags=[],
            skip_export=True,
            focus_prompt="Focus on key terms"
        ))

        # Verify LecternAIClient was initialized with focus_prompt
        mock_ai_client_class.assert_called()
        _, kwargs = mock_ai_client_class.call_args
        assert kwargs.get("focus_prompt") == "Focus on key terms"
