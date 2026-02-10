import os

import pytest

from gui.backend.service import DraftStore
from lectern.utils import state as state_utils
from lectern.utils.history import HistoryManager


def _patch_state_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(state_utils, "get_app_data_dir", lambda: tmp_path)


def test_statefile_roundtrip(tmp_path, monkeypatch):
    _patch_state_dir(monkeypatch, tmp_path)
    session_id = "s1"

    saved = state_utils.save_state(
        pdf_path="/tmp/test_slides.pdf",
        deck_name="Deck",
        cards=[{"front": "Q", "back": "A"}],
        concept_map={"concepts": []},
        history=[],
        log_path="/tmp/test.log",
        session_id=session_id,
        slide_set_name="L1",
        model_name="Basic",
        tags=["t1"],
    )
    assert saved is True

    loaded = state_utils.load_state(session_id)
    assert loaded is not None
    assert loaded["deck_name"] == "Deck"
    assert loaded["cards"][0]["front"] == "Q"

    state_file = state_utils.StateFile(session_id)
    updated = state_file.update_cards(
        [{"front": "Q2", "back": "A2"}],
        deck_name="Deck",
        model_name="Basic",
        slide_set_name="L1",
        tags=["t1"],
    )
    assert updated is True

    loaded_again = state_utils.load_state(session_id)
    assert loaded_again["cards"][0]["front"] == "Q2"


def test_draft_store_roundtrip(tmp_path, monkeypatch):
    _patch_state_dir(monkeypatch, tmp_path)
    session_id = "s2"

    state_utils.save_state(
        pdf_path="/tmp/test_slides.pdf",
        deck_name="Deck",
        cards=[],
        concept_map={},
        history=[],
        log_path="/tmp/test.log",
        session_id=session_id,
        slide_set_name="L1",
        model_name="Basic",
        tags=["t1"],
    )

    store = DraftStore(session_id=session_id)
    store.set_drafts(
        cards=[{"front": "Q1", "back": "A1"}],
        deck_name="Deck",
        model_name="Basic",
        tags=["t1"],
        entry_id="e1",
        slide_set_name="L1",
    )

    loaded = state_utils.load_state(session_id)
    assert loaded is not None
    assert loaded["cards"][0]["front"] == "Q1"

    assert store.update_draft(0, {"front": "Q1-mod", "back": "A1"}) is True
    loaded = state_utils.load_state(session_id)
    assert loaded["cards"][0]["front"] == "Q1-mod"

    assert store.delete_draft(0) is True
    loaded = state_utils.load_state(session_id)
    assert loaded["cards"] == []


def test_history_manager_roundtrip(tmp_path):
    history_file = os.path.join(tmp_path, "history.json")
    manager = HistoryManager(history_file=history_file)

    entry_id = manager.add_entry("test_slides.pdf", "Deck", session_id="s1")
    assert entry_id

    manager.update_entry(entry_id, status="completed", card_count=3)
    entries = manager.get_all()
    assert len(entries) == 1
    assert entries[0]["status"] == "completed"
    assert entries[0]["card_count"] == 3

    assert manager.delete_entry(entry_id) is True
    assert manager.get_all() == []
