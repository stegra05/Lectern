import sqlite3
import json
import logging
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Generator
import uuid
import os

from lectern.utils.path_utils import get_app_data_dir

logger = logging.getLogger(__name__)

# Current database schema version - increment when making schema changes
DB_SCHEMA_VERSION = 5


def get_db_path() -> Path:
    """Return the path to the SQLite database file."""
    app_data = get_app_data_dir()
    app_data.mkdir(parents=True, exist_ok=True)
    return app_data / "lectern.db"


class DatabaseManager:
    """Thread-safe SQLite database manager with connection pooling.

    Uses a singleton pattern with thread-safe initialization.
    Connections are created per-thread to avoid SQLite threading issues.
    """

    _instance: Optional["DatabaseManager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "DatabaseManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._init_db()
            return cls._instance

    def _init_db(self) -> None:
        """Initialize database schema and run migrations if needed."""
        self.db_path = get_db_path()

        with self.get_connection() as conn:
            # Enable WAL mode for better concurrent read/write performance
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")

            # Create schema_version table for migrations
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )
            """
            )

            # Get current schema version
            cursor = conn.execute(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version"
            )
            current_version = cursor.fetchone()[0]

            # Run migrations if needed
            if current_version < DB_SCHEMA_VERSION:
                self._run_migrations(conn, current_version)

            # Create main tables (idempotent)
            conn.execute(
                """
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
                    slide_set_name TEXT,
                    logs TEXT,
                    total_pages INTEGER,
                    coverage_data TEXT,
                    current_phase TEXT,
                    source_file_name TEXT,
                    source_pdf_sha256 TEXT
                )
            """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_session_id ON history(session_id)"
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON history(status)")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_last_modified ON history(last_modified)"
            )

            conn.commit()

    def _run_migrations(self, conn: sqlite3.Connection, from_version: int) -> None:
        """Run database migrations from the given version to current."""
        for version in range(from_version + 1, DB_SCHEMA_VERSION + 1):
            logger.info(f"Running database migration to version {version}")
            if version == 2:
                self._add_column_if_missing(conn, "history", "logs", "TEXT")
            elif version == 3:
                self._add_column_if_missing(conn, "history", "total_pages", "INTEGER")
                self._add_column_if_missing(conn, "history", "coverage_data", "TEXT")
            elif version == 4:
                self._add_column_if_missing(conn, "history", "current_phase", "TEXT")
            elif version == 5:
                self._add_column_if_missing(conn, "history", "source_file_name", "TEXT")
                self._add_column_if_missing(
                    conn, "history", "source_pdf_sha256", "TEXT"
                )

            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (version, datetime.now().isoformat()),
            )

        logger.info(
            f"Database migrated from version {from_version} to {DB_SCHEMA_VERSION}"
        )

    def _table_exists(self, conn: sqlite3.Connection, table_name: str) -> bool:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        )
        return cursor.fetchone() is not None

    def _column_exists(
        self, conn: sqlite3.Connection, table_name: str, column_name: str
    ) -> bool:
        if not self._table_exists(conn, table_name):
            return False
        cursor = conn.execute(f"PRAGMA table_info({table_name})")
        return any(row[1] == column_name for row in cursor.fetchall())

    def _add_column_if_missing(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        column_name: str,
        column_type: str,
    ) -> None:
        if self._column_exists(conn, table_name, column_name):
            return
        if not self._table_exists(conn, table_name):
            return
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")

    def _get_raw_connection(self) -> sqlite3.Connection:
        """Create a new database connection (internal use)."""
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = None  # Use default tuple factory
        return conn

    @contextmanager
    def get_connection(self) -> Generator[sqlite3.Connection, None, None]:
        """Context manager for database connections.

        Ensures connections are properly closed after use.
        Uses WAL mode for better concurrency.
        """
        conn = self._get_raw_connection()
        try:
            yield conn
        finally:
            conn.close()

    def vacuum(self) -> None:
        """Optimize database by running VACUUM.

        Should be called after bulk deletions or migrations.
        Note: VACUUM locks the database, so use sparingly.
        """
        with self.get_connection() as conn:
            conn.execute("VACUUM")
            logger.info("Database VACUUM completed")

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
            "logs": json.loads(row[13]) if len(row) > 13 and row[13] else [],
            "total_pages": row[14] if len(row) > 14 else None,
            "coverage_data": json.loads(row[15]) if len(row) > 15 and row[15] else None,
            "current_phase": row[16] if len(row) > 16 else None,
            "source_file_name": row[17] if len(row) > 17 else None,
            "source_pdf_sha256": row[18] if len(row) > 18 else None,
        }

    # History Methods
    def get_all_history(self) -> List[Dict[str, Any]]:
        """Return all history entries, sorted by most recent activity."""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM history ORDER BY coalesce(last_modified, date) DESC LIMIT 500"
            )
            return [self.row_to_dict(row) for row in cursor.fetchall()]

    def add_history(
        self,
        filename: str,
        deck: str,
        session_id: Optional[str] = None,
        status: str = "draft",
        source_file_name: Optional[str] = None,
        source_pdf_sha256: Optional[str] = None,
    ) -> str:
        """Create a new history entry and return its ID."""
        entry_id = str(uuid.uuid4())
        final_session_id = session_id if session_id else entry_id
        now = datetime.now().isoformat()
        final_source_file_name = source_file_name or os.path.basename(filename)

        with self.get_connection() as conn:
            conn.execute(
                """
                INSERT INTO history (
                    id, session_id, filename, full_path, deck, date, last_modified,
                    status, card_count, source_file_name, source_pdf_sha256
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry_id,
                    final_session_id,
                    os.path.basename(filename),
                    os.path.abspath(filename),
                    deck,
                    now,
                    now,
                    status,
                    0,
                    final_source_file_name,
                    source_pdf_sha256,
                ),
            )
            conn.commit()
        return entry_id

    def update_history(
        self,
        entry_id: str,
        status: Optional[str] = None,
        card_count: Optional[int] = None,
    ) -> bool:
        """Update an existing history entry. Returns True if updated."""
        updates: List[str] = []
        params: List[Any] = []

        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if card_count is not None:
            updates.append("card_count = ?")
            params.append(card_count)

        if not updates:
            return False

        updates.append("last_modified = ?")
        params.append(datetime.now().isoformat())
        params.append(entry_id)

        with self.get_connection() as conn:
            cursor = conn.execute(
                f'UPDATE history SET {", ".join(updates)} WHERE id = ?', params
            )
            conn.commit()
            return cursor.rowcount > 0

    def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        """Get a history entry by ID."""
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM history WHERE id = ?", (entry_id,))
            row = cursor.fetchone()
            return self.row_to_dict(row) if row else None

    def get_entry_by_session_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get a history entry by session ID."""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM history WHERE session_id = ?", (session_id,)
            )
            row = cursor.fetchone()
            return self.row_to_dict(row) if row else None

    def delete_entry(self, entry_id: str) -> bool:
        """Delete a specific history entry. Returns True if deleted."""
        with self.get_connection() as conn:
            cursor = conn.execute("DELETE FROM history WHERE id = ?", (entry_id,))
            conn.commit()
            return cursor.rowcount > 0

    def delete_entries(self, entry_ids: List[str]) -> int:
        """Delete multiple history entries. Returns count of deleted entries."""
        if not entry_ids:
            return 0
        placeholders = ",".join("?" * len(entry_ids))
        with self.get_connection() as conn:
            cursor = conn.execute(
                f"DELETE FROM history WHERE id IN ({placeholders})", entry_ids
            )
            conn.commit()
            return cursor.rowcount

    def get_entries_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Return all history entries matching the given status."""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM history WHERE status = ? ORDER BY coalesce(last_modified, date) DESC",
                (status,),
            )
            return [self.row_to_dict(row) for row in cursor.fetchall()]

    def clear_all(self) -> int:
        """Clear all history entries. Returns count of deleted rows."""
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM history")
            count = cursor.fetchone()[0]
            conn.execute("DELETE FROM history")
            conn.commit()
            return count

    # Session Cards Methods
    def update_session_cards(
        self,
        session_id: str,
        cards: List[Dict[str, Any]],
        deck_name: Optional[str] = None,
        slide_set_name: Optional[str] = None,
        model_name: Optional[str] = None,
        tags: Optional[List[str]] = None,
        total_pages: Optional[int] = None,
        coverage_data: Optional[Dict[str, Any]] = None,
        source_file_name: Optional[str] = None,
        source_pdf_sha256: Optional[str] = None,
    ) -> bool:
        """Update the cards and metadata for a session. Returns True if updated."""
        updates: List[str] = ["cards = ?"]
        params: List[Any] = [json.dumps(cards)]

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
        if total_pages is not None:
            updates.append("total_pages = ?")
            params.append(total_pages)
        if coverage_data is not None:
            updates.append("coverage_data = ?")
            params.append(json.dumps(coverage_data))
        if source_file_name is not None:
            updates.append("source_file_name = ?")
            params.append(source_file_name)
        if source_pdf_sha256 is not None:
            updates.append("source_pdf_sha256 = ?")
            params.append(source_pdf_sha256)

        updates.append("last_modified = ?")
        params.append(datetime.now().isoformat())
        params.append(session_id)

        with self.get_connection() as conn:
            cursor = conn.execute(
                f'UPDATE history SET {", ".join(updates)} WHERE session_id = ?', params
            )
            conn.commit()
            return cursor.rowcount > 0

    def update_session_logs(self, session_id: str, logs: List[Dict[str, Any]]) -> bool:
        """Update the logs for a session. Returns True if updated."""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "UPDATE history SET logs = ?, last_modified = ? WHERE session_id = ?",
                (json.dumps(logs), datetime.now().isoformat(), session_id),
            )
            conn.commit()
            return cursor.rowcount > 0

    def update_session_phase(self, session_id: str, phase: str) -> bool:
        """Update the current phase for a session. Returns True if updated."""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "UPDATE history SET current_phase = ?, last_modified = ? WHERE session_id = ?",
                (phase, datetime.now().isoformat(), session_id),
            )
            conn.commit()
            return cursor.rowcount > 0

    def recover_interrupted_sessions(
        self, interrupted_status: str = "interrupted"
    ) -> int:
        """Mark stale in-flight draft sessions as interrupted.

        A session is considered stale in-flight when it is still in draft status
        but has a non-terminal current_phase from a previous process run.
        """
        with self.get_connection() as conn:
            cursor = conn.execute(
                """
                UPDATE history
                SET status = ?, current_phase = 'idle', last_modified = ?
                WHERE status = 'draft'
                  AND current_phase IS NOT NULL
                  AND current_phase NOT IN ('idle', 'complete')
                """,
                (interrupted_status, datetime.now().isoformat()),
            )
            conn.commit()
            return cursor.rowcount
