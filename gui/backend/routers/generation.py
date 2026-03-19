import os
import json
import logging
import hashlib
import shutil
import tempfile
import time
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, Optional
from cachetools import TTLCache
from starlette.concurrency import run_in_threadpool

from lectern import config
from lectern.cost_estimator import recompute_estimate
from lectern.lectern_service import LecternGenerationService
from lectern.utils.history import HistoryManager
from gui.backend.card_identity import ensure_cards_have_uid
from gui.backend.session import SessionManager, LECTERN_TEMP_PREFIX
from gui.backend.dependencies import (
    get_session_manager,
    get_history_manager,
    get_generation_service,
)

router = APIRouter()
logger = logging.getLogger("lectern.backend.generation")

# NOTE(Estimate): Session-level cache for estimate base data. Key = (content_sha256, model).
_estimate_base_cache: TTLCache = TTLCache(maxsize=50, ttl=3600)

# --- Models ---


class EstimateResponse(BaseModel):
    tokens: Optional[int] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    input_cost: Optional[float] = None
    output_cost: Optional[float] = None
    cost: Optional[float] = None
    pages: Optional[int] = None
    text_chars: Optional[int] = None
    model: Optional[str] = None
    suggested_card_count: Optional[int] = None
    estimated_card_count: Optional[int] = None
    image_count: Optional[int] = None
    document_type: Optional[str] = None


class StopResponse(BaseModel):
    stopped: bool
    session_id: str
    message: Optional[str] = None


# --- Helpers ---


def _estimate_cache_key(tmp_path: str, model: str) -> tuple:
    """Content-based key for same PDF+model."""
    return (_file_sha256(tmp_path), model or "")


def _file_sha256(tmp_path: str) -> str:
    """Compute SHA-256 hash for a file path."""
    h = hashlib.sha256()
    with open(tmp_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _generation_validation_error(*, field: str, reason: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "invalid_generation_input",
            "field": field,
            "reason": reason,
            "message": (
                "Invalid generation input for 'tags': expected JSON array of strings."
            ),
        },
    )


def _parse_tags_payload(tags: str) -> list[str]:
    try:
        tags_list = json.loads(tags)
    except json.JSONDecodeError as exc:
        raise _generation_validation_error(
            field="tags",
            reason="invalid_json",
        ) from exc

    if not isinstance(tags_list, list):
        raise _generation_validation_error(
            field="tags",
            reason="invalid_type",
        )

    if not all(isinstance(tag, str) for tag in tags_list):
        raise _generation_validation_error(
            field="tags",
            reason="invalid_item_type",
        )

    return tags_list


def _collect_resume_invariant_mismatches(
    existing_session: dict[str, Any],
    *,
    deck_name: str,
    model_name: str,
    source_file_name: str,
    source_pdf_sha256: str,
) -> list[str]:
    mismatched_fields: list[str] = []

    if existing_session.get("deck") != deck_name:
        mismatched_fields.append("deck_name")
    if existing_session.get("model_name") != model_name:
        mismatched_fields.append("model_name")

    persisted_source_hash = existing_session.get("source_pdf_sha256")
    if not persisted_source_hash or persisted_source_hash != source_pdf_sha256:
        mismatched_fields.append("source_pdf_sha256")

    persisted_source_name = existing_session.get("source_file_name")
    if (
        persisted_source_name
        and source_file_name
        and persisted_source_name != source_file_name
    ):
        mismatched_fields.append("source_file_name")

    return mismatched_fields


# --- Endpoints ---


@router.post("/estimate", response_model=EstimateResponse)
async def estimate_cost(
    pdf_file: UploadFile = File(...),
    model_name: Optional[str] = Form(None),
    target_card_count: Optional[int] = Form(None),
    service: LecternGenerationService = Depends(get_generation_service),
):
    model = model_name or config.DEFAULT_GEMINI_MODEL

    def save_to_temp():
        with tempfile.NamedTemporaryFile(
            delete=False,
            prefix=LECTERN_TEMP_PREFIX,
            suffix=".pdf",
        ) as tmp:
            shutil.copyfileobj(pdf_file.file, tmp)
            return tmp.name

    tmp_path = await run_in_threadpool(save_to_temp)

    try:
        cache_key = await run_in_threadpool(_estimate_cache_key, tmp_path, model)
        base_data = _estimate_base_cache.get(cache_key)

        if base_data is not None:
            data = recompute_estimate(
                token_count=base_data["token_count"],
                page_count=base_data["page_count"],
                text_chars=base_data["text_chars"],
                image_count=base_data["image_count"],
                model=base_data["model"],
                target_card_count=target_card_count,
            )
            return data

        data, base_data = await service.estimate_cost_with_base(
            tmp_path,
            model_name=model_name,
            target_card_count=target_card_count,
        )
        _estimate_base_cache[cache_key] = base_data
        return data
    except Exception as e:
        logger.error(f"Estimation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("/generate")
async def generate_cards(
    pdf_file: UploadFile = File(...),
    deck_name: str = Form(...),
    model_name: Optional[str] = Form(None),
    tags: str = Form("[]"),
    context_deck: str = Form(""),
    focus_prompt: str = Form(""),
    target_card_count: Optional[int] = Form(None),
    session_id: Optional[str] = Form(None),
    session_mgr: SessionManager = Depends(get_session_manager),
    history_mgr: HistoryManager = Depends(get_history_manager),
    service: LecternGenerationService = Depends(get_generation_service),
):
    model_name = model_name or config.DEFAULT_GEMINI_MODEL
    if focus_prompt:
        logger.info(f"User focus: '{focus_prompt}'")

    tags_list = _parse_tags_payload(tags)

    def save_generate_temp() -> tuple[str, str]:
        pdf_file.file.seek(0)
        file_hasher = hashlib.sha256()
        with tempfile.NamedTemporaryFile(
            delete=False,
            prefix=LECTERN_TEMP_PREFIX,
            suffix=".pdf",
        ) as tmp:
            for chunk in iter(lambda: pdf_file.file.read(65536), b""):
                file_hasher.update(chunk)
                tmp.write(chunk)
            return tmp.name, file_hasher.hexdigest()

    tmp_path, source_pdf_sha256 = await run_in_threadpool(save_generate_temp)
    source_file_name = pdf_file.filename or ""

    # Handle resume case
    existing_session = None
    resume_rejection: dict[str, Any] | None = None
    if session_id:
        existing_session = await run_in_threadpool(
            history_mgr.get_entry_by_session_id, session_id
        )
        if existing_session:
            # Validate session status - only allow resume for draft, error, or cancelled
            status = existing_session.get("status")
            if status not in ("draft", "error", "cancelled"):
                logger.warning(f"Cannot resume session with status '{status}'")
                resume_rejection = {
                    "warning_kind": "invalid_resume_status",
                    "message": (
                        f"Cannot resume session with status '{status}'. Starting new session."
                    ),
                    "original_status": status,
                }
                existing_session = None  # Fall through to create new session
            else:
                mismatched_fields = _collect_resume_invariant_mismatches(
                    existing_session,
                    deck_name=deck_name,
                    model_name=model_name,
                    source_file_name=source_file_name,
                    source_pdf_sha256=source_pdf_sha256,
                )
                if mismatched_fields:
                    logger.warning(
                        "Cannot resume session '%s' due to invariant mismatch: %s",
                        session_id,
                        ", ".join(mismatched_fields),
                    )
                    resume_rejection = {
                        "warning_kind": "invalid_resume_invariants",
                        "message": (
                            "Resume invariants failed (deck/model/source). Starting new session."
                        ),
                        "mismatched_fields": mismatched_fields,
                    }
                    existing_session = None
                else:
                    logger.info(f"Resuming session {session_id}")
                    session = session_mgr.restore_session(
                        session_id=session_id, pdf_path=tmp_path
                    )
        if not existing_session:
            logger.warning(
                f"Session {session_id} not found or invalid status, creating new session"
            )
            session = session_mgr.create_session(pdf_path=tmp_path)
            session_id = None  # Clear to indicate new session
    else:
        session = session_mgr.create_session(pdf_path=tmp_path)

    # Only create new history entry for new sessions
    if not existing_session:
        await run_in_threadpool(
            history_mgr.add_entry,
            filename=pdf_file.filename,
            deck=deck_name,
            session_id=session.session_id,
            status="draft",
            source_file_name=source_file_name,
            source_pdf_sha256=source_pdf_sha256,
        )

    status_handlers = {
        "done": ("completed", True),
        "cancelled": ("cancelled", False),
        "error": ("error", False),
    }

    async def event_generator():
        from lectern.snapshot import SnapshotTracker

        session_logs = []

        def emit_event(evt_type: str, message: str, data: Any = None):
            evt = {
                "type": evt_type,
                "message": message,
                "timestamp": int(time.time() * 1000),
            }
            if data is not None:
                evt["data"] = data
            session_logs.append(evt)
            return json.dumps(evt) + "\n"

        yield emit_event(
            "session_start", "Session started", {"session_id": session.session_id}
        )

        # Emit warning if resume was rejected
        if resume_rejection:
            yield emit_event(
                "warning",
                resume_rejection["message"],
                {
                    key: value
                    for key, value in resume_rejection.items()
                    if key != "message"
                },
            )

        # Emit session_resumed event if resuming an existing session
        if existing_session:
            resumed_cards = ensure_cards_have_uid(existing_session.get("cards"))
            resume_data = {
                "session_id": session.session_id,
                "cards": resumed_cards,
                "coverage_data": existing_session.get("coverage_data"),
                "total_pages": existing_session.get("total_pages"),
                "current_phase": existing_session.get("current_phase"),
            }
            yield emit_event("session_resumed", "Session resumed", resume_data)

        tracker = SnapshotTracker(session_id=session.session_id)

        final_cards = existing_session.get("cards", []) if existing_session else []
        final_slide_set_name = (
            existing_session.get("slide_set_name", "Generation")
            if existing_session
            else "Generation"
        )
        final_total_pages = (
            existing_session.get("total_pages") if existing_session else None
        )
        final_coverage_data = (
            existing_session.get("coverage_data") if existing_session else None
        )

        # Track seen UIDs for deduplication
        seen_uids: set[str] = set()
        for card in final_cards:
            uid = card.get("uid") or card.get("_uid")
            if uid:
                seen_uids.add(uid)

        try:
            async for event in service.run(
                pdf_path=tmp_path,
                deck_name=deck_name,
                model_name=model_name,
                tags=tags_list,
                context_deck=context_deck,
                focus_prompt=focus_prompt,
                target_card_count=target_card_count,
                skip_export=True,
                stop_check=lambda: (
                    session_mgr.get_session(session.session_id).stop_requested
                    if session_mgr.get_session(session.session_id)
                    else True
                ),
            ):
                yield emit_event(event.type, event.message, event.data)

                snap = tracker.process_event(
                    event.type, event.data or {}, event.message
                )
                if snap:
                    yield emit_event("control_snapshot", "", snap.to_dict())

                try:
                    event_type = event.type
                    if event.data:
                        if "slide_set_name" in event.data:
                            final_slide_set_name = event.data["slide_set_name"]
                        if "total_pages" in event.data:
                            final_total_pages = event.data["total_pages"]
                        if "coverage_data" in event.data:
                            final_coverage_data = event.data["coverage_data"]
                        if "cards" in event.data:
                            # Deduplicate cards based on UID
                            new_cards = event.data["cards"]
                            deduped_cards = []
                            for card in new_cards:
                                uid = card.get("uid") or card.get("_uid")
                                if not uid or uid not in seen_uids:
                                    if uid:
                                        seen_uids.add(uid)
                                    deduped_cards.append(card)
                            final_cards.extend(deduped_cards)

                    # Update current_phase in database on step_end
                    if event_type == "step_end" and event.data:
                        phase = event.data.get("phase")
                        if phase:
                            await run_in_threadpool(
                                history_mgr.update_session_phase,
                                session.session_id,
                                phase,
                            )

                    if event_type in status_handlers:
                        status, cleanup = status_handlers[event_type]
                        session_mgr.mark_status(session.session_id, status)
                        if cleanup:
                            session_mgr.cleanup_temp_file(session.session_id)

                        if event_type in ("done", "cancelled", "error"):
                            await run_in_threadpool(
                                history_mgr.update_session_logs,
                                session.session_id,
                                session_logs,
                            )

                        if event_type in ("done", "step_end", "cards_replaced"):
                            await run_in_threadpool(
                                history_mgr.sync_session_state,
                                session_id=session.session_id,
                                cards=final_cards,
                                status="completed" if event_type == "done" else None,
                                deck_name=deck_name,
                                slide_set_name=final_slide_set_name,
                                model_name=model_name,
                                tags=tags_list,
                                total_pages=final_total_pages,
                                coverage_data=final_coverage_data,
                                source_file_name=source_file_name,
                                source_pdf_sha256=source_pdf_sha256,
                            )
                except Exception as e:
                    logger.error(f"Error processing event: {e}")
        except Exception as e:
            session_mgr.mark_status(session.session_id, "error")
            yield emit_event("error", f"Generation failed: {str(e)}")
            await run_in_threadpool(
                history_mgr.update_session_logs, session.session_id, session_logs
            )

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/stop", response_model=StopResponse)
async def stop_generation(
    session_id: str | None = None,
    session_mgr: SessionManager = Depends(get_session_manager),
):
    # Note: _get_session_or_404 uses session_manager singleton internally.
    # To be truly DI-compliant, we'd need to refactor it or re-implement its logic here using the injected session_mgr.
    # For now, I'll re-implement the logic using the injected manager to avoid circularity if possible.
    session = (
        session_mgr.get_session(session_id)
        if session_id
        else session_mgr.get_latest_session()
    )
    if not session:
        raise HTTPException(status_code=404, detail="No active session")

    session_mgr.stop_session(session.session_id)
    return {"stopped": True, "session_id": session.session_id}
