import pytest
from fastapi.testclient import TestClient
from gui.backend.main import app
from unittest.mock import MagicMock, patch
import json

client = TestClient(app)

def run():
    with patch('gui.backend.main.notes_info') as mock_notes_info, \
         patch('gui.backend.main.update_note_fields') as mock_update_note_fields:
        mock_notes_info.return_value = [{"noteId": 123}]
        payload = {
            "cards": [{"anki_note_id": 123, "fields": {"Front": "F", "Back": "B"}}],
            "deck_name": "Default",
            "tags": [],
            "slide_set_name": "test_slides",
            "allow_updates": True
        }
        response = client.post("/sync", json=payload)
        events = [line for line in response.text.splitlines()]
        print("EVENTS:", events)

if __name__ == '__main__':
    run()
