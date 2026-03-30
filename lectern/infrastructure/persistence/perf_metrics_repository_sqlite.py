from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path


class PerfMetricsRepositorySqlite:
    """SQLite-backed repository for client-side performance metrics."""

    def __init__(self, *, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout = 30000")
        return conn

    def _init_db(self) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS client_perf_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at_ms INTEGER NOT NULL,
                    client_ts_ms INTEGER NOT NULL,
                    session_id TEXT NOT NULL,
                    metric_name TEXT NOT NULL,
                    duration_ms REAL NOT NULL,
                    card_count INTEGER,
                    total_pages INTEGER,
                    text_chars INTEGER,
                    chars_per_page REAL,
                    model TEXT,
                    build_version TEXT,
                    build_channel TEXT,
                    document_type TEXT,
                    image_count INTEGER,
                    target_card_count INTEGER,
                    payload_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_client_perf_metrics_metric_recorded_at
                ON client_perf_metrics(metric_name, recorded_at_ms)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_client_perf_metrics_model_recorded_at
                ON client_perf_metrics(model, recorded_at_ms)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_client_perf_metrics_build_version_recorded_at
                ON client_perf_metrics(build_version, recorded_at_ms)
                """
            )
            conn.commit()

    async def ingest_client_metrics(self, payload: dict[str, object]) -> int:
        return await asyncio.to_thread(self._ingest_client_metrics_sync, payload)

    def _ingest_client_metrics_sync(self, payload: dict[str, object]) -> int:
        entries = payload.get("entries")
        if not isinstance(entries, list) or len(entries) == 0:
            return 0

        recorded_at_ms = int(time.time() * 1000)
        payload_json = json.dumps(payload, separators=(",", ":"))
        client_ts_ms = int(payload.get("client_ts_ms") or 0)
        session_id = str(payload.get("session_id") or "")

        rows: list[tuple[object, ...]] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            complexity = entry.get("complexity")
            complexity_obj = complexity if isinstance(complexity, dict) else {}
            rows.append(
                (
                    recorded_at_ms,
                    client_ts_ms,
                    session_id,
                    str(entry.get("metric_name") or ""),
                    float(entry.get("duration_ms") or 0.0),
                    complexity_obj.get("card_count"),
                    complexity_obj.get("total_pages"),
                    complexity_obj.get("text_chars"),
                    complexity_obj.get("chars_per_page"),
                    complexity_obj.get("model"),
                    complexity_obj.get("build_version"),
                    complexity_obj.get("build_channel"),
                    complexity_obj.get("document_type"),
                    complexity_obj.get("image_count"),
                    complexity_obj.get("target_card_count"),
                    payload_json,
                )
            )

        if not rows:
            return 0

        with closing(self._connect()) as conn:
            with conn:
                conn.executemany(
                    """
                    INSERT INTO client_perf_metrics (
                        recorded_at_ms,
                        client_ts_ms,
                        session_id,
                        metric_name,
                        duration_ms,
                        card_count,
                        total_pages,
                        text_chars,
                        chars_per_page,
                        model,
                        build_version,
                        build_channel,
                        document_type,
                        image_count,
                        target_card_count,
                        payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    rows,
                )
        return len(rows)
