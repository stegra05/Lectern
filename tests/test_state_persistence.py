
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

        # Verify file exists
        state_path = _get_state_path(self.test_session_id)
        self.assertTrue(os.path.exists(state_path))

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
        """Test that history is saved and can be read back."""
        # Use a temporary file for history
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            history_path = tmp.name

        try:
            mgr = HistoryManager(history_file=history_path)

            # Add an entry
            entry_id = mgr.add_entry("test.pdf", "Test Deck", session_id="sess_1")

            # Verify data integrity
            entries = mgr.get_all()
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["id"], entry_id)
            self.assertEqual(entries[0]["deck"], "Test Deck")

        finally:
            if os.path.exists(history_path):
                os.remove(history_path)

    def test_load_state_legacy_migration(self):
        """Test migration from .lectern_state.json (legacy)."""
        from utils.state import LEGACY_STATE_FILE
        legacy_data = {"pdf_path": "legacy.pdf", "deck_name": "Legacy Deck"}
        
        # Ensure new state doesn't exist
        clear_state(None)
        
        # Create legacy file
        with open(LEGACY_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(legacy_data, f)
            
        try:
            loaded = load_state(None)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["pdf_path"], "legacy.pdf")
        finally:
            if os.path.exists(LEGACY_STATE_FILE):
                os.remove(LEGACY_STATE_FILE)

    def test_load_state_invalid_json(self):
        """Test loading corrupted state file."""
        state_path = _get_state_path(self.test_session_id)
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        with open(state_path, "w", encoding="utf-8") as f:
            f.write("{ invalid json")
            
        loaded = load_state(self.test_session_id)
        self.assertIsNone(loaded)

    def test_clear_state(self):
        """Test clearing state files."""
        save_state("p", "d", [], {}, [], "l", session_id=self.test_session_id)
        state_path = _get_state_path(self.test_session_id)
        self.assertTrue(os.path.exists(state_path))
        
        clear_state(self.test_session_id)
        self.assertFalse(os.path.exists(state_path))

if __name__ == "__main__":
    unittest.main()
