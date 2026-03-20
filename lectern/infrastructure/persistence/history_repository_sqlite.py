from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import closing
from dataclasses import fields, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from lectern.application.ports import HistoryRepositoryPort
from lectern.domain.generation.events import (
    CardEmitted,
    CardsReplaced,
    DomainEvent,
    DomainEventRecord,
    ErrorEmitted,
    PhaseCompleted,
    PhaseStarted,
    ProgressUpdated,
    SessionCancelled,
    SessionCompleted,
    SessionStarted,
    WarningEmitted,
)

_EVENT_TYPES: dict[str, type[DomainEvent]] = {
    "SessionStarted": SessionStarted,
    "PhaseStarted": PhaseStarted,
    "ProgressUpdated": ProgressUpdated,
    "CardEmitted": CardEmitted,
    "CardsReplaced": CardsReplaced,
    "WarningEmitted": WarningEmitted,
    "ErrorEmitted": ErrorEmitted,
    "PhaseCompleted": PhaseCompleted,
    "SessionCompleted": SessionCompleted,
    "SessionCancelled": SessionCancelled,
}


class HistoryRepositorySqlite(HistoryRepositoryPort):
    """SQLite-backed history repository for event replay in v2."""

    def __init__(self, *, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    phase TEXT,
                    status TEXT,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_events (
                    session_id TEXT NOT NULL,
                    sequence_no INTEGER NOT NULL,
                    event_class TEXT NOT NULL,
                    event_payload TEXT NOT NULL,
                    PRIMARY KEY (session_id, sequence_no)
                )
                """
            )
            conn.commit()

    async def create_session(self, init: Any) -> None:
        await asyncio.to_thread(self._create_session_sync, init)

    def _create_session_sync(self, init: Any) -> None:
        payload = init if isinstance(init, dict) else {}
        session_id = str(payload.get("session_id") or "")
        if not session_id:
            raise ValueError("session_id is required")

        with closing(self._connect()) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO sessions (session_id, payload, phase, status, updated_at)
                VALUES (?, ?, ?, ?, unixepoch())
                """,
                (
                    session_id,
                    json.dumps(payload),
                    payload.get("phase"),
                    payload.get("status"),
                ),
            )
            conn.commit()

    async def update_phase(self, session_id: str, phase: str) -> None:
        await asyncio.to_thread(self._update_phase_sync, session_id, phase)

    def _update_phase_sync(self, session_id: str, phase: str) -> None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT payload FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            if row is None:
                return
            payload = json.loads(row["payload"])
            payload["phase"] = phase
            conn.execute(
                """
                UPDATE sessions
                SET payload = ?, phase = ?, updated_at = unixepoch()
                WHERE session_id = ?
                """,
                (json.dumps(payload), phase, session_id),
            )
            conn.commit()

    async def append_events(self, session_id: str, events: list[DomainEventRecord]) -> None:
        await asyncio.to_thread(self._append_events_sync, session_id, events)

    def _append_events_sync(self, session_id: str, events: list[DomainEventRecord]) -> None:
        with closing(self._connect()) as conn:
            for record in events:
                event_payload = {
                    "event_class": type(record.event).__name__,
                    "data": self._dataclass_to_dict(record.event),
                }
                conn.execute(
                    """
                    INSERT INTO session_events
                    (session_id, sequence_no, event_class, event_payload)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        int(record.sequence_no),
                        type(record.event).__name__,
                        json.dumps(event_payload),
                    ),
                )
            conn.commit()

    async def sync_state(self, snapshot: Any) -> None:
        await asyncio.to_thread(self._sync_state_sync, snapshot)

    def _sync_state_sync(self, snapshot: Any) -> None:
        payload = snapshot if isinstance(snapshot, dict) else {}
        session_id = str(payload.get("session_id") or "")
        if not session_id:
            return

        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT payload FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            current = json.loads(row["payload"]) if row else {}
            current.update(payload)
            conn.execute(
                """
                INSERT OR REPLACE INTO sessions (session_id, payload, phase, status, updated_at)
                VALUES (?, ?, ?, ?, unixepoch())
                """,
                (
                    session_id,
                    json.dumps(current),
                    current.get("phase"),
                    current.get("status"),
                ),
            )
            conn.commit()

    async def mark_terminal(self, session_id: str, status: str) -> None:
        await asyncio.to_thread(self._mark_terminal_sync, session_id, status)

    def _mark_terminal_sync(self, session_id: str, status: str) -> None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT payload FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            if row is None:
                return
            payload = json.loads(row["payload"])
            payload["status"] = status
            conn.execute(
                """
                UPDATE sessions
                SET payload = ?, status = ?, updated_at = unixepoch()
                WHERE session_id = ?
                """,
                (json.dumps(payload), status, session_id),
            )
            conn.commit()

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_session_sync, session_id)

    def _get_session_sync(self, session_id: str) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT payload FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return None if row is None else json.loads(row["payload"])

    async def get_events_after(
        self,
        session_id: str,
        *,
        after_sequence_no: int,
        limit: int = 1000,
    ) -> list[DomainEventRecord]:
        return await asyncio.to_thread(
            self._get_events_after_sync,
            session_id,
            after_sequence_no,
            limit,
        )

    def _get_events_after_sync(
        self,
        session_id: str,
        after_sequence_no: int,
        limit: int,
    ) -> list[DomainEventRecord]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT sequence_no, event_payload
                FROM session_events
                WHERE session_id = ? AND sequence_no > ?
                ORDER BY sequence_no ASC
                LIMIT ?
                """,
                (session_id, after_sequence_no, limit),
            ).fetchall()

        records: list[DomainEventRecord] = []
        for row in rows:
            payload = json.loads(row["event_payload"])
            event = self._dict_to_event(payload)
            records.append(
                DomainEventRecord(
                    session_id=session_id,
                    sequence_no=int(row["sequence_no"]),
                    event=event,
                )
            )
        return records

    def _dataclass_to_dict(self, value: Any) -> dict[str, Any]:
        if not is_dataclass(value):
            return {}
        out: dict[str, Any] = {}
        for field in fields(value):
            if not field.init:
                continue
            out[field.name] = self._to_jsonable(getattr(value, field.name))
        return out

    def _to_jsonable(self, value: Any) -> Any:
        if isinstance(value, Enum):
            return value.value
        if isinstance(value, list):
            return [self._to_jsonable(item) for item in value]
        if isinstance(value, dict):
            return {str(k): self._to_jsonable(v) for k, v in value.items()}
        return value

    def _dict_to_event(self, payload: dict[str, Any]) -> DomainEvent:
        event_class_name = str(payload.get("event_class") or "")
        event_data = payload.get("data") or {}
        event_type = _EVENT_TYPES.get(event_class_name)
        if event_type is None:
            raise ValueError(f"Unsupported event class: {event_class_name}")
        return event_type(**event_data)
