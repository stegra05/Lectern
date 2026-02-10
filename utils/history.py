import json
import logging
import os
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional

import sys
from pathlib import Path

from utils.path_utils import get_app_data_dir

logger = logging.getLogger(__name__)

def get_history_file_path() -> str:
    """
    Determine the appropriate path for history.json.
    - If Frozen (App Bundle): Platform-specific app data dir/history.json
    - If Dev: Project Root/history.json
    """
    if getattr(sys, 'frozen', False):
        # We are running in a bundle
        app_support = get_app_data_dir()
        app_support.mkdir(parents=True, exist_ok=True)
        return str(app_support / "history.json")
    else:
        # We are running in a normal Python environment
        # Project root is parent of utils
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        return os.path.join(project_root, "history.json")

HISTORY_FILE = get_history_file_path()

class HistoryManager:
    def __init__(self, history_file: str = HISTORY_FILE):
        self.history_file = history_file

    def _load(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.history_file):
            return []
        try:
            with open(self.history_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            logger.warning("Failed to load history file: %s", self.history_file)
            return []

    def _save(self, history: List[Dict[str, Any]]) -> bool:
        try:
            with open(self.history_file, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False)
            return True
        except Exception:
            logger.exception("Failed to save history file: %s", self.history_file)
            return False

    def get_all(self) -> List[Dict[str, Any]]:
        """Return all history entries, sorted by most recent activity desc."""
        history = self._load()
        history.sort(key=lambda x: x.get("last_modified", x.get("date", "")), reverse=True)
        return history

    def add_entry(self, 
                  filename: str, 
                  deck: str, 
                  session_id: Optional[str] = None,
                  status: str = "draft") -> str:
        """Create a new history entry and return its ID."""
        history = self._load()
        entry_id = str(uuid.uuid4())
        # If no session_id provided, default to entry_id (legacy behavior)
        final_session_id = session_id if session_id else entry_id
        
        entry = {
            "id": entry_id,
            "session_id": final_session_id,  # Explicit link to state file
            "filename": os.path.basename(filename),
            "full_path": os.path.abspath(filename),
            "deck": deck,
            "date": datetime.now().isoformat(),
            "card_count": 0,
            "status": status
        }
        history.insert(0, entry)
        if not self._save(history):
            logger.warning("History entry not persisted: %s", entry_id)
        return entry_id

    def update_entry(self, 
                     entry_id: str, 
                     status: Optional[str] = None, 
                     card_count: Optional[int] = None) -> None:
        """Update an existing history entry."""
        history = self._load()
        for entry in history:
            if entry["id"] == entry_id:
                if status is not None:
                    entry["status"] = status
                if card_count is not None:
                    entry["card_count"] = card_count
                entry["last_modified"] = datetime.now().isoformat()
                break
        if not self._save(history):
            logger.warning("History update not persisted: %s", entry_id)

    def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        history = self._load()
        for entry in history:
            if entry["id"] == entry_id:
                return entry
        return None

    def get_entry_by_session_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Find a history entry by its session_id field."""
        history = self._load()
        for entry in history:
            if entry.get("session_id") == session_id:
                return entry
        return None

    def delete_entry(self, entry_id: str) -> bool:
        """Delete a specific history entry by ID."""
        history = self._load()
        initial_len = len(history)
        history = [e for e in history if e["id"] != entry_id]
        if len(history) < initial_len:
            return self._save(history)
        return False

    def delete_entries(self, entry_ids: List[str]) -> int:
        """Delete multiple history entries by ID. Returns count of deleted entries."""
        history = self._load()
        id_set = set(entry_ids)
        original_len = len(history)
        history = [e for e in history if e["id"] not in id_set]
        deleted = original_len - len(history)
        if deleted > 0:
            self._save(history)
        return deleted

    def get_entries_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Return all history entries matching the given status."""
        history = self._load()
        return [e for e in history if e.get("status") == status]

    def clear_all(self) -> None:
        """Clear all history entries."""
        if not self._save([]):
            logger.warning("Failed to clear history file: %s", self.history_file)
