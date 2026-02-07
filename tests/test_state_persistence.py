
import unittest
import os
import sys
import json
import tempfile
import shutil
from unittest.mock import patch, MagicMock

# Add project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from utils.state import save_state, load_state, clear_state, _get_state_path
from utils.history import HistoryManager

class TestStatePersistence(unittest.TestCase):
    def setUp(self):
        self.test_session_id = "unit_test_session_123"
        self.test_history_file = "test_history.json"

        # Ensure clean state
        clear_state(self.test_session_id)
        if os.path.exists(self.test_history_file):
            os.remove(self.test_history_file)

    def tearDown(self):
        clear_state(self.test_session_id)
        if os.path.exists(self.test_history_file):
            os.remove(self.test_history_file)

    def test_save_and_load_state(self):
        """Test that state can be saved (without indentation) and loaded correctly."""

        # Create a complex state object
        cards = [{"front": "Front 1", "back": "Back 1", "tags": ["tag1"]},
                 {"front": "Front 2", "back": "Back 2", "tags": ["tag2"]}]
        concept_map = {"concepts": [{"name": "Concept 1", "definition": "Def 1"}]}
        history = [{"role": "user", "parts": ["Hello"]}, {"role": "model", "parts": ["Hi"]}]

        # Save state
        save_state(
            pdf_path="/tmp/test.pdf",
            deck_name="Test Deck",
            cards=cards,
            concept_map=concept_map,
            history=history,
            log_path="/tmp/test.log",
            session_id=self.test_session_id,
            slide_set_name="Test Slide Set"
        )

        # Verify file exists and is not indented (simple check)
        state_path = _get_state_path(self.test_session_id)
        self.assertTrue(os.path.exists(state_path))

        with open(state_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Should be compact (no newlines between keys except maybe inside strings)
            # Count lines - should be very few (1 ideally)
            line_count = len(content.splitlines())
            self.assertLess(line_count, 5, "State file appears to be indented (too many lines)")

        # Load state
        loaded_state = load_state(self.test_session_id)

        # Verify content matches
        self.assertIsNotNone(loaded_state)
        self.assertEqual(loaded_state["deck_name"], "Test Deck")
        self.assertEqual(len(loaded_state["cards"]), 2)
        self.assertEqual(loaded_state["cards"][0]["front"], "Front 1")
        self.assertEqual(loaded_state["concept_map"]["concepts"][0]["name"], "Concept 1")
        self.assertEqual(len(loaded_state["history"]), 2)

    def test_history_persistence(self):
        """Test that history is saved without indentation."""
        # Use a temporary file for history
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            history_path = tmp.name

        try:
            mgr = HistoryManager(history_file=history_path)

            # Add an entry
            entry_id = mgr.add_entry("test.pdf", "Test Deck", session_id="sess_1")

            # Check file content for indentation
            with open(history_path, "r", encoding="utf-8") as f:
                content = f.read()
                line_count = len(content.splitlines())
                self.assertLess(line_count, 5, "History file appears to be indented")

            # Verify data integrity
            entries = mgr.get_all()
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["id"], entry_id)
            self.assertEqual(entries[0]["deck"], "Test Deck")

        finally:
            if os.path.exists(history_path):
                os.remove(history_path)

if __name__ == "__main__":
    unittest.main()
