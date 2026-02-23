import sqlite3
import json
import logging
import threading
from typing import Dict, Any, List, Optional
from datetime import datetime
import uuid
import os

from lectern.utils.path_utils import get_app_data_dir

logger = logging.getLogger(__name__)

def get_db_path() -> str:
    app_data = get_app_data_dir()
    app_data.mkdir(parents=True, exist_ok=True)
    return str(app_data / "lectern.db")

class DatabaseManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(DatabaseManager, cls).__new__(cls)
                cls._instance._init_db()
            return cls._instance

    def _init_db(self):
        self.db_path = get_db_path()
        with self.get_connection() as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS history (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    filename TEXT,
                    full_path TEXT,
                    deck TEXT,
                    date TEXT,
                    last_modified TEXT,
                    status TEXT,
                    card_count INTEGER DEFAULT 0,
                    cards TEXT,
                    tags TEXT,
                    model_name TEXT,
                    slide_set_name TEXT
                )
            ''')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_session_id ON history(session_id)')
            conn.commit()

    def get_connection(self):
        # check_same_thread=False is needed because FastAPI handles requests in different threads
        return sqlite3.connect(self.db_path, check_same_thread=False)

    def row_to_dict(self, row: tuple) -> Dict[str, Any]:
        """Convert a history row tuple to a dictionary."""
        return {
            "id": row[0],
            "session_id": row[1],
            "filename": row[2],
            "full_path": row[3],
            "deck": row[4],
            "date": row[5],
            "last_modified": row[6],
            "status": row[7],
            "card_count": row[8],
            "cards": json.loads(row[9]) if row[9] else [],
            "tags": json.loads(row[10]) if row[10] else [],
            "model_name": row[11],
            "slide_set_name": row[12],
        }

    # History Methods
    def get_all_history(self) -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT * FROM history ORDER BY coalesce(last_modified, date) DESC LIMIT 500')
            return [self.row_to_dict(row) for row in cursor.fetchall()]

    def add_history(self, filename: str, deck: str, session_id: Optional[str] = None, status: str = "draft") -> str:
        entry_id = str(uuid.uuid4())
        final_session_id = session_id if session_id else entry_id
        now = datetime.now().isoformat()
        
        with self.get_connection() as conn:
            conn.execute('''
                INSERT INTO history (id, session_id, filename, full_path, deck, date, last_modified, status, card_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                entry_id, final_session_id, os.path.basename(filename), os.path.abspath(filename), 
                deck, now, now, status, 0
            ))
            conn.commit()
        return entry_id

    def update_history(self, entry_id: str, status: Optional[str] = None, card_count: Optional[int] = None):
        updates = []
        params = []
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if card_count is not None:
            updates.append("card_count = ?")
            params.append(card_count)
            
        if not updates:
            return
            
        updates.append("last_modified = ?")
        params.append(datetime.now().isoformat())
        params.append(entry_id)
        
        with self.get_connection() as conn:
            conn.execute(f'UPDATE history SET {", ".join(updates)} WHERE id = ?', params)
            conn.commit()

    def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT * FROM history WHERE id = ?', (entry_id,))
            row = cursor.fetchone()
            return self.row_to_dict(row) if row else None

    def get_entry_by_session_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT * FROM history WHERE session_id = ?', (session_id,))
            row = cursor.fetchone()
            return self.row_to_dict(row) if row else None

    def delete_entry(self, entry_id: str) -> bool:
        with self.get_connection() as conn:
            cursor = conn.execute('DELETE FROM history WHERE id = ?', (entry_id,))
            conn.commit()
            return cursor.rowcount > 0

    def delete_entries(self, entry_ids: List[str]) -> int:
        if not entry_ids:
            return 0
        placeholders = ','.join('?' * len(entry_ids))
        with self.get_connection() as conn:
            cursor = conn.execute(f'DELETE FROM history WHERE id IN ({placeholders})', entry_ids)
            conn.commit()
            return cursor.rowcount

    def get_entries_by_status(self, status: str) -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT * FROM history WHERE status = ? ORDER BY coalesce(last_modified, date) DESC', (status,))
            return [self.row_to_dict(row) for row in cursor.fetchall()]

    def clear_all(self):
        with self.get_connection() as conn:
            conn.execute('DELETE FROM history')
            conn.commit()

    # State (Cards) Methods
    def update_session_cards(
        self, 
        session_id: str, 
        cards: List[Dict[str, Any]], 
        deck_name: Optional[str] = None,
        slide_set_name: Optional[str] = None,
        model_name: Optional[str] = None,
        tags: Optional[List[str]] = None
    ) -> bool:
        """Update the cards and metadata for a session."""
        updates = ["cards = ?"]
        params = [json.dumps(cards)]
        
        if deck_name is not None:
            updates.append("deck = ?")
            params.append(deck_name)
        if slide_set_name is not None:
            updates.append("slide_set_name = ?")
            params.append(slide_set_name)
        if model_name is not None:
            updates.append("model_name = ?")
            params.append(model_name)
        if tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(tags))
            
        updates.append("last_modified = ?")
        params.append(datetime.now().isoformat())
            
        params.append(session_id)
        
        with self.get_connection() as conn:
            cursor = conn.execute(f'UPDATE history SET {", ".join(updates)} WHERE session_id = ?', params)
            conn.commit()
            return cursor.rowcount > 0
