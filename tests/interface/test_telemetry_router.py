from __future__ import annotations

import json
import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient
import pytest

from gui.backend.dependencies import get_perf_metrics_repository
from gui.backend.main import app
from lectern.infrastructure.persistence.perf_metrics_repository_sqlite import (
    PerfMetricsRepositorySqlite,
)

client = TestClient(app)


def _valid_payload() -> dict:
    return {
        "client_ts_ms": 1710001234567,
        "session_id": "session-telemetry-1",
        "entries": [
            {
                "metric_name": "upload_pdf_ms",
                "duration_ms": 223.5,
                "complexity": {
                    "card_count": 12,
                    "total_pages": 20,
                    "text_chars": 4200,
                    "chars_per_page": 210.0,
                    "model": "gemini-2.5-flash",
                    "build_version": "1.2.3",
                    "build_channel": "stable",
                    "document_type": "slides",
                    "image_count": 3,
                    "target_card_count": 15,
                },
            },
            {
                "metric_name": "generate_cards_ms",
                "duration_ms": 1820,
                "complexity": {
                    "card_count": 12,
                    "total_pages": 20,
                    "text_chars": 4200,
                    "chars_per_page": 210.0,
                    "model": "gemini-2.5-flash",
                    "build_version": "1.2.3",
                    "build_channel": "stable",
                    "document_type": "slides",
                    "image_count": 3,
                    "target_card_count": 15,
                },
            },
        ],
    }


def test_post_client_metrics_persists_all_entries(tmp_path) -> None:
    db_path = tmp_path / "client_metrics.sqlite3"
    repo = PerfMetricsRepositorySqlite(db_path=db_path)
    payload = _valid_payload()

    app.dependency_overrides[get_perf_metrics_repository] = lambda: repo
    try:
        response = client.post("/metrics/client", json=payload)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "ingested_count": 2}

    with closing(sqlite3.connect(db_path)) as conn:
        rows = conn.execute(
            """
            SELECT
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
            FROM client_perf_metrics
            ORDER BY id
            """
        ).fetchall()

    assert len(rows) == 2
    first = rows[0]
    assert first[0] > 0
    assert first[1] == payload["client_ts_ms"]
    assert first[2] == payload["session_id"]
    assert first[3] == "upload_pdf_ms"
    assert first[4] == 223.5
    assert first[5] == 12
    assert first[6] == 20
    assert first[7] == 4200
    assert first[8] == 210.0
    assert first[9] == "gemini-2.5-flash"
    assert first[10] == "1.2.3"
    assert first[11] == "stable"
    assert first[12] == "slides"
    assert first[13] == 3
    assert first[14] == 15
    assert json.loads(first[15]) == payload["entries"][0]

    second = rows[1]
    assert second[3] == "generate_cards_ms"
    assert second[4] == 1820
    assert json.loads(second[15]) == payload["entries"][1]


def test_post_client_metrics_initializes_required_indexes(tmp_path) -> None:
    db_path = tmp_path / "client_metrics.sqlite3"
    repo = PerfMetricsRepositorySqlite(db_path=db_path)

    app.dependency_overrides[get_perf_metrics_repository] = lambda: repo
    try:
        response = client.post(
            "/metrics/client",
            json={
                "client_ts_ms": 1710001234567,
                "session_id": "session-telemetry-2",
                "entries": [
                    {
                        "metric_name": "estimate_ms",
                        "duration_ms": 120,
                        "complexity": {
                            "model": "gemini-2.5-flash",
                            "build_version": "1.2.3",
                        },
                    }
                ],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200

    with closing(sqlite3.connect(db_path)) as conn:
        indexes = conn.execute("PRAGMA index_list('client_perf_metrics')").fetchall()
        index_names = {row[1] for row in indexes}

    assert "idx_client_perf_metrics_metric_recorded_at" in index_names
    assert "idx_client_perf_metrics_model_recorded_at" in index_names
    assert "idx_client_perf_metrics_build_version_recorded_at" in index_names


@pytest.mark.parametrize(
    ("mutator",),
    [
        (lambda payload: payload["entries"].__setitem__(0, {**payload["entries"][0], "duration_ms": -1}),),
        (lambda payload: payload["entries"].__setitem__(0, {**payload["entries"][0], "metric_name": ""}),),
        (lambda payload: payload.__setitem__("entries", []),),
    ],
)
def test_post_client_metrics_rejects_invalid_payloads(mutator) -> None:
    payload = _valid_payload()
    mutator(payload)

    response = client.post("/metrics/client", json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize("token", ["Infinity", "-Infinity", "NaN"])
def test_post_client_metrics_rejects_non_finite_duration(token: str) -> None:
    response = client.post(
        "/metrics/client",
        content=(
            "{"
            '"client_ts_ms":1710001234567,'
            '"session_id":"session-telemetry-1",'
            '"entries":[{"metric_name":"upload_pdf_ms","duration_ms":'
            f"{token}"
            ',"complexity":{}}]'
            "}"
        ),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422


def test_post_client_metrics_rejects_duration_overflow() -> None:
    response = client.post(
        "/metrics/client",
        content=(
            "{"
            '"client_ts_ms":1710001234567,'
            '"session_id":"session-telemetry-1",'
            '"entries":[{"metric_name":"upload_pdf_ms","duration_ms":1e10000,"complexity":{}}]'
            "}"
        ),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "invalid_input",
        "field": "entries[0].duration_ms",
        "reason": "must_be_finite_non_negative",
    }


@pytest.mark.parametrize(
    "complexity_field",
    [
        "card_count",
        "total_pages",
        "text_chars",
        "chars_per_page",
        "image_count",
        "target_card_count",
    ],
)
def test_post_client_metrics_rejects_negative_complexity_values(complexity_field: str) -> None:
    payload = _valid_payload()
    payload["entries"][0]["complexity"][complexity_field] = -1

    response = client.post("/metrics/client", json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize(
    "mutator",
    [
        lambda payload: payload.__setitem__("unexpected", "x"),
        lambda payload: payload["entries"][0].__setitem__("unexpected", "x"),
        lambda payload: payload["entries"][0]["complexity"].__setitem__("unexpected", "x"),
    ],
)
def test_post_client_metrics_rejects_unknown_fields(mutator) -> None:
    payload = _valid_payload()
    mutator(payload)

    response = client.post("/metrics/client", json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize(
    "mutator",
    [
        lambda payload: payload.__setitem__("client_ts_ms", "1710001234567"),
        lambda payload: payload["entries"][0].__setitem__("duration_ms", "223.5"),
        lambda payload: payload["entries"][0]["complexity"].__setitem__("card_count", "12"),
    ],
)
def test_post_client_metrics_rejects_type_coercion(mutator) -> None:
    payload = _valid_payload()
    mutator(payload)

    response = client.post("/metrics/client", json=payload)

    assert response.status_code == 422


def test_post_client_metrics_rejects_oversized_session_id() -> None:
    payload = _valid_payload()
    payload["session_id"] = "s" * 129

    response = client.post("/metrics/client", json=payload)

    assert response.status_code == 422


def test_post_client_metrics_rejects_oversized_metric_name() -> None:
    payload = _valid_payload()
    payload["entries"][0]["metric_name"] = "m" * 129

    response = client.post("/metrics/client", json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize("timestamp", [946684799999, 4102444800001])
def test_post_client_metrics_rejects_implausible_client_timestamp(timestamp: int) -> None:
    payload = _valid_payload()
    payload["client_ts_ms"] = timestamp

    response = client.post("/metrics/client", json=payload)

    assert response.status_code == 422
