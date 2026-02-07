import pytest
from unittest.mock import MagicMock, patch
from anki_connector import update_note_fields, delete_notes

@patch('anki_connector._invoke')
def test_update_note_fields(mock_invoke):
    note_id = 12345
    fields = {"Front": "Updated Front", "Back": "Updated Back"}
    
    update_note_fields(note_id, fields)
    
    mock_invoke.assert_called_once_with(
        "updateNoteFields", 
        {"note": {"id": note_id, "fields": fields}}
    )

@patch('anki_connector._invoke')
def test_delete_notes(mock_invoke):
    note_ids = [123, 456]
    
    delete_notes(note_ids)
    
    mock_invoke.assert_called_once_with(
        "deleteNotes", 
        {"notes": note_ids}
    )
