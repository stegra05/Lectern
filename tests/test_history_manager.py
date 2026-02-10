import pytest
import os
import json
import sys
from unittest.mock import patch, MagicMock
from utils.history import HistoryManager, get_history_file_path

def test_get_history_file_path_frozen():
    with patch('sys.frozen', True, create=True):
        with patch('utils.history.get_app_data_dir') as mock_dir:
            from pathlib import Path
            mock_dir.return_value = Path("/tmp/appdata")
            path = get_history_file_path()
            assert "history.json" in str(path)

def test_history_manager_load_save(tmp_path):
    history_file = tmp_path / "history.json"
    mgr = HistoryManager(str(history_file))
    
    # Load non-existent
    assert mgr.get_all() == []
    
    # Add entry
    entry_id = mgr.add_entry("test_slides.pdf", "Deck")
    assert entry_id is not None
    
    all_history = mgr.get_all()
    assert len(all_history) == 1
    assert all_history[0]["filename"] == "test_slides.pdf"
    
    # Update entry
    mgr.update_entry(entry_id, status="completed", card_count=5)
    entry = mgr.get_entry(entry_id)
    assert entry["status"] == "completed"
    assert entry["card_count"] == 5
    
    # Delete entry
    mgr.delete_entry(entry_id)
    assert len(mgr.get_all()) == 0
    
    # Clear all
    mgr.add_entry("a.pdf", "D")
    mgr.clear_all()
    assert len(mgr.get_all()) == 0

def test_history_manager_error_handling(tmp_path):
    history_file = tmp_path / "history.json"
    mgr = HistoryManager(str(history_file))
    
    # Corrupt file
    history_file.write_text("invalid json")
    assert mgr.get_all() == []
    
    # Save failure (mocking open)
    with patch('builtins.open', side_effect=PermissionError("Access denied")):
        mgr._save([]) # Should not raise
