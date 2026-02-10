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
    
    # Update entry — preserves creation date, sets last_modified
    original_date = mgr.get_entry(entry_id)["date"]
    mgr.update_entry(entry_id, status="completed", card_count=5)
    entry = mgr.get_entry(entry_id)
    assert entry["status"] == "completed"
    assert entry["card_count"] == 5
    assert entry["date"] == original_date
    assert "last_modified" in entry
    
    # Get entry by session_id
    session_entry = mgr.get_entry_by_session_id(entry["session_id"])
    assert session_entry is not None
    assert session_entry["id"] == entry_id
    assert mgr.get_entry_by_session_id("nonexistent") is None
    
    # Delete entry
    mgr.delete_entry(entry_id)
    assert len(mgr.get_all()) == 0
    
    # Batch operations
    id1 = mgr.add_entry("a.pdf", "D1", status="error")
    id2 = mgr.add_entry("b.pdf", "D2", status="error")
    id3 = mgr.add_entry("c.pdf", "D3", status="completed")
    
    # get_entries_by_status
    errors = mgr.get_entries_by_status("error")
    assert len(errors) == 2
    
    # delete_entries (batch)
    deleted = mgr.delete_entries([id1, id2])
    assert deleted == 2
    assert len(mgr.get_all()) == 1
    
    # Clear all
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


def test_sweep_orphan_state_temps(tmp_path):
    from utils.state import sweep_orphan_state_temps
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    
    # Create orphan temp files
    (state_dir / "tmpabcdef12").write_text("orphan1")
    (state_dir / "tmp_xyz_9876").write_text("orphan2")
    # This is a real session file — should NOT be deleted
    (state_dir / "session-abc123.json").write_text("{}")
    
    with patch('utils.state.get_app_data_dir', return_value=tmp_path):
        removed = sweep_orphan_state_temps()
    
    assert removed == 2
    assert not (state_dir / "tmpabcdef12").exists()
    assert not (state_dir / "tmp_xyz_9876").exists()
    assert (state_dir / "session-abc123.json").exists()
