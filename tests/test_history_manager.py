from lectern.utils.history import HistoryManager
from lectern.utils.database import DatabaseManager


def test_history_manager_behavior():
    """Test HistoryManager delegates to DatabaseManager correctly."""
    mgr = HistoryManager()

    # 1. Clear all for clean start
    mgr.clear_all()
    assert len(mgr.get_all()) == 0

    # 2. Add entry
    entry_id = mgr.add_entry("test_slides.pdf", "Deck")
    assert entry_id is not None

    all_history = mgr.get_all()
    assert len(all_history) == 1
    assert all_history[0]["filename"] == "test_slides.pdf"

    # 3. Update entry
    mgr.update_entry(entry_id, status="completed", card_count=5)
    entry = mgr.get_entry(entry_id)
    assert entry["status"] == "completed"
    assert entry["card_count"] == 5

    # 4. Get by session_id
    session_id = entry["session_id"]
    session_entry = mgr.get_entry_by_session_id(session_id)
    assert session_entry is not None
    assert session_entry["id"] == entry_id

    # 5. Batch operations
    id2 = mgr.add_entry("b.pdf", "D2", status="error")
    assert len(mgr.get_all()) == 2

    errors = mgr.get_entries_by_status("error")
    assert len(errors) == 1
    assert errors[0]["id"] == id2

    # 6. Delete
    mgr.delete_entry(entry_id)
    assert len(mgr.get_all()) == 1

    mgr.clear_all()
    assert len(mgr.get_all()) == 0


def test_database_manager_singleton():
    db1 = DatabaseManager()
    db2 = DatabaseManager()
    assert db1 is db2

    db = DatabaseManager()
    session_id = "test_json_session"
    # Create entry using the proper add_history method to ensure valid ID
    entry_id = db.add_history("test.pdf", "Deck", session_id=session_id)

    cards = [{"front": "Q", "back": "A"}]
    tags = ["tag1", "tag2"]

    db.update_session_cards(session_id, cards, tags=tags, model_name="M")
    entry = db.get_entry_by_session_id(session_id)

    assert entry is not None
    assert entry["cards"] == cards
    assert entry["tags"] == tags
    assert entry["model_name"] == "M"

    # Clean up
    db.delete_entry(entry_id)


def test_recover_interrupted_sessions_marks_inflight_drafts():
    mgr = HistoryManager()
    mgr.clear_all()

    try:
        mgr.add_entry("active.pdf", "Deck", session_id="active-session", status="draft")
        mgr.add_entry(
            "completed.pdf", "Deck", session_id="completed-session", status="completed"
        )
        mgr.add_entry("idle.pdf", "Deck", session_id="idle-session", status="draft")

        mgr.update_session_phase("active-session", "generating")
        mgr.update_session_phase("completed-session", "complete")

        recovered = mgr.recover_interrupted_sessions()
        assert recovered == 1

        active = mgr.get_entry_by_session_id("active-session")
        assert active is not None
        assert active["status"] == "interrupted"
        assert active["current_phase"] == "idle"

        completed = mgr.get_entry_by_session_id("completed-session")
        assert completed is not None
        assert completed["status"] == "completed"

        idle = mgr.get_entry_by_session_id("idle-session")
        assert idle is not None
        assert idle["status"] == "draft"
        assert idle["current_phase"] is None
    finally:
        mgr.clear_all()
