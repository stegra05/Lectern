import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from gui.backend.main import app

client = TestClient(app)


@pytest.fixture
def mock_delete_notes():
    with patch("lectern.anki_connector.delete_notes", new_callable=AsyncMock) as mock:
        yield mock


def test_delete_anki_notes(mock_delete_notes):
    note_ids = [123, 456]
    response = client.request("DELETE", "/anki/notes", json={"note_ids": note_ids})

    assert response.status_code == 200
    assert response.json() == {"status": "deleted", "count": 2}

    mock_delete_notes.assert_called_once_with(note_ids)
