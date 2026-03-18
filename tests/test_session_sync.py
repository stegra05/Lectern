import pytest
import json
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient
from gui.backend.main import app

client = TestClient(app)


@pytest.fixture
def mock_notes_info():
    with patch("lectern.anki_connector.notes_info", new_callable=AsyncMock) as mock:
        yield mock


@pytest.fixture
def mock_update_note_fields():
    with patch(
        "lectern.anki_connector.update_note_fields", new_callable=AsyncMock
    ) as mock:
        yield mock


@pytest.fixture
def mock_export_card_to_anki():
    with patch(
        "gui.backend.routers.anki.export_card_to_anki", new_callable=AsyncMock
    ) as mock:
        yield mock


def _parse_events_from_response_text(raw: str) -> list[dict]:
    events: list[dict] = []
    for line in raw.splitlines():
        line = line.strip()
        if line:
            events.append(json.loads(line))
    return events


def test_sync_session_updates_existing_note(mock_notes_info, mock_update_note_fields):
    payload = {
        "cards": [{"anki_note_id": 123, "fields": {"Front": "F", "Back": "B"}}],
        "deck_name": "Default",
        "tags": [],
        "slide_set_name": "test_slides",
        "allow_updates": True,
    }
    mock_notes_info.return_value = [{"noteId": 123}]

    response = client.post("/sync", json=payload)
    assert response.status_code == 200

    events = _parse_events_from_response_text(response.text)
    assert any(e["type"] == "note_updated" for e in events)
    mock_update_note_fields.assert_called_once()


def test_sync_session_recreates_deleted_note(mock_notes_info, mock_export_card_to_anki):
    payload = {
        "cards": [{"anki_note_id": 123, "fields": {"Front": "F", "Back": "B"}}],
        "deck_name": "Default",
        "tags": [],
        "slide_set_name": "test_slides",
        "allow_updates": True,
    }
    # Mock that note 123 no longer exists in Anki
    mock_notes_info.return_value = []

    # Mock export success
    mock_export_card_to_anki.return_value = MagicMock(success=True, note_id=456)

    response = client.post("/sync", json=payload)
    assert response.status_code == 200

    events = _parse_events_from_response_text(response.text)
    assert any(e["type"] == "note_recreated" for e in events)
    mock_export_card_to_anki.assert_called_once()


def test_sync_transport_failure_emits_error_event_with_hint(mock_export_card_to_anki):
    payload = {
        "cards": [{"fields": {"Front": "Q", "Back": "A"}}],
        "deck_name": "Default",
        "tags": [],
        "slide_set_name": "test_slides",
        "allow_updates": False,
    }
    mock_export_card_to_anki.return_value = MagicMock(
        success=False,
        error="Failed to reach AnkiConnect at http://127.0.0.1:8765: Connection refused",
    )

    response = client.post("/sync", json=payload)
    assert response.status_code == 200

    events = _parse_events_from_response_text(response.text)
    failure_events = [e for e in events if e["type"] == "error"]
    assert len(failure_events) == 1
    failure_event = failure_events[0]
    assert failure_event["data"]["failure_kind"] == "transport"
    assert "Check that Anki is running" in failure_event["data"]["hint"]
    assert "sync failed [transport]" in failure_event["message"].lower()

    done_event = next(e for e in events if e["type"] == "done")
    assert done_event["data"]["failed"] == 1
    assert done_event["data"]["failure_summary"] == {
        "transport": 1,
        "api": 0,
        "card_validation": 0,
    }


def test_sync_api_failure_emits_error_event_with_hint(mock_export_card_to_anki):
    payload = {
        "cards": [{"fields": {"Front": "Q", "Back": "A"}}],
        "deck_name": "Default",
        "tags": [],
        "slide_set_name": "test_slides",
        "allow_updates": False,
    }
    mock_export_card_to_anki.return_value = MagicMock(
        success=False,
        error="AnkiConnect error for addNote: Deck not found",
    )

    response = client.post("/sync", json=payload)
    assert response.status_code == 200

    events = _parse_events_from_response_text(response.text)
    failure_event = next(e for e in events if e["type"] == "error")
    assert failure_event["data"]["failure_kind"] == "api"
    assert "Check deck and note type settings" in failure_event["data"]["hint"]
    assert "sync failed [api]" in failure_event["message"].lower()


def test_sync_card_validation_failure_emits_warning_event_with_hint():
    payload = {
        "cards": [{"anki_note_id": "abc", "fields": {"Front": "F", "Back": "B"}}],
        "deck_name": "Default",
        "tags": [],
        "slide_set_name": "test_slides",
        "allow_updates": True,
    }

    response = client.post("/sync", json=payload)
    assert response.status_code == 200

    events = _parse_events_from_response_text(response.text)
    failure_event = next(e for e in events if e["type"] == "warning")
    assert failure_event["data"]["failure_kind"] == "card_validation"
    assert "Review the card payload fields" in failure_event["data"]["hint"]
    assert "sync failed [card_validation]" in failure_event["message"].lower()


def test_sync_preview_reports_conflicts_for_missing_and_invalid_note_ids(mock_notes_info):
    payload = {
        "cards": [
            {"anki_note_id": 123, "fields": {"Front": "F1", "Back": "B1"}},
            {"anki_note_id": "abc", "fields": {"Front": "F2", "Back": "B2"}},
            {"fields": {"Front": "F3", "Back": "B3"}},
        ],
        "deck_name": "Default",
        "tags": [],
        "slide_set_name": "test_slides",
        "allow_updates": True,
    }
    mock_notes_info.return_value = []

    response = client.post("/sync/preview", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["total_cards"] == 3
    assert data["create_candidates"] == 1
    assert data["update_candidates"] == 2
    assert data["existing_note_matches"] == 0
    assert data["missing_note_ids"] == 1
    assert data["invalid_note_ids"] == 1
    assert data["conflict_count"] == 2


def test_sync_preview_skips_conflict_analysis_when_updates_disabled(mock_notes_info):
    payload = {
        "cards": [
            {"anki_note_id": 123, "fields": {"Front": "F1", "Back": "B1"}},
            {"fields": {"Front": "F2", "Back": "B2"}},
        ],
        "deck_name": "Default",
        "tags": [],
        "slide_set_name": "test_slides",
        "allow_updates": False,
    }

    response = client.post("/sync/preview", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["total_cards"] == 2
    assert data["create_candidates"] == 2
    assert data["update_candidates"] == 0
    assert data["existing_note_matches"] == 0
    assert data["missing_note_ids"] == 0
    assert data["invalid_note_ids"] == 0
    assert data["conflict_count"] == 0
    mock_notes_info.assert_not_called()
