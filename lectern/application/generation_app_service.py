from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from lectern.application.dto import (
    ApiEventV2,
    CancelGenerationRequest,
    ReplayStreamRequest,
    ResumeGenerationRequest,
    StartGenerationRequest,
)
from lectern.application.errors import GenerationApplicationError, GenerationErrorCode
from lectern.application.ports import (
    AIProviderPort,
    AnkiGatewayPort,
    GenerationAppService,
    HistoryRepositoryPort,
    PdfExtractorPort,
    RuntimeSessionStorePort,
)
from lectern.application.translators.event_translator import EventTranslator
from lectern.domain.generation.events import (
    DomainEvent,
    DomainEventRecord,
    ErrorEmitted,
    PhaseCompleted,
    PhaseStarted,
    SessionCancelled,
    SessionCompleted,
)


@dataclass
class _RuntimeHandle:
    running: bool = True
    cancel_requested: bool = False

    def stop(self) -> None:
        self.running = False


class GenerationAppServiceImpl(GenerationAppService):
    def __init__(
        self,
        *,
        history: HistoryRepositoryPort,
        runtime_store: RuntimeSessionStorePort,
        translator: EventTranslator | None = None,
        pdf_extractor: PdfExtractorPort | None = None,
        ai_provider: AIProviderPort | None = None,
        anki_gateway: AnkiGatewayPort | None = None,
        start_runner: Callable[[StartGenerationRequest], AsyncIterator[DomainEvent]] | None = None,
        resume_runner: Callable[
            [ResumeGenerationRequest, dict[str, Any]],
            AsyncIterator[DomainEvent],
        ]
        | None = None,
        session_id_factory: Callable[[], str] | None = None,
        now_ms: Callable[[], int] | None = None,
    ) -> None:
        self._history = history
        self._runtime_store = runtime_store
        self._translator = translator or EventTranslator()
        self._pdf_extractor = pdf_extractor
        self._ai_provider = ai_provider
        self._anki_gateway = anki_gateway
        self._start_runner = start_runner or self._empty_start_runner
        self._resume_runner = resume_runner or self._empty_resume_runner
        self._session_id_factory = session_id_factory or (lambda: uuid.uuid4().hex)
        self._now_ms = now_ms or (lambda: int(time.time() * 1000))
        self._stream_lock = asyncio.Lock()

    async def run_generation_stream(
        self,
        req: StartGenerationRequest,
    ) -> AsyncIterator[ApiEventV2]:
        session_id = self._session_id_factory()
        handle = _RuntimeHandle()
        try:
            await self._runtime_store.start(session_id, handle)
        except RuntimeError as exc:
            raise GenerationApplicationError(
                GenerationErrorCode.RESUME_CONFLICT_ALREADY_RUNNING,
                "A generation session is already running",
                context={"session_id": session_id},
            ) from exc

        await self._history.create_session(
            {
                "session_id": session_id,
                "stream_version": req.stream_version,
                "status": "running",
                "phase": "generation",
                "cursor": 0,
            }
        )

        sequence_no = 0
        terminal_emitted = False
        try:
            async for event in self._start_runner(req):
                sequence_no, api_event, stop_stream = await self._process_event_or_cancel(
                    handle=handle,
                    session_id=session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    event=event,
                    cancel_stage="generation",
                )
                yield api_event
                if stop_stream:
                    terminal_emitted = True
                    break
            if handle.cancel_requested and not terminal_emitted:
                sequence_no, cancelled_event = await self._emit_cancelled_terminal(
                    session_id=session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    stage="generation",
                )
                yield self._translator.to_api_event(
                    cancelled_event,
                    session_id=session_id,
                    sequence_no=sequence_no,
                    now_ms=self._now_ms(),
                )
        except (GenerationApplicationError, RuntimeError, OSError, ValueError, TypeError) as exc:
            if handle.cancel_requested:
                sequence_no, cancelled_event = await self._emit_cancelled_terminal(
                    session_id=session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    stage="generation",
                )
                yield self._translator.to_api_event(
                    cancelled_event,
                    session_id=session_id,
                    sequence_no=sequence_no,
                    now_ms=self._now_ms(),
                )
                return
            sequence_no += 1
            if isinstance(exc, GenerationApplicationError):
                error_code = exc.code.value
                error_message = exc.message
            else:
                error_code = GenerationErrorCode.INTERNAL_UNEXPECTED.value
                error_message = str(exc)
            event = ErrorEmitted(
                code=error_code,
                message=error_message,
                stage="generation",
                recoverable=False,
            )
            try:
                await self._persist_record_and_snapshot(
                    session_id=session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    event=event,
                )
            except GenerationApplicationError:
                pass
            yield self._translator.to_api_event(
                event,
                session_id=session_id,
                sequence_no=sequence_no,
                now_ms=self._now_ms(),
            )
        finally:
            await self._runtime_store.stop(session_id)

    async def run_resume_stream(self, req: ResumeGenerationRequest) -> AsyncIterator[ApiEventV2]:
        session = await self._history.get_session(req.session_id)
        if session is None:
            raise GenerationApplicationError(
                GenerationErrorCode.SESSION_NOT_FOUND,
                f"Session '{req.session_id}' not found",
                context={"session_id": req.session_id},
            )

        stored_stream_version = int(session.get("stream_version", 2) or 2)
        if stored_stream_version != req.stream_version:
            raise GenerationApplicationError(
                GenerationErrorCode.RESUME_VERSION_MISMATCH,
                "Resume stream version mismatch",
                context={
                    "session_id": req.session_id,
                    "expected_stream_version": stored_stream_version,
                    "actual_stream_version": req.stream_version,
                },
            )

        status = str(session.get("status") or "")
        if status == "running" or await self._runtime_store.is_running(req.session_id):
            raise GenerationApplicationError(
                GenerationErrorCode.RESUME_CONFLICT_ALREADY_RUNNING,
                "Session is already running",
                context={"session_id": req.session_id},
            )
        if status == "completed":
            raise GenerationApplicationError(
                GenerationErrorCode.INVALID_INPUT,
                "Completed sessions cannot be resumed",
                context={"session_id": req.session_id},
            )

        handle = _RuntimeHandle()
        try:
            await self._runtime_store.start(req.session_id, handle)
        except RuntimeError as exc:
            raise GenerationApplicationError(
                GenerationErrorCode.RESUME_CONFLICT_ALREADY_RUNNING,
                "Session is already running",
                context={"session_id": req.session_id},
            ) from exc

        sequence_no = int(session.get("cursor", 0) or 0)
        terminal_emitted = False
        try:
            async for event in self._resume_runner(req, session):
                sequence_no, api_event, stop_stream = await self._process_event_or_cancel(
                    handle=handle,
                    session_id=req.session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    event=event,
                    cancel_stage="resume",
                )
                yield api_event
                if stop_stream:
                    terminal_emitted = True
                    break
            if handle.cancel_requested and not terminal_emitted:
                sequence_no, cancelled_event = await self._emit_cancelled_terminal(
                    session_id=req.session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    stage="resume",
                )
                yield self._translator.to_api_event(
                    cancelled_event,
                    session_id=req.session_id,
                    sequence_no=sequence_no,
                    now_ms=self._now_ms(),
                )
        except (GenerationApplicationError, RuntimeError, OSError, ValueError, TypeError) as exc:
            if handle.cancel_requested:
                sequence_no, cancelled_event = await self._emit_cancelled_terminal(
                    session_id=req.session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    stage="resume",
                )
                yield self._translator.to_api_event(
                    cancelled_event,
                    session_id=req.session_id,
                    sequence_no=sequence_no,
                    now_ms=self._now_ms(),
                )
                return

            sequence_no += 1
            if isinstance(exc, GenerationApplicationError):
                error_code = exc.code.value
                error_message = exc.message
            else:
                error_code = GenerationErrorCode.INTERNAL_UNEXPECTED.value
                error_message = str(exc)
            error_event = ErrorEmitted(
                code=error_code,
                message=error_message,
                stage="resume",
                recoverable=False,
            )
            try:
                await self._persist_record_and_snapshot(
                    session_id=req.session_id,
                    sequence_no=sequence_no,
                    stream_version=req.stream_version,
                    event=error_event,
                )
            except GenerationApplicationError:
                pass
            yield self._translator.to_api_event(
                error_event,
                session_id=req.session_id,
                sequence_no=sequence_no,
                now_ms=self._now_ms(),
            )
        finally:
            await self._runtime_store.stop(req.session_id)

    async def replay_stream(self, req: ReplayStreamRequest) -> AsyncIterator[ApiEventV2]:
        if req.after_sequence_no < 0:
            raise GenerationApplicationError(
                GenerationErrorCode.INVALID_INPUT,
                "after_sequence_no must be >= 0",
                details={"field": "after_sequence_no"},
                context={"session_id": req.session_id},
            )

        try:
            records = await self._history.get_events_after(
                req.session_id,
                after_sequence_no=req.after_sequence_no,
            )
        except ValueError:
            event = ErrorEmitted(
                code=GenerationErrorCode.HISTORY_CORRUPT_SEQUENCE.value,
                message="Replay history is corrupt",
                stage="replay",
                recoverable=False,
            )
            yield self._translator.to_api_event(
                event,
                session_id=req.session_id,
                sequence_no=req.after_sequence_no + 1,
                now_ms=self._now_ms(),
            )
            return

        for record in records:
            yield self._translator.to_api_event(
                record.event,
                session_id=req.session_id,
                sequence_no=int(record.sequence_no),
                now_ms=self._now_ms(),
            )

    async def cancel(self, req: CancelGenerationRequest) -> dict[str, Any]:
        async with self._stream_lock:
            handle = await self._runtime_store.get(req.session_id)
            if handle is None:
                return {
                    "ok": True,
                    "session_id": req.session_id,
                    "code": GenerationErrorCode.CANCEL_IDEMPOTENT_NOOP.value,
                }
            if hasattr(handle, "running") and not bool(handle.running):
                return {
                    "ok": True,
                    "session_id": req.session_id,
                    "code": GenerationErrorCode.CANCEL_IDEMPOTENT_NOOP.value,
                }
            if hasattr(handle, "cancel_requested"):
                handle.cancel_requested = True
            return {
                "ok": True,
                "session_id": req.session_id,
                "code": "cancelled",
            }

    async def _persist_record_and_snapshot(
        self,
        *,
        session_id: str,
        sequence_no: int,
        stream_version: int,
        event: DomainEvent,
    ) -> None:
        record = DomainEventRecord(
            session_id=session_id,
            sequence_no=sequence_no,
            event=event,
        )
        try:
            await self._history.append_events(session_id, [record])
        except (RuntimeError, OSError, ValueError, TypeError) as exc:
            raise GenerationApplicationError(
                GenerationErrorCode.HISTORY_PERSIST_FAILED,
                "Failed to append domain event",
                context={"session_id": session_id, "sequence_no": sequence_no},
            ) from exc

        snapshot = {
            "session_id": session_id,
            "stream_version": stream_version,
            "cursor": sequence_no,
            "status": self._status_for_event(event),
        }
        phase = self._phase_for_event(event)
        if phase is not None:
            snapshot["phase"] = phase
        await self._sync_snapshot_with_retry(snapshot)

    async def _sync_snapshot_with_retry(self, snapshot: dict[str, Any]) -> None:
        for attempt in (1, 2):
            try:
                await self._history.sync_state(snapshot)
                return
            except (RuntimeError, OSError, TimeoutError) as exc:
                if attempt == 2:
                    raise GenerationApplicationError(
                        GenerationErrorCode.HISTORY_PERSIST_FAILED,
                        "Failed to sync session snapshot",
                        context={"session_id": snapshot.get("session_id")},
                    ) from exc

    async def _process_event_or_cancel(
        self,
        *,
        handle: _RuntimeHandle,
        session_id: str,
        sequence_no: int,
        stream_version: int,
        event: DomainEvent,
        cancel_stage: str,
    ) -> tuple[int, ApiEventV2, bool]:
        async with self._stream_lock:
            if handle.cancel_requested:
                cancelled_sequence, cancelled_event = await self._emit_cancelled_terminal(
                    session_id=session_id,
                    sequence_no=sequence_no,
                    stream_version=stream_version,
                    stage=cancel_stage,
                )
                handle.running = False
                return (
                    cancelled_sequence,
                    self._translator.to_api_event(
                        cancelled_event,
                        session_id=session_id,
                        sequence_no=cancelled_sequence,
                        now_ms=self._now_ms(),
                    ),
                    True,
                )

            next_sequence = sequence_no + 1
            await self._persist_record_and_snapshot(
                session_id=session_id,
                sequence_no=next_sequence,
                stream_version=stream_version,
                event=event,
            )
            terminal_event = self._is_terminal_event(event)
            if terminal_event:
                handle.running = False
            return (
                next_sequence,
                self._translator.to_api_event(
                    event,
                    session_id=session_id,
                    sequence_no=next_sequence,
                    now_ms=self._now_ms(),
                ),
                terminal_event,
            )

    async def _emit_cancelled_terminal(
        self,
        *,
        session_id: str,
        sequence_no: int,
        stream_version: int,
        stage: str,
    ) -> tuple[int, SessionCancelled]:
        next_sequence = sequence_no + 1
        cancelled_event = SessionCancelled(stage=stage, reason="user_cancel")
        await self._persist_record_and_snapshot(
            session_id=session_id,
            sequence_no=next_sequence,
            stream_version=stream_version,
            event=cancelled_event,
        )
        return next_sequence, cancelled_event

    def _is_terminal_event(self, event: DomainEvent) -> bool:
        return isinstance(event, (SessionCompleted, SessionCancelled)) or (
            isinstance(event, ErrorEmitted) and not event.recoverable
        )

    def _status_for_event(self, event: DomainEvent) -> str:
        if isinstance(event, SessionCompleted):
            return "completed"
        if isinstance(event, SessionCancelled):
            return "cancelled"
        if isinstance(event, ErrorEmitted) and not event.recoverable:
            return "error"
        return "running"

    def _phase_for_event(self, event: DomainEvent) -> str | None:
        if isinstance(event, PhaseStarted):
            return str(event.phase)
        if isinstance(event, PhaseCompleted):
            return str(event.phase)
        return None

    async def _empty_start_runner(self, _: StartGenerationRequest) -> AsyncIterator[DomainEvent]:
        if False:
            yield  # pragma: no cover

    async def _empty_resume_runner(
        self,
        _: ResumeGenerationRequest,
        __: dict[str, Any],
    ) -> AsyncIterator[DomainEvent]:
        if False:
            yield  # pragma: no cover
