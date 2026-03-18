"""Control-plane snapshot infrastructure.

Emits lightweight ControlSnapshot objects at most every SNAPSHOT_INTERVAL_MS
or immediately on phase transitions. Cards are NEVER included in snapshots —
they travel on the data plane via individual 'card' events.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional

SnapshotStatus = Literal[
    "idle",
    "concept",
    "generating",
    "reflecting",
    "exporting",
    "complete",
    "error",
    "cancelled",
]

# Map service event phase strings (from step_start data) to snapshot statuses
_PHASE_TO_STATUS: Dict[str, SnapshotStatus] = {
    "concept": "concept",
    "generating": "generating",
    "reflecting": "reflecting",
    "exporting": "exporting",
}

# Map terminal event types to snapshot statuses
_TERMINAL_EVENT_STATUS: Dict[str, SnapshotStatus] = {
    "done": "complete",
    "cancelled": "cancelled",
    "error": "error",
}


@dataclass
class ControlSnapshot:
    """Lightweight control-plane snapshot — NO cards array."""

    session_id: str
    timestamp: int  # Unix ms
    status: SnapshotStatus
    progress: Dict[str, int]  # {current, total}
    concept_progress: Dict[str, int]  # {current, total}
    card_count: int  # count only, not the array
    total_pages: int
    coverage_data: Optional[Dict[str, Any]]
    is_error: bool
    error_message: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "timestamp": self.timestamp,
            "status": self.status,
            "progress": self.progress,
            "concept_progress": self.concept_progress,
            "card_count": self.card_count,
            "total_pages": self.total_pages,
            "coverage_data": self.coverage_data,
            "is_error": self.is_error,
            "error_message": self.error_message,
        }


class SnapshotTracker:
    """Tracks session state and emits ControlSnapshots on schedule or phase change."""

    SNAPSHOT_INTERVAL_MS: int = 5000

    def __init__(self, session_id: str) -> None:
        self._session_id = session_id
        self._status: SnapshotStatus = "idle"
        self._progress: Dict[str, int] = {"current": 0, "total": 0}
        self._concept_progress: Dict[str, int] = {"current": 0, "total": 0}
        self._card_count: int = 0
        self._total_pages: int = 0
        self._coverage_data: Optional[Dict[str, Any]] = None
        self._is_error: bool = False
        self._error_message: Optional[str] = None
        self._last_emission_ms: int = 0

    # --- Mutation helpers ---

    def on_card_added(self) -> None:
        self._card_count += 1

    def on_cards_replaced(self, count: int) -> None:
        self._card_count = count

    def on_progress_start(self, total: int, phase: Optional[str] = None) -> None:
        if phase == "concept":
            self._concept_progress = {"current": 0, "total": total}
        else:
            self._progress = {"current": 0, "total": total}

    def on_progress_update(
        self, current: int, total: Optional[int] = None, phase: Optional[str] = None
    ) -> None:
        if phase == "concept":
            self._concept_progress = {
                "current": current,
                "total": (
                    total if total is not None else self._concept_progress["total"]
                ),
            }
        else:
            self._progress = {
                "current": current,
                "total": total if total is not None else self._progress["total"],
            }

    def on_page_count(self, total_pages: int) -> None:
        if total_pages > 0:
            self._total_pages = total_pages

    def on_coverage_data(self, coverage_data: Dict[str, Any]) -> None:
        self._coverage_data = coverage_data

    def on_error(self, message: str) -> None:
        self._is_error = True
        self._error_message = message
        self._status = "error"

    # --- Phase transitions ---

    def transition(self, new_status: SnapshotStatus) -> Optional[ControlSnapshot]:
        """Transition to a new status; always emits immediately (phase change)."""
        if new_status == self._status:
            return None
        self._status = new_status
        return self.force_emit()

    # --- Timed emission ---

    def tick(self) -> Optional[ControlSnapshot]:
        """Return a snapshot if the throttle window has elapsed, else None."""
        now_ms = int(time.monotonic() * 1000)
        if now_ms - self._last_emission_ms >= self.SNAPSHOT_INTERVAL_MS:
            return self.force_emit()
        return None

    def force_emit(self) -> ControlSnapshot:
        """Force-emit a snapshot regardless of throttle."""
        self._last_emission_ms = int(time.monotonic() * 1000)
        return ControlSnapshot(
            session_id=self._session_id,
            timestamp=int(time.time() * 1000),
            status=self._status,
            progress=dict(self._progress),
            concept_progress=dict(self._concept_progress),
            card_count=self._card_count,
            total_pages=self._total_pages,
            coverage_data=self._coverage_data,
            is_error=self._is_error,
            error_message=self._error_message,
        )

    # --- High-level: process a ServiceEvent and return optional snapshot ---

    def process_event(
        self, event_type: str, event_data: Dict[str, Any], event_message: str = ""
    ) -> Optional[ControlSnapshot]:
        """
        Update internal state from a ServiceEvent and decide whether to emit a snapshot.

        Returns a ControlSnapshot if one should be streamed, else None.
        Phase transitions always emit; timed snapshots emit every 5 s.
        """
        # Update internal counters
        if event_type == "card":
            self.on_card_added()

        elif event_type == "cards_replaced":
            cards = event_data.get("cards", [])
            self.on_cards_replaced(len(cards))
            if "coverage_data" in event_data:
                self.on_coverage_data(event_data["coverage_data"])

        elif event_type == "progress_start":
            self.on_progress_start(
                total=int(event_data.get("total", 0)),
                phase=event_data.get("phase"),
            )

        elif event_type == "progress_update":
            self.on_progress_update(
                current=int(event_data.get("current", 0)),
                total=event_data.get("total"),
                phase=event_data.get("phase"),
            )

        elif event_type == "step_end":
            if "page_count" in event_data:
                self.on_page_count(int(event_data["page_count"]))
            if "coverage_data" in event_data:
                self.on_coverage_data(event_data["coverage_data"])

        elif event_type == "step_start":
            phase = event_data.get("phase")
            if phase and phase in _PHASE_TO_STATUS:
                new_status = _PHASE_TO_STATUS[phase]
                return self.transition(new_status)

        elif event_type in _TERMINAL_EVENT_STATUS:
            new_status = _TERMINAL_EVENT_STATUS[event_type]
            if event_type == "error":
                self._is_error = True
                self._error_message = event_message
            return self.transition(new_status)

        # For non-phase-transition events, emit on the 5 s tick
        return self.tick()
