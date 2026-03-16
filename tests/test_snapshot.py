import time
import pytest
from unittest.mock import patch
from lectern.snapshot import SnapshotTracker, ControlSnapshot


def test_snapshot_initial_state():
    tracker = SnapshotTracker("test-session")
    snapshot = tracker.force_emit()
    assert snapshot.session_id == "test-session"
    assert snapshot.status == "idle"
    assert snapshot.progress == {"current": 0, "total": 0}
    assert snapshot.card_count == 0
    assert snapshot.is_error is False


def test_on_card_added():
    tracker = SnapshotTracker("s1")
    tracker.on_card_added()
    tracker.on_card_added()
    snapshot = tracker.force_emit()
    assert snapshot.card_count == 2


def test_on_cards_replaced():
    tracker = SnapshotTracker("s1")
    tracker.on_card_added()
    tracker.on_cards_replaced(10)
    snapshot = tracker.force_emit()
    assert snapshot.card_count == 10


def test_progress_start_and_update():
    tracker = SnapshotTracker("s1")
    # Generating phase
    tracker.on_progress_start(100)
    tracker.on_progress_update(10)
    snapshot = tracker.force_emit()
    assert snapshot.progress == {"current": 10, "total": 100}
    assert snapshot.concept_progress == {"current": 0, "total": 0}

    # Concept phase
    tracker.on_progress_start(5, phase="concept")
    tracker.on_progress_update(2, phase="concept")
    snapshot = tracker.force_emit()
    assert snapshot.concept_progress == {"current": 2, "total": 5}


def test_transition_emits_immediately():
    tracker = SnapshotTracker("s1")
    snapshot = tracker.transition("generating")
    assert snapshot is not None
    assert snapshot.status == "generating"

    # Same status returns None
    snapshot2 = tracker.transition("generating")
    assert snapshot2 is None


def test_tick_throttling():
    tracker = SnapshotTracker("s1")
    # Initial tick should return a snapshot (force_emit is called by transition/process_event usually,
    # but let's test tick in isolation)

    with patch("time.monotonic", return_value=10.0):  # 10s
        # First tick should emit (10000 - 0 >= 5000)
        s1 = tracker.tick()
        assert s1 is not None
        last_time = 10.0

    with patch("time.monotonic", return_value=last_time + 1.0):  # 11s
        # Should be throttled
        s2 = tracker.tick()
        assert s2 is None

    with patch("time.monotonic", return_value=last_time + 6.0):  # 16s
        # Should emit
        s3 = tracker.tick()
        assert s3 is not None


def test_process_event_routing():
    tracker = SnapshotTracker("s1")

    # card event increments count
    with patch("time.monotonic", return_value=1.0):
        tracker.process_event("card", {})
        assert tracker._card_count == 1

    # step_start transitions phase
    s_phase = tracker.process_event("step_start", {"phase": "concept"})
    assert s_phase is not None
    assert s_phase.status == "concept"

    # error event sets error status
    s_err = tracker.process_event("error", {"recoverable": False}, "Fatal boom")
    assert s_err is not None
    assert s_err.status == "error"
    assert s_err.is_error is True
    assert s_err.error_message == "Fatal boom"


def test_to_dict():
    snapshot = ControlSnapshot(
        session_id="s1",
        timestamp=123,
        status="generating",
        progress={"current": 1, "total": 10},
        concept_progress={"current": 0, "total": 0},
        card_count=5,
        total_pages=20,
        coverage_data={"pct": 50},
        is_error=False,
        error_message=None,
    )
    d = snapshot.to_dict()
    assert d["session_id"] == "s1"
    assert d["status"] == "generating"
    assert d["progress"]["current"] == 1
    assert d["coverage_data"]["pct"] == 50
