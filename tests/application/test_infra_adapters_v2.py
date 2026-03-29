from __future__ import annotations

import asyncio
from contextlib import closing
from pathlib import Path
import sqlite3
from typing import Any

import pytest

from lectern.domain.generation.events import DomainEventRecord, WarningEmitted
from lectern.infrastructure.extractors.pdf_extractor import (
    PDFMetadata,
    PdfExtractorAdapter,
)
from lectern.infrastructure.gateways.anki_gateway import AnkiGateway
from lectern.infrastructure.persistence.history_repository_sqlite import (
    HistoryRepositoryCorruptionError,
    HistoryRepositorySqlite,
)
from lectern.infrastructure.providers.gemini_adapter import GeminiAdapter
from lectern.infrastructure.runtime.session_runtime_store import SessionRuntimeStore
from lectern.utils.note_export import ExportResult


@pytest.mark.asyncio
async def test_pdf_extractor_adapter_maps_extract_pdf_metadata_to_typed_metadata(
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "deck.pdf"
    pdf_path.write_bytes(b"%PDF-1.7\n")

    calls: list[str] = []

    def fake_extract(path: str) -> dict[str, int]:
        calls.append(path)
        return {
            "page_count": 7,
            "text_chars": 4200,
            "image_count": 3,
        }

    adapter = PdfExtractorAdapter(extractor=fake_extract)

    metadata = await adapter.extract_metadata(str(pdf_path))

    assert calls == [str(pdf_path)]
    assert isinstance(metadata, PDFMetadata)
    assert metadata.path == str(pdf_path)
    assert metadata.filename == "deck"
    assert metadata.title == "deck"
    assert metadata.file_size == len(b"%PDF-1.7\n")
    assert metadata.page_count == 7
    assert metadata.text_chars == 4200
    assert metadata.image_count == 3
    assert metadata.metadata_pages == 7
    assert metadata.metadata_chars == 4200


@pytest.mark.asyncio
async def test_pdf_extractor_adapter_handles_file_stat_race(
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "missing-after-parse.pdf"

    def fake_extract(path: str) -> dict[str, int]:
        Path(path).write_bytes(b"temporary")
        Path(path).unlink()
        return {
            "page_count": 1,
            "text_chars": 25,
            "image_count": 0,
        }

    adapter = PdfExtractorAdapter(extractor=fake_extract)

    metadata = await adapter.extract_metadata(str(pdf_path))

    assert metadata.file_size == 0
    assert metadata.page_count == 1
    assert metadata.text_chars == 25


class _StubGeminiProvider:
    def __init__(self) -> None:
        self.generate_calls: list[dict[str, Any]] = []
        self.reflect_calls: list[dict[str, Any]] = []
        self.repair_calls: list[dict[str, Any]] = []
        self._warnings: list[str] = ["provider-warning-1", "provider-warning-2"]

    async def upload_document(self, pdf_path: str) -> dict[str, str]:
        return {"uri": f"gs://{Path(pdf_path).name}", "mime_type": "application/pdf"}

    async def build_concept_map(
        self,
        *,
        file_uri: str,
        mime_type: str = "application/pdf",
    ) -> dict[str, Any]:
        return {
            "objectives": ["Understand architecture"],
            "concepts": [{"id": "c1", "name": "Ports"}],
            "relations": [{"source": "c1", "target": "c1", "type": "self"}],
            "language": "en",
            "slide_set_name": "Deck A",
            "page_count": 12,
            "estimated_text_chars": 7000,
            "document_type": "slides",
        }

    async def generate_cards(self, **kwargs: Any) -> dict[str, Any]:
        self.generate_calls.append(kwargs)
        return {
            "cards": [{"uid": "g-1", "front": "Q", "back": "A"}],
            "done": False,
            "parse_error": "",
        }

    async def reflect_cards(self, **kwargs: Any) -> dict[str, Any]:
        self.reflect_calls.append(kwargs)
        return {
            "reflection": "Looks good",
            "cards": [{"uid": "r-1", "front": "Q2", "back": "A2"}],
            "done": True,
            "parse_error": "",
        }

    async def repair_card(
        self,
        *,
        card: dict[str, Any],
        reasons: list[str],
        context: Any = None,
    ) -> dict[str, Any]:
        self.repair_calls.append(
            {
                "card": card,
                "reasons": reasons,
                "context": context,
            }
        )
        return {
            "card": {"uid": "fixed-1", "front": "Fixed Q", "back": "Fixed A"},
            "parse_error": "",
        }

    def drain_warnings(self) -> list[str]:
        warnings = list(self._warnings)
        self._warnings = []
        return warnings


@pytest.mark.asyncio
async def test_gemini_adapter_returns_typed_concept_map_result() -> None:
    provider = _StubGeminiProvider()
    adapter = GeminiAdapter(provider=provider)

    concept_map = await adapter.build_concept_map(
        "gs://slides.pdf",
        "application/pdf",
    )

    assert concept_map == {
        "objectives": ["Understand architecture"],
        "concepts": [{"id": "c1", "name": "Ports"}],
        "relations": [{"source": "c1", "target": "c1", "type": "self"}],
        "language": "en",
        "slide_set_name": "Deck A",
        "page_count": 12,
        "estimated_text_chars": 7000,
        "document_type": "slides",
    }


@pytest.mark.asyncio
async def test_gemini_adapter_maps_provider_results_and_warnings() -> None:
    provider = _StubGeminiProvider()
    adapter = GeminiAdapter(provider=provider)

    generate_context = {
        "examples": "Example cards",
        "avoid_fronts": ["Known Q"],
        "covered_slides": [1, 2],
        "pacing_hint": "slow down",
        "all_card_fronts": ["Known Q", "Known Q2"],
        "coverage_gap_text": "Need more on topic X",
    }

    generate_result = await adapter.generate_cards(limit=5, context=generate_context)

    assert provider.generate_calls == [
        {
            "limit": 5,
            "examples": "Example cards",
            "avoid_fronts": ["Known Q"],
            "covered_slides": [1, 2],
            "pacing_hint": "slow down",
            "all_card_fronts": ["Known Q", "Known Q2"],
            "coverage_gap_text": "Need more on topic X",
        }
    ]
    assert generate_result["cards"][0]["uid"] == "g-1"
    assert generate_result["warnings"] == ["provider-warning-1", "provider-warning-2"]

    provider._warnings = ["provider-warning-reflect"]

    reflect_context = {
        "all_card_fronts": ["Known Q", "Known Q2"],
        "cards_to_refine_json": "[]",
        "coverage_gaps": "none",
    }

    reflect_result = await adapter.reflect_cards(limit=3, context=reflect_context)

    assert provider.reflect_calls == [
        {
            "limit": 3,
            "all_card_fronts": ["Known Q", "Known Q2"],
            "cards_to_refine_json": "[]",
            "coverage_gaps": "none",
        }
    ]
    assert reflect_result["reflection"] == "Looks good"
    assert reflect_result["warnings"] == ["provider-warning-reflect"]


@pytest.mark.asyncio
async def test_gemini_adapter_maps_repair_card_and_warnings() -> None:
    provider = _StubGeminiProvider()
    adapter = GeminiAdapter(provider=provider)
    provider._warnings = ["repair-warning"]

    result = await adapter.repair_card(
        card={"front": "Q", "back": "A"},
        reasons=["missing_source_excerpt"],
        context={"strict": False},
    )

    assert provider.repair_calls == [
        {
            "card": {"front": "Q", "back": "A"},
            "reasons": ["missing_source_excerpt"],
            "context": {"strict": False},
        }
    ]
    assert result["card"]["uid"] == "fixed-1"
    assert result["warnings"] == ["repair-warning"]


@pytest.mark.asyncio
async def test_anki_gateway_adapter_maps_export_result_shape() -> None:
    calls: list[dict[str, Any]] = []

    async def fake_check_ready() -> bool:
        return True

    async def fake_export(**kwargs: Any) -> ExportResult:
        calls.append(kwargs)
        return ExportResult(success=True, note_id=42, error=None)

    adapter = AnkiGateway(
        check_ready_fn=fake_check_ready,
        export_card_fn=fake_export,
    )

    request = {
        "card": {"front": "Question", "back": "Answer"},
        "deck_name": "Deck",
        "slide_set_name": "Slides",
        "model_name": "Basic",
        "tags": ["lecture", "cards"],
    }

    status = await adapter.check_ready()
    result = await adapter.export_cards(request)

    assert status == {"connected": True}
    assert calls == [
        {
            "card": {"front": "Question", "back": "Answer"},
            "deck_name": "Deck",
            "slide_set_name": "Slides",
            "fallback_model": "Basic",
            "additional_tags": ["lecture", "cards"],
        }
    ]
    assert result == {
        "success": True,
        "note_id": 42,
        "error": None,
    }


@pytest.mark.asyncio
async def test_history_repository_replay_returns_ascending_domain_records(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")

    await repo.create_session({"session_id": "session-1", "status": "running"})
    await repo.append_events(
        "session-1",
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=3,
                event=WarningEmitted(
                    code="warn-3",
                    message="third",
                    details={"index": 3},
                ),
            ),
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=WarningEmitted(
                    code="warn-1",
                    message="first",
                    details={"index": 1},
                ),
            ),
            DomainEventRecord(
                session_id="session-1",
                sequence_no=2,
                event=WarningEmitted(
                    code="warn-2",
                    message="second",
                    details={"index": 2},
                ),
            ),
        ],
    )

    records = await repo.get_events_after("session-1", after_sequence_no=0)

    assert [record.sequence_no for record in records] == [1, 2, 3]
    assert [record.event.message for record in records] == ["first", "second", "third"]


@pytest.mark.asyncio
async def test_history_repository_replay_raises_on_unknown_and_corrupt_events(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")

    await repo.create_session({"session_id": "session-1", "status": "running"})
    await repo.append_events(
        "session-1",
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=WarningEmitted(
                    code="warn-1",
                    message="first",
                    details={"index": 1},
                ),
            )
        ],
    )

    db_path = tmp_path / "history_v2.sqlite3"
    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO session_events (session_id, sequence_no, event_class, event_payload)
            VALUES (?, ?, ?, ?)
            """,
            (
                "session-1",
                2,
                "UnknownEvent",
                '{"event_class":"UnknownEvent","data":{}}',
            ),
        )
        conn.execute(
            """
            INSERT INTO session_events (session_id, sequence_no, event_class, event_payload)
            VALUES (?, ?, ?, ?)
            """,
            (
                "session-1",
                3,
                "WarningEmitted",
                '{not-json',
            ),
        )
        conn.execute(
            """
            INSERT INTO session_events (session_id, sequence_no, event_class, event_payload)
            VALUES (?, ?, ?, ?)
            """,
            (
                "session-1",
                4,
                "WarningEmitted",
                '{"event_class":"WarningEmitted","data":{"code":"warn-4"}}',
            ),
        )
        conn.commit()

    with pytest.raises(HistoryRepositoryCorruptionError) as exc_info:
        await repo.get_events_after("session-1", after_sequence_no=0)

    assert exc_info.value.session_id == "session-1"
    assert exc_info.value.sequence_no == 2
    assert "Unsupported event class" in exc_info.value.reason


@pytest.mark.asyncio
async def test_history_repository_replay_raises_on_sequence_gap(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")

    await repo.create_session({"session_id": "session-1", "status": "running"})
    await repo.append_events(
        "session-1",
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=WarningEmitted(
                    code="warn-1",
                    message="first",
                    details={"index": 1},
                ),
            ),
            DomainEventRecord(
                session_id="session-1",
                sequence_no=3,
                event=WarningEmitted(
                    code="warn-3",
                    message="third",
                    details={"index": 3},
                ),
            ),
        ],
    )

    with pytest.raises(HistoryRepositoryCorruptionError) as exc_info:
        await repo.get_events_after("session-1", after_sequence_no=0)

    assert exc_info.value.session_id == "session-1"
    assert exc_info.value.sequence_no == 2
    assert "gap detected" in exc_info.value.reason


@pytest.mark.asyncio
async def test_history_repository_sync_state_first_write_is_atomic_under_concurrency(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")
    session_id = "session-concurrent-init"

    await asyncio.gather(
        *[
            repo.sync_state(
                {
                    "session_id": session_id,
                    "status": "running",
                    "phase": "extract",
                    "cursor": index,
                }
            )
            for index in range(20)
        ]
    )

    session = await repo.get_session(session_id)
    assert session is not None
    assert session["status"] == "running"
    assert session["phase"] == "extract"
    assert isinstance(session["cursor"], int)
    assert 0 <= session["cursor"] < 20

    db_path = tmp_path / "history_v2.sqlite3"
    with closing(sqlite3.connect(db_path)) as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    assert row is not None
    assert int(row[0]) == 1


@pytest.mark.asyncio
async def test_history_repository_sync_state_preserves_parallel_phase_update(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")

    await repo.create_session({"session_id": "session-1", "status": "running", "phase": "init"})

    await asyncio.gather(
        repo.sync_state({"session_id": "session-1", "status": "running", "cursor": 10}),
        repo.update_phase("session-1", "extract"),
    )

    session = await repo.get_session("session-1")
    assert session is not None
    assert session["phase"] == "extract"
    assert session["cursor"] == 10


@pytest.mark.asyncio
async def test_history_repository_rejects_duplicate_sequence_numbers(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")

    await repo.create_session({"session_id": "session-1", "status": "running"})
    await repo.append_events(
        "session-1",
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=WarningEmitted(
                    code="warn-1",
                    message="first",
                    details={"index": 1},
                ),
            )
        ],
    )

    with pytest.raises(sqlite3.IntegrityError):
        await repo.append_events(
            "session-1",
            [
                DomainEventRecord(
                    session_id="session-1",
                    sequence_no=1,
                    event=WarningEmitted(
                        code="warn-1b",
                        message="duplicate",
                        details={"index": 99},
                    ),
                )
            ],
        )


@pytest.mark.asyncio
async def test_history_repository_list_sessions_returns_payload_rows_ordered_by_updated_at(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "history_v2.sqlite3"
    repo = HistoryRepositorySqlite(db_path=db_path)

    await repo.create_session(
        {
            "session_id": "session-1",
            "status": "running",
            "deck_name": "Deck One",
            "source_file_name": "one.pdf",
            "card_count": 1,
        }
    )
    await repo.create_session(
        {
            "session_id": "session-2",
            "status": "completed",
            "deck_name": "Deck Two",
            "source_file_name": "two.pdf",
            "card_count": 3,
        }
    )

    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (100, "session-1"),
        )
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (200, "session-2"),
        )
        conn.commit()

    rows = await repo.list_sessions(limit=10)

    assert [row["session_id"] for row in rows] == ["session-2", "session-1"]
    assert rows[0]["deck_name"] == "Deck Two"
    assert rows[0]["source_file_name"] == "two.pdf"
    assert rows[0]["card_count"] == 3
    assert rows[0]["status"] == "completed"


@pytest.mark.asyncio
async def test_history_repository_delete_session_removes_snapshot_and_events(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")

    await repo.create_session({"session_id": "session-1", "status": "running"})
    await repo.append_events(
        "session-1",
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=WarningEmitted(
                    code="warn-1",
                    message="first",
                    details={},
                ),
            )
        ],
    )

    deleted = await repo.delete_session("session-1")

    assert deleted is True
    assert await repo.get_session("session-1") is None
    assert await repo.get_events_after("session-1", after_sequence_no=0) == []
    assert await repo.delete_session("session-1") is False


@pytest.mark.asyncio
async def test_history_repository_delete_sessions_deletes_selected_ids_only(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")
    await repo.create_session({"session_id": "session-1", "status": "running"})
    await repo.create_session({"session_id": "session-2", "status": "completed"})

    count = await repo.delete_sessions(["session-1", "missing-session"])

    assert count == 1
    assert await repo.get_session("session-1") is None
    assert await repo.get_session("session-2") is not None


@pytest.mark.asyncio
async def test_history_repository_delete_sessions_by_status_filters_rows(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")
    await repo.create_session({"session_id": "session-running", "status": "running"})
    await repo.create_session({"session_id": "session-done", "status": "completed"})

    deleted = await repo.delete_sessions_by_status("running")

    assert deleted == 1
    assert await repo.get_session("session-running") is None
    assert await repo.get_session("session-done") is not None


@pytest.mark.asyncio
async def test_history_repository_clear_sessions_removes_all_rows_and_events(
    tmp_path: Path,
) -> None:
    repo = HistoryRepositorySqlite(db_path=tmp_path / "history_v2.sqlite3")

    await repo.create_session({"session_id": "session-1", "status": "running"})
    await repo.create_session({"session_id": "session-2", "status": "completed"})
    await repo.append_events(
        "session-1",
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=WarningEmitted(
                    code="warn-1",
                    message="first",
                    details={},
                ),
            )
        ],
    )

    deleted = await repo.clear_sessions()

    assert deleted == 2
    assert await repo.list_sessions(limit=10) == []
    assert await repo.get_events_after("session-1", after_sequence_no=0) == []
class _RuntimeHandle:
    def __init__(self) -> None:
        self.stop_calls = 0

    def stop(self) -> None:
        self.stop_calls += 1


@pytest.mark.asyncio
async def test_session_runtime_store_enforces_single_active_handle_and_stop_get_running() -> None:
    store = SessionRuntimeStore()

    first = _RuntimeHandle()
    second = _RuntimeHandle()

    await store.start("s1", first)

    assert await store.get("s1") is first
    assert await store.is_running("s1") is True
    assert await store.get("s2") is None
    assert await store.is_running("s2") is False

    with pytest.raises(RuntimeError, match="active"):
        await store.start("s2", second)

    assert await store.stop("s2") is False

    assert await store.stop("s1") is True
    assert first.stop_calls == 1
    assert await store.get("s1") is None
    assert await store.is_running("s1") is False
