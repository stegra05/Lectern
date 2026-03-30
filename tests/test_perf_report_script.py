from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

from lectern.infrastructure.persistence.perf_metrics_repository_sqlite import (
    PerfMetricsRepositorySqlite,
)


def _seed_metrics(db_path: Path) -> None:
    repo = PerfMetricsRepositorySqlite(db_path=db_path)
    payload = {
        "client_ts_ms": 1710001234567,
        "session_id": "report-session",
        "entries": [
            {
                "metric_name": "estimate_total_duration",
                "duration_ms": 1200,
                "complexity": {
                    "card_count": 60,
                    "total_pages": 30,
                    "text_chars": 18000,
                    "chars_per_page": 600,
                    "model": "gemini-2.5-flash",
                    "build_version": "1.4.0",
                    "build_channel": "stable",
                },
            },
            {
                "metric_name": "generation_total_duration",
                "duration_ms": 4200,
                "complexity": {
                    "card_count": 140,
                    "total_pages": 70,
                    "text_chars": 63000,
                    "chars_per_page": 900,
                    "model": "gemini-2.5-pro",
                    "build_version": "1.4.0",
                    "build_channel": "stable",
                },
            },
            {
                "metric_name": "generation_time_to_first_card",
                "duration_ms": 1800,
                "complexity": {
                    "card_count": 140,
                    "total_pages": 70,
                    "text_chars": 63000,
                    "chars_per_page": 900,
                    "model": "gemini-2.5-pro",
                    "build_version": "1.4.0",
                    "build_channel": "stable",
                },
            },
        ],
    }
    asyncio.run(repo.ingest_client_metrics(payload))


def test_perf_report_outputs_p95_table(tmp_path: Path) -> None:
    db_path = tmp_path / "telemetry.sqlite3"
    _seed_metrics(db_path)

    repo_root = Path(__file__).resolve().parents[1]
    script_path = repo_root / "scripts" / "perf_report.py"
    result = subprocess.run(
        [sys.executable, str(script_path), "--db-path", str(db_path), "--window-hours", "168"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    stdout = result.stdout
    assert "metric_name" in stdout
    assert "p95_ms" in stdout
    assert "estimate_total_duration" in stdout
    assert "generation_total_duration" in stdout
    assert "generation_time_to_first_card" in stdout
    assert "gemini-2.5-pro" in stdout
    assert "101-200" in stdout
