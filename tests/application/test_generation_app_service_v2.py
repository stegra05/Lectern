from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import pytest

from lectern.application.dto import (
    ApiEventV2,
    CancelGenerationRequest,
    ReplayStreamRequest,
    ResumeGenerationRequest,
    StartGenerationRequest,
)
from lectern.application.errors import GenerationApplicationError, GenerationErrorCode
from lectern.application.generation_app_service import GenerationAppServiceImpl
from lectern.domain.generation.events import (
    DomainEvent,
    ErrorEmitted,
    PhaseStarted,
    SessionCompleted,
    SessionStarted,
)
from lectern.infrastructure.persistence.history_repository_sqlite import (
    HistoryRepositoryCorruptionError,
)
from lectern.infrastructure.runtime.session_runtime_store import SessionRuntimeStore


@dataclass
class _CallHistory:
    calls: list[str]


class _TranslatorSpy:
    def __init__(self, calls: list[str]) -> None:
        self._calls = calls

    def to_api_event(
        self,
        event: DomainEvent,
        *,
        session_id: str,
        sequence_no: int,
        now_ms: int | None = None,
    ) -> ApiEventV2:
        self._calls.append(f"translate:{sequence_no}")
        return ApiEventV2(
            session_id=session_id,
            sequence_no=sequence_no,
            type=event.event_type.value,  # type: ignore[attr-defined]
            message=getattr(event, "message", ""),
            timestamp=now_ms or 1,
            data={},
        )


class _HistoryStub:
    def __init__(self, call_history: _CallHistory) -> None:
        self.call_history = call_history
        self.sessions: dict[str, dict[str, Any]] = {}
        self.records: list[tuple[str, int, DomainEvent]] = []
        self.sync_fail_once = False
        self.sync_calls = 0
        self.append_calls = 0

    async def create_session(self, init: dict[str, Any]) -> None:
        self.call_history.calls.append("create")
        self.sessions[str(init["session_id"])] = dict(init)

    async def update_phase(self, session_id: str, phase: str) -> None:
        session = self.sessions.setdefault(session_id, {"session_id": session_id})
        session["phase"] = phase

    async def append_events(self, session_id: str, events: list[Any]) -> None:
        self.call_history.calls.append("append")
        self.append_calls += 1
        for record in events:
            self.records.append((session_id, int(record.sequence_no), record.event))

    async def sync_state(self, snapshot: dict[str, Any]) -> None:
        self.call_history.calls.append("sync")
        self.sync_calls += 1
        if self.sync_fail_once and self.sync_calls == 1:
            raise RuntimeError("transient sync failure")
        session_id = str(snapshot["session_id"])
        current = self.sessions.setdefault(session_id, {"session_id": session_id})
        current.update(snapshot)

    async def mark_terminal(self, session_id: str, status: str) -> None:
        session = self.sessions.setdefault(session_id, {"session_id": session_id})
        session["status"] = status

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.sessions.get(session_id)

    async def get_events_after(
        self,
        session_id: str,
        *,
        after_sequence_no: int,
        limit: int = 1000,
    ) -> list[Any]:
        out = []
        for sid, sequence_no, event in self.records:
            if sid != session_id or sequence_no <= after_sequence_no:
                continue
            out.append(
                type(
                    "Record",
                    (),
                    {
                        "session_id": sid,
                        "sequence_no": sequence_no,
                        "event": event,
                    },
                )()
            )
        return sorted(out, key=lambda rec: rec.sequence_no)[:limit]


async def _collect(stream: AsyncIterator[ApiEventV2]) -> list[ApiEventV2]:
    return [event async for event in stream]


@pytest.mark.asyncio
async def test_service_persists_before_emitting() -> None:
    calls: list[str] = []
    history = _HistoryStub(_CallHistory(calls))
    translator = _TranslatorSpy(calls)

    async def start_runner(_: StartGenerationRequest) -> AsyncIterator[DomainEvent]:
        yield SessionStarted(session_id="session-1", mode="start")
        yield PhaseStarted(phase="generation")
        yield SessionCompleted(summary={"cards_generated": 1})

    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        translator=translator,
        start_runner=start_runner,
        session_id_factory=lambda: "session-1",
        now_ms=lambda: 1,
    )

    req = StartGenerationRequest(
        pdf_path="/tmp/a.pdf",
        deck_name="Deck",
        model_name="gemini",
        tags=[],
    )
    out = await _collect(service.run_generation_stream(req))

    assert [event.sequence_no for event in out] == [1, 2, 3]
    assert calls[:3] == ["create", "append", "sync"]
    assert calls[3] == "translate:1"


@pytest.mark.asyncio
async def test_replay_negative_cursor_raises_invalid_input() -> None:
    service = GenerationAppServiceImpl(
        history=_HistoryStub(_CallHistory([])),
        runtime_store=SessionRuntimeStore(),
        now_ms=lambda: 1,
    )

    with pytest.raises(GenerationApplicationError) as exc_info:
        await _collect(service.replay_stream(ReplayStreamRequest("s1", after_sequence_no=-1)))

    assert exc_info.value.code is GenerationErrorCode.INVALID_INPUT


@pytest.mark.asyncio
async def test_replay_at_or_above_latest_returns_empty() -> None:
    history = _HistoryStub(_CallHistory([]))
    history.records.append(("s1", 1, SessionStarted(session_id="s1", mode="start")))
    history.records.append(("s1", 2, PhaseStarted(phase="generation")))

    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        now_ms=lambda: 1,
    )

    out = await _collect(service.replay_stream(ReplayStreamRequest("s1", after_sequence_no=2)))
    assert out == []


@pytest.mark.asyncio
async def test_replay_sequence_gap_raises_history_corrupt_sequence_terminal_event() -> None:
    history = _HistoryStub(_CallHistory([]))
    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        now_ms=lambda: 1,
    )

    async def broken_get_events_after(
        session_id: str,
        *,
        after_sequence_no: int,
        limit: int = 1000,
    ) -> list[Any]:
        raise HistoryRepositoryCorruptionError(session_id, 7, "gap detected")

    history.get_events_after = broken_get_events_after  # type: ignore[method-assign]

    out = await _collect(service.replay_stream(ReplayStreamRequest("s1", after_sequence_no=0)))
    assert len(out) == 1
    assert out[0].type == "error_emitted"
    assert out[0].data["code"] == "history_corrupt_sequence"


@pytest.mark.asyncio
async def test_start_while_running_raises_resume_conflict_already_running() -> None:
    store = SessionRuntimeStore()
    await store.start("existing", object())

    service = GenerationAppServiceImpl(
        history=_HistoryStub(_CallHistory([])),
        runtime_store=store,
        now_ms=lambda: 1,
    )

    req = StartGenerationRequest("/tmp/a.pdf", "Deck", "gemini", [])
    with pytest.raises(GenerationApplicationError) as exc_info:
        await _collect(service.run_generation_stream(req))

    assert exc_info.value.code is GenerationErrorCode.RESUME_CONFLICT_ALREADY_RUNNING


@pytest.mark.asyncio
async def test_resume_version_mismatch_raises_conflict() -> None:
    history = _HistoryStub(_CallHistory([]))
    history.sessions["s1"] = {
        "session_id": "s1",
        "status": "stopped",
        "stream_version": 2,
    }
    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        now_ms=lambda: 1,
    )

    req = ResumeGenerationRequest(
        session_id="s1",
        pdf_path="/tmp/a.pdf",
        deck_name="Deck",
        model_name="gemini",
        stream_version=3,
    )
    with pytest.raises(GenerationApplicationError) as exc_info:
        await _collect(service.run_resume_stream(req))

    assert exc_info.value.code is GenerationErrorCode.RESUME_VERSION_MISMATCH


@pytest.mark.asyncio
async def test_resume_runner_failure_emits_terminal_error_event() -> None:
    history = _HistoryStub(_CallHistory([]))
    history.sessions["s1"] = {
        "session_id": "s1",
        "status": "stopped",
        "stream_version": 2,
        "cursor": 5,
    }

    async def failing_resume_runner(
        _: ResumeGenerationRequest,
        __: dict[str, Any],
    ) -> AsyncIterator[DomainEvent]:
        raise RuntimeError("resume failed")
        if False:
            yield SessionStarted(session_id="s1", mode="resume")

    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        resume_runner=failing_resume_runner,
        now_ms=lambda: 1,
    )

    req = ResumeGenerationRequest(
        session_id="s1",
        pdf_path="/tmp/a.pdf",
        deck_name="Deck",
        model_name="gemini",
    )
    out = await _collect(service.run_resume_stream(req))

    assert len(out) == 1
    assert out[0].type == "error_emitted"
    assert out[0].data["code"] == "internal_unexpected"


@pytest.mark.asyncio
async def test_cancel_idempotent_noop_when_not_running() -> None:
    service = GenerationAppServiceImpl(
        history=_HistoryStub(_CallHistory([])),
        runtime_store=SessionRuntimeStore(),
        now_ms=lambda: 1,
    )

    result = await service.cancel(CancelGenerationRequest(session_id="s1"))
    assert result["ok"] is True
    assert result["code"] == "cancel_idempotent_noop"


@pytest.mark.asyncio
async def test_sync_state_retried_after_append_success_when_retryable_failure() -> None:
    history = _HistoryStub(_CallHistory([]))
    history.sync_fail_once = True

    async def start_runner(_: StartGenerationRequest) -> AsyncIterator[DomainEvent]:
        yield SessionStarted(session_id="session-1", mode="start")

    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        start_runner=start_runner,
        session_id_factory=lambda: "session-1",
        now_ms=lambda: 1,
    )

    req = StartGenerationRequest("/tmp/a.pdf", "Deck", "gemini", [])
    out = await _collect(service.run_generation_stream(req))

    assert len(out) == 1
    assert history.append_calls == 1
    assert history.sync_calls == 2


@pytest.mark.asyncio
async def test_cancel_wins_before_terminal_emit_and_followup_cancel_is_noop() -> None:
    history = _HistoryStub(_CallHistory([]))
    session_id = "session-race"
    session_started_emitted = asyncio.Event()
    continue_runner = asyncio.Event()

    async def start_runner(_: StartGenerationRequest) -> AsyncIterator[DomainEvent]:
        yield SessionStarted(session_id=session_id, mode="start")
        await continue_runner.wait()
        yield SessionCompleted(summary={"cards_generated": 10})

    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        start_runner=start_runner,
        session_id_factory=lambda: session_id,
        now_ms=lambda: 1,
    )

    req = StartGenerationRequest("/tmp/a.pdf", "Deck", "gemini", [])
    out: list[ApiEventV2] = []

    async def consume_stream() -> None:
        async for event in service.run_generation_stream(req):
            out.append(event)
            if event.type == "session_started":
                session_started_emitted.set()

    consume_task = asyncio.create_task(consume_stream())
    await session_started_emitted.wait()

    cancel_result = await service.cancel(CancelGenerationRequest(session_id=session_id))
    continue_runner.set()
    await consume_task

    assert cancel_result["ok"] is True
    assert cancel_result["code"] == "cancelled"
    assert [event.type for event in out] == ["session_started", "session_cancelled"]

    session = await history.get_session(session_id)
    assert session is not None
    assert session["status"] == "cancelled"

    follow_up = await service.cancel(CancelGenerationRequest(session_id=session_id))
    assert follow_up["ok"] is True
    assert follow_up["code"] == "cancel_idempotent_noop"


@pytest.mark.asyncio
async def test_cancel_is_noop_once_terminal_commit_started() -> None:
    history = _HistoryStub(_CallHistory([]))
    session_id = "session-terminal-window"
    terminal_sync_started = asyncio.Event()
    allow_terminal_sync_finish = asyncio.Event()

    async def start_runner(_: StartGenerationRequest) -> AsyncIterator[DomainEvent]:
        yield SessionStarted(session_id=session_id, mode="start")
        yield SessionCompleted(summary={"cards_generated": 1})

    original_sync_state = history.sync_state

    async def gated_sync_state(snapshot: dict[str, Any]) -> None:
        if int(snapshot.get("cursor", 0) or 0) == 2:
            terminal_sync_started.set()
            await allow_terminal_sync_finish.wait()
        await original_sync_state(snapshot)

    history.sync_state = gated_sync_state  # type: ignore[method-assign]

    service = GenerationAppServiceImpl(
        history=history,
        runtime_store=SessionRuntimeStore(),
        start_runner=start_runner,
        session_id_factory=lambda: session_id,
        now_ms=lambda: 1,
    )

    req = StartGenerationRequest("/tmp/a.pdf", "Deck", "gemini", [])
    out: list[ApiEventV2] = []

    async def consume_stream() -> None:
        async for event in service.run_generation_stream(req):
            out.append(event)

    consume_task = asyncio.create_task(consume_stream())
    await terminal_sync_started.wait()

    cancel_task = asyncio.create_task(service.cancel(CancelGenerationRequest(session_id=session_id)))
    await asyncio.sleep(0)
    assert not cancel_task.done()

    allow_terminal_sync_finish.set()
    await consume_task
    cancel_result = await cancel_task
    assert cancel_result["code"] == "cancel_idempotent_noop"

    assert [event.type for event in out] == ["session_started", "session_completed"]
