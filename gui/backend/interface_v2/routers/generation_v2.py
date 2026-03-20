from __future__ import annotations

import json
import os
import tempfile
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from gui.backend.dependencies import get_generation_app_service_v2
from gui.backend.interface_v2.serializers.events_v2 import serialize_api_event_v2
from lectern import config
from lectern.application.dto import (
    ApiEventV2,
    CancelGenerationRequest,
    ReplayStreamRequest,
    ResumeGenerationRequest,
    StartGenerationRequest,
)
from lectern.application.errors import GenerationApplicationError, GenerationErrorCode
from lectern.application.generation_app_service import GenerationAppServiceImpl
from lectern.cost_estimator import estimate_cost_with_base as estimate_cost_with_base_impl

router = APIRouter()


class EstimateV2Response(BaseModel):
    tokens: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    input_cost: float | None = None
    output_cost: float | None = None
    cost: float | None = None
    pages: int | None = None
    text_chars: int | None = None
    model: str | None = None
    suggested_card_count: int | None = None
    estimated_card_count: int | None = None
    image_count: int | None = None
    document_type: str | None = None


class StopV2Response(BaseModel):
    stopped: bool
    session_id: str


def _to_http_status(code: GenerationErrorCode) -> int:
    if code is GenerationErrorCode.INVALID_INPUT:
        return 400
    if code is GenerationErrorCode.PDF_UNAVAILABLE:
        return 422
    if code in {
        GenerationErrorCode.PROVIDER_UPLOAD_FAILED,
        GenerationErrorCode.PROVIDER_GENERATION_FAILED,
    }:
        return 502
    if code in {
        GenerationErrorCode.RESUME_VERSION_MISMATCH,
        GenerationErrorCode.RESUME_CONFLICT_ALREADY_RUNNING,
    }:
        return 409
    if code is GenerationErrorCode.SESSION_NOT_FOUND:
        return 404
    return 500


def _to_http_error(exc: GenerationApplicationError) -> HTTPException:
    return HTTPException(
        status_code=_to_http_status(exc.code),
        detail={
            "code": exc.code.value,
            "message": exc.message,
            "details": exc.details or {},
            "context": exc.context or {},
        },
    )


def _parse_tags(tags_raw: str) -> list[str]:
    try:
        parsed = json.loads(tags_raw)
    except json.JSONDecodeError as exc:
        raise GenerationApplicationError(
            GenerationErrorCode.INVALID_INPUT,
            "Invalid generation input for 'tags': expected JSON array of strings.",
            details={"field": "tags", "reason": "invalid_json"},
        ) from exc
    if not isinstance(parsed, list) or not all(isinstance(tag, str) for tag in parsed):
        raise GenerationApplicationError(
            GenerationErrorCode.INVALID_INPUT,
            "Invalid generation input for 'tags': expected JSON array of strings.",
            details={"field": "tags", "reason": "invalid_type"},
        )
    return parsed


def _save_upload(pdf_file: UploadFile) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        pdf_file.file.seek(0)
        for chunk in iter(lambda: pdf_file.file.read(65536), b""):
            tmp.write(chunk)
        return tmp.name


@router.post("/estimate-v2", response_model=EstimateV2Response)
async def estimate_v2(
    pdf_file: UploadFile = File(...),
    model_name: str | None = Form(None),
    target_card_count: int | None = Form(None),
) -> dict[str, object]:
    tmp_path = await run_in_threadpool(_save_upload, pdf_file)
    try:
        estimate, _base = await estimate_cost_with_base_impl(
            tmp_path,
            model_name=model_name,
            target_card_count=target_card_count,
        )
        return estimate
    except (RuntimeError, OSError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "estimate_failed",
                "message": str(exc),
            },
        ) from exc
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("/stop-v2", response_model=StopV2Response)
async def stop_v2(
    session_id: str | None = None,
    app_service: GenerationAppServiceImpl = Depends(get_generation_app_service_v2),
) -> dict[str, object]:
    if not session_id:
        raise _to_http_error(
            GenerationApplicationError(
                GenerationErrorCode.INVALID_INPUT,
                "session_id is required",
                details={"field": "session_id"},
            )
        )

    result = await app_service.cancel(CancelGenerationRequest(session_id=session_id))
    return {
        "stopped": result.get("code") == "cancelled",
        "session_id": str(result.get("session_id") or session_id),
    }


def _terminal_error_event(
    *,
    session_id: str,
    sequence_no: int,
    stage: str,
    code: GenerationErrorCode | str,
    message: str,
) -> ApiEventV2:
    code_value = code.value if isinstance(code, GenerationErrorCode) else code
    return ApiEventV2(
        session_id=session_id,
        sequence_no=sequence_no,
        type="error_emitted",
        message=message,
        timestamp=int(time.time() * 1000),
        data={"code": code_value, "stage": stage, "recoverable": False},
    )


@router.post("/generate-v2")
async def generate_v2(
    pdf_file: UploadFile = File(...),
    deck_name: str = Form(...),
    model_name: str | None = Form(None),
    tags: str = Form("[]"),
    focus_prompt: str = Form(""),
    target_card_count: int | None = Form(None),
    session_id: str | None = Form(None),
    after_sequence_no: int | None = Form(None),
    app_service: GenerationAppServiceImpl = Depends(get_generation_app_service_v2),
) -> StreamingResponse:
    if after_sequence_no is not None and after_sequence_no < 0:
        raise _to_http_error(
            GenerationApplicationError(
                GenerationErrorCode.INVALID_INPUT,
                "after_sequence_no must be >= 0",
                details={"field": "after_sequence_no"},
            )
        )
    if after_sequence_no is not None and session_id is None:
        raise _to_http_error(
            GenerationApplicationError(
                GenerationErrorCode.INVALID_INPUT,
                "after_sequence_no requires session_id",
                details={"field": "after_sequence_no"},
            )
        )
    tmp_path = await run_in_threadpool(_save_upload, pdf_file)

    try:
        tags_list = _parse_tags(tags)
    except GenerationApplicationError as exc:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise _to_http_error(exc) from exc

    resolved_model_name = model_name or str(config.DEFAULT_GEMINI_MODEL)
    stage = "resume" if session_id else "generation"
    if session_id:
        req = ResumeGenerationRequest(
            session_id=session_id,
            pdf_path=tmp_path,
            deck_name=deck_name,
            model_name=resolved_model_name,
            stream_version=2,
        )
        resume_stream = app_service.run_resume_stream(req)
        if after_sequence_no is not None:
            replay_stream = app_service.replay_stream(
                ReplayStreamRequest(
                    session_id=session_id,
                    after_sequence_no=after_sequence_no,
                    stream_version=2,
                )
            )

            async def chained_stream() -> AsyncIterator[ApiEventV2]:
                async for replay_event in replay_stream:
                    yield replay_event
                async for resume_event in resume_stream:
                    yield resume_event

            stream = chained_stream()
        else:
            stream = resume_stream
    else:
        req = StartGenerationRequest(
            pdf_path=tmp_path,
            deck_name=deck_name,
            model_name=resolved_model_name,
            tags=tags_list,
            focus_prompt=focus_prompt or None,
            target_card_count=target_card_count,
            stream_version=2,
        )
        stream = app_service.run_generation_stream(req)

    try:
        first_event = await anext(stream)
    except StopAsyncIteration:
        first_event = None
    except GenerationApplicationError as exc:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise _to_http_error(exc) from exc

    async def event_stream() -> AsyncIterator[str]:
        last_session_id = session_id or "unknown-session"
        last_sequence_no = 0
        try:
            if first_event is not None:
                last_session_id = first_event.session_id
                last_sequence_no = first_event.sequence_no
                yield serialize_api_event_v2(first_event) + "\n"
            async for evt in stream:
                last_session_id = evt.session_id
                last_sequence_no = evt.sequence_no
                yield serialize_api_event_v2(evt) + "\n"
        except GenerationApplicationError as exc:
            terminal = _terminal_error_event(
                session_id=last_session_id,
                sequence_no=last_sequence_no + 1,
                stage=stage,
                code=exc.code,
                message=exc.message,
            )
            yield serialize_api_event_v2(terminal) + "\n"
        except Exception as exc:
            terminal = _terminal_error_event(
                session_id=last_session_id,
                sequence_no=last_sequence_no + 1,
                stage=stage,
                code=GenerationErrorCode.INTERNAL_UNEXPECTED,
                message=str(exc),
            )
            yield serialize_api_event_v2(terminal) + "\n"
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
