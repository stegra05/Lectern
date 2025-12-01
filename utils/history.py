import json
import os
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional

HISTORY_FILE = "history.json"

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
            return []

    def _save(self, history: List[Dict[str, Any]]) -> None:
        try:
            with open(self.history_file, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Warning: Failed to save history: {e}")

    def get_all(self) -> List[Dict[str, Any]]:
        """Return all history entries, sorted by date desc."""
        history = self._load()
        # Sort by date descending
        history.sort(key=lambda x: x.get("date", ""), reverse=True)
        return history

    def add_entry(self, 
                  filename: str, 
                  deck: str, 
                  status: str = "draft") -> str:
        """Create a new history entry and return its ID."""
        history = self._load()
        entry_id = str(uuid.uuid4())
        entry = {
            "id": entry_id,
            "filename": os.path.basename(filename),
            "full_path": os.path.abspath(filename),
            "deck": deck,
            "date": datetime.now().isoformat(),
            "card_count": 0,
            "status": status
        }
        history.insert(0, entry)
        self._save(history)
        return entry_id

    def update_entry(self, 
                     entry_id: str, 
                     status: Optional[str] = None, 
                     card_count: Optional[int] = None) -> None:
        """Update an existing history entry."""
        history = self._load()
        for entry in history:
            if entry["id"] == entry_id:
                if status:
                    entry["status"] = status
                if card_count is not None:
                    entry["card_count"] = card_count
                entry["date"] = datetime.now().isoformat() # Update timestamp on change? Maybe keep creation time.
                # Let's keep creation time as "date" and maybe add "last_modified" if needed. 
                # For now, user request said "date", usually implies creation or start time.
                # But "Recent Sessions" might imply last accessed. 
                # I'll update the date to bring it to top of list if we sort by date.
                entry["date"] = datetime.now().isoformat()
                break
        self._save(history)

    def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        history = self._load()
        for entry in history:
            if entry["id"] == entry_id:
                return entry
        return None
