import logging
from typing import List, Dict, Any, Optional

from lectern.utils.database import DatabaseManager

logger = logging.getLogger(__name__)


class HistoryManager:
    def __init__(self):
        self.db = DatabaseManager()

    def get_all(self) -> List[Dict[str, Any]]:
        """Return all history entries, sorted by most recent activity desc."""
        return self.db.get_all_history()

    def add_entry(
        self,
        filename: str,
        deck: str,
        session_id: Optional[str] = None,
        status: str = "draft",
        source_file_name: Optional[str] = None,
        source_pdf_sha256: Optional[str] = None,
    ) -> str:
        """Create a new history entry and return its ID."""
        return self.db.add_history(
            filename,
            deck,
            session_id,
            status,
            source_file_name=source_file_name,
            source_pdf_sha256=source_pdf_sha256,
        )

    def update_entry(
        self,
        entry_id: str,
        status: Optional[str] = None,
        card_count: Optional[int] = None,
    ) -> None:
        """Update an existing history entry."""
        self.db.update_history(entry_id, status, card_count)

    def sync_session_state(
        self,
        session_id: str,
        cards: List[Dict[str, Any]],
        status: Optional[str] = None,
        deck_name: Optional[str] = None,
        slide_set_name: Optional[str] = None,
        model_name: Optional[str] = None,
        tags: Optional[List[str]] = None,
        total_pages: Optional[int] = None,
        coverage_data: Optional[Dict[str, Any]] = None,
        source_file_name: Optional[str] = None,
        source_pdf_sha256: Optional[str] = None,
    ) -> bool:
        """Persist session cards, status, and metadata in one transaction."""
        if not session_id:
            return False

        return self.db.sync_session_snapshot(
            session_id=session_id,
            cards=cards,
            status=status,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            model_name=model_name,
            tags=tags,
            total_pages=total_pages,
            coverage_data=coverage_data,
            source_file_name=source_file_name,
            source_pdf_sha256=source_pdf_sha256,
        )

    def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        return self.db.get_entry(entry_id)

    def get_entry_by_session_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Find a history entry by its session_id field."""
        return self.db.get_entry_by_session_id(session_id)

    def delete_entry(self, entry_id: str) -> bool:
        """Delete a specific history entry by ID."""
        return self.db.delete_entry(entry_id)

    def delete_entries(self, entry_ids: List[str]) -> int:
        """Delete multiple history entries by ID. Returns count of deleted entries."""
        return self.db.delete_entries(entry_ids)

    def get_entries_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Return all history entries matching the given status."""
        return self.db.get_entries_by_status(status)

    def clear_all(self) -> None:
        """Clear all history entries."""
        self.db.clear_all()

    def update_session_logs(self, session_id: str, logs: List[Dict[str, Any]]) -> bool:
        """Update logs for a session."""
        return self.db.update_session_logs(session_id, logs)

    def update_session_phase(self, session_id: str, phase: str) -> bool:
        """Update the current phase for a session."""
        return self.db.update_session_phase(session_id, phase)

    def recover_interrupted_sessions(self) -> int:
        """Mark stale in-flight draft sessions as interrupted."""
        return self.db.recover_interrupted_sessions()

    def get_feedback_summary(self) -> Dict[str, Any]:
        """Aggregate historical feedback signals for adaptive tuning."""
        entries = self.get_all()
        positive_count = 0
        negative_count = 0
        reason_frequency: Dict[str, int] = {}

        for entry in entries:
            cards = entry.get("cards") or []
            for card in cards:
                if not isinstance(card, dict):
                    continue
                vote = str(card.get("feedback_vote") or "").strip().lower()
                reason = str(card.get("feedback_reason") or "").strip()
                if vote == "up":
                    positive_count += 1
                elif vote == "down":
                    negative_count += 1
                    if reason:
                        reason_frequency[reason] = reason_frequency.get(reason, 0) + 1

        negative_reasons = sorted(
            reason_frequency.keys(),
            key=lambda key: reason_frequency[key],
            reverse=True,
        )[:3]

        total_signals = positive_count + negative_count
        return {
            "positive_count": positive_count,
            "negative_count": negative_count,
            "total_signals": total_signals,
            "negative_reasons": negative_reasons,
        }
