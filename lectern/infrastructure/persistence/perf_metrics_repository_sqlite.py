from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any


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

    async def get_metrics_summary(
        self, *, metric_name: str, window_hours: int
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._get_metrics_summary_sync, metric_name, window_hours
        )

    async def get_metrics_patterns(
        self, *, metric_name: str, window_hours: int, limit: int = 10
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._get_metrics_patterns_sync, metric_name, window_hours, limit
        )

    def _ingest_client_metrics_sync(self, payload: dict[str, object]) -> int:
        client_ts_ms = payload["client_ts_ms"]
        session_id = payload["session_id"]
        entries = payload["entries"]

        recorded_at_ms = int(time.time() * 1000)

        rows: list[tuple[object, ...]] = []
        for entry in entries:
            complexity = entry.get("complexity")
            complexity_obj = complexity if isinstance(complexity, dict) else complexity.model_dump()
            payload_json = json.dumps(entry, separators=(",", ":"), allow_nan=False)
            rows.append(
                (
                    recorded_at_ms,
                    int(client_ts_ms),
                    str(session_id),
                    entry["metric_name"],
                    entry["duration_ms"],
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

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float | None:
        if not values:
            return None
        sorted_values = sorted(values)
        rank = int((percentile / 100.0) * len(sorted_values))
        index = max(0, min(len(sorted_values) - 1, rank - 1))
        return float(sorted_values[index])

    @classmethod
    def _build_stats(cls, values: list[float]) -> dict[str, float | int | None]:
        if not values:
            return {"count": 0, "p50": None, "p90": None, "p95": None, "max": None}
        sorted_values = sorted(values)
        return {
            "count": len(sorted_values),
            "p50": cls._percentile(sorted_values, 50),
            "p90": cls._percentile(sorted_values, 90),
            "p95": cls._percentile(sorted_values, 95),
            "max": float(sorted_values[-1]),
        }

    @staticmethod
    def _bucket_card_count(value: int | None) -> str:
        if value is None:
            return "unknown"
        if value <= 50:
            return "0-50"
        if value <= 100:
            return "51-100"
        if value <= 200:
            return "101-200"
        return "200+"

    @staticmethod
    def _bucket_pages(value: int | None) -> str:
        if value is None:
            return "unknown"
        if value <= 20:
            return "0-20"
        if value <= 50:
            return "21-50"
        if value <= 100:
            return "51-100"
        return "100+"

    @staticmethod
    def _bucket_chars_per_page(value: float | None) -> str:
        if value is None:
            return "unknown"
        if value <= 500:
            return "0-500"
        if value <= 1000:
            return "501-1000"
        return "1000+"

    def _query_metric_rows_sync(
        self, *, metric_name: str, window_hours: int
    ) -> list[sqlite3.Row]:
        cutoff_ms = int(time.time() * 1000) - (window_hours * 60 * 60 * 1000)
        with closing(self._connect()) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT
                    duration_ms,
                    model,
                    build_version,
                    build_channel,
                    card_count,
                    total_pages,
                    chars_per_page
                FROM client_perf_metrics
                WHERE metric_name = ?
                  AND recorded_at_ms >= ?
                """,
                (metric_name, cutoff_ms),
            ).fetchall()
        return rows

    @classmethod
    def _sorted_groups(
        cls, groups: dict[str, list[float]], *, key_name: str
    ) -> list[dict[str, float | int | str | None]]:
        items: list[dict[str, float | int | str | None]] = []
        for group_key, durations in groups.items():
            stats = cls._build_stats(durations)
            items.append({key_name: group_key, **stats})
        items.sort(
            key=lambda item: (
                -(item["p95"] if isinstance(item["p95"], (int, float)) else -1.0),
                -int(item["count"]),
                str(item[key_name]),
            )
        )
        return items

    def _get_metrics_summary_sync(
        self, metric_name: str, window_hours: int
    ) -> dict[str, Any]:
        rows = self._query_metric_rows_sync(
            metric_name=metric_name, window_hours=window_hours
        )
        durations = [float(row["duration_ms"]) for row in rows]

        by_model: dict[str, list[float]] = {}
        by_build: dict[tuple[str, str], list[float]] = {}
        by_card_count_bucket: dict[str, list[float]] = {}
        by_pages_bucket: dict[str, list[float]] = {}
        by_chars_per_page_bucket: dict[str, list[float]] = {}

        for row in rows:
            duration = float(row["duration_ms"])
            model = row["model"] if isinstance(row["model"], str) and row["model"] else "unknown"
            build_version = (
                row["build_version"]
                if isinstance(row["build_version"], str) and row["build_version"]
                else "unknown"
            )
            build_channel = (
                row["build_channel"]
                if isinstance(row["build_channel"], str) and row["build_channel"]
                else "unknown"
            )
            card_bucket = self._bucket_card_count(
                int(row["card_count"]) if row["card_count"] is not None else None
            )
            pages_bucket = self._bucket_pages(
                int(row["total_pages"]) if row["total_pages"] is not None else None
            )
            chars_bucket = self._bucket_chars_per_page(
                float(row["chars_per_page"])
                if row["chars_per_page"] is not None
                else None
            )

            by_model.setdefault(model, []).append(duration)
            by_build.setdefault((build_version, build_channel), []).append(duration)
            by_card_count_bucket.setdefault(card_bucket, []).append(duration)
            by_pages_bucket.setdefault(pages_bucket, []).append(duration)
            by_chars_per_page_bucket.setdefault(chars_bucket, []).append(duration)

        build_groups: list[dict[str, float | int | str | None]] = []
        for (build_version, build_channel), values in by_build.items():
            build_groups.append(
                {
                    "build_version": build_version,
                    "build_channel": build_channel,
                    **self._build_stats(values),
                }
            )
        build_groups.sort(
            key=lambda item: (
                -(item["p95"] if isinstance(item["p95"], (int, float)) else -1.0),
                -int(item["count"]),
                str(item["build_version"]),
                str(item["build_channel"]),
            )
        )

        return {
            "metric_name": metric_name,
            "window_hours": window_hours,
            "overall": self._build_stats(durations),
            "groups": {
                "by_model": self._sorted_groups(by_model, key_name="model"),
                "by_build": build_groups,
                "by_card_count_bucket": self._sorted_groups(
                    by_card_count_bucket, key_name="bucket"
                ),
                "by_pages_bucket": self._sorted_groups(
                    by_pages_bucket, key_name="bucket"
                ),
                "by_chars_per_page_bucket": self._sorted_groups(
                    by_chars_per_page_bucket, key_name="bucket"
                ),
            },
        }

    def _get_metrics_patterns_sync(
        self, metric_name: str, window_hours: int, limit: int
    ) -> dict[str, Any]:
        summary = self._get_metrics_summary_sync(metric_name, window_hours)

        worst_segments: list[dict[str, Any]] = []
        for group in summary["groups"]["by_model"]:
            worst_segments.append(
                {
                    "dimension": "model",
                    "segment": group["model"],
                    "count": group["count"],
                    "p50": group["p50"],
                    "p95": group["p95"],
                    "max": group["max"],
                }
            )
        for group in summary["groups"]["by_build"]:
            worst_segments.append(
                {
                    "dimension": "build",
                    "segment": f"{group['build_version']}@{group['build_channel']}",
                    "count": group["count"],
                    "p50": group["p50"],
                    "p95": group["p95"],
                    "max": group["max"],
                    "build_version": group["build_version"],
                    "build_channel": group["build_channel"],
                }
            )
        for group in summary["groups"]["by_card_count_bucket"]:
            worst_segments.append(
                {
                    "dimension": "card_count_bucket",
                    "segment": group["bucket"],
                    "count": group["count"],
                    "p50": group["p50"],
                    "p95": group["p95"],
                    "max": group["max"],
                }
            )
        for group in summary["groups"]["by_pages_bucket"]:
            worst_segments.append(
                {
                    "dimension": "pages_bucket",
                    "segment": group["bucket"],
                    "count": group["count"],
                    "p50": group["p50"],
                    "p95": group["p95"],
                    "max": group["max"],
                }
            )
        for group in summary["groups"]["by_chars_per_page_bucket"]:
            worst_segments.append(
                {
                    "dimension": "chars_per_page_bucket",
                    "segment": group["bucket"],
                    "count": group["count"],
                    "p50": group["p50"],
                    "p95": group["p95"],
                    "max": group["max"],
                }
            )

        worst_segments.sort(
            key=lambda item: (
                -(item["p95"] if isinstance(item["p95"], (int, float)) else -1.0),
                -int(item["count"]),
                str(item["dimension"]),
                str(item["segment"]),
            )
        )

        return {
            "metric_name": metric_name,
            "window_hours": window_hours,
            "overall": summary["overall"],
            "worst_segments": worst_segments[:limit],
        }
