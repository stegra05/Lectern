from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from lectern.utils.path_utils import get_app_data_dir


def _default_db_path() -> Path:
    return get_app_data_dir() / "state" / "telemetry.sqlite3"


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


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    rank = int((percentile / 100.0) * len(sorted_values))
    index = max(0, min(len(sorted_values) - 1, rank - 1))
    return float(sorted_values[index])


def _fmt_number(value: float | int | None) -> str:
    if value is None:
        return "-"
    if isinstance(value, int):
        return str(value)
    return f"{value:.1f}"


def _collect_rows(db_path: Path, metric_name: str, window_hours: int) -> list[sqlite3.Row]:
    cutoff_ms = int(time.time() * 1000) - (window_hours * 60 * 60 * 1000)
    with closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            """
            SELECT duration_ms, model, card_count
            FROM client_perf_metrics
            WHERE metric_name = ? AND recorded_at_ms >= ?
            """,
            (metric_name, cutoff_ms),
        ).fetchall()


def _render_metric_table(db_path: Path, metric_name: str, window_hours: int) -> str:
    rows = _collect_rows(db_path, metric_name, window_hours)
    groups: dict[tuple[str, str], list[float]] = {}
    for row in rows:
        model = row["model"] if isinstance(row["model"], str) and row["model"] else "unknown"
        bucket = _bucket_card_count(
            int(row["card_count"]) if row["card_count"] is not None else None
        )
        groups.setdefault((model, bucket), []).append(float(row["duration_ms"]))

    lines = [
        f"\n[{metric_name}]",
        "metric_name | model | card_count_bucket | count | p50_ms | p95_ms | max_ms",
    ]

    if not groups:
        lines.append(f"{metric_name} | - | - | 0 | - | - | -")
        return "\n".join(lines)

    sorted_groups = sorted(
        groups.items(),
        key=lambda item: (
            -(_percentile(item[1], 95) or -1.0),
            -len(item[1]),
            item[0][0],
            item[0][1],
        ),
    )
    for (model, bucket), durations in sorted_groups:
        p50 = _percentile(durations, 50)
        p95 = _percentile(durations, 95)
        max_v = max(durations) if durations else None
        lines.append(
            f"{metric_name} | {model} | {bucket} | {len(durations)} | "
            f"{_fmt_number(p50)} | {_fmt_number(p95)} | {_fmt_number(max_v)}"
        )

    return "\n".join(lines)


def build_report(db_path: Path, window_hours: int) -> str:
    metrics = [
        "estimate_total_duration",
        "generation_total_duration",
        "generation_time_to_first_card",
    ]
    header = [
        "Lectern performance report",
        f"db_path: {db_path}",
        f"window_hours: {window_hours}",
    ]
    sections = [_render_metric_table(db_path, metric, window_hours) for metric in metrics]
    return "\n".join(header + sections) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Print telemetry p95 report grouped by model and card complexity."
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=_default_db_path(),
        help="Path to telemetry sqlite DB (default: app-data state/telemetry.sqlite3).",
    )
    parser.add_argument(
        "--window-hours",
        type=int,
        default=24 * 7,
        help="Lookback window in hours (default: 168).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.window_hours < 1:
        raise SystemExit("--window-hours must be >= 1")
    if not args.db_path.exists():
        raise SystemExit(f"Telemetry DB not found: {args.db_path}")
    print(build_report(args.db_path, args.window_hours), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
