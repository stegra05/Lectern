from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from lectern import config
from lectern.ai_pacing import PacingState
from lectern.application.dto import ResumeGenerationRequest, StartGenerationRequest
from lectern.application.ports import AIProviderPort, HistoryRepositoryPort, PdfExtractorPort
from lectern.cost_estimator import derive_effective_target, estimate_card_cap
from lectern.coverage import (
    build_generation_gap_text,
    build_reflection_gap_text,
    compute_coverage_data,
)
from lectern.domain.generation.events import (
    CardEmitted,
    CardsReplaced,
    DomainEvent,
    DomainEventRecord,
    ErrorEmitted,
    PhaseCompleted,
    PhaseStarted,
    ProgressUpdated,
    SessionCompleted,
    SessionStarted,
    WarningEmitted,
)
from lectern.domain_types import CardData, ConceptMapData, CoverageData
from lectern.generation_utils import (
    _annotate_card_quality,
    _coverage_is_sufficient,
    _rebuild_seen_keys,
    _select_best_reflection_cards,
    collect_card_fronts,
    evaluate_grounding_gate,
    get_card_key,
)


@dataclass
class _RunnerState:
    all_cards: list[CardData]
    seen_keys: set[str]
    batch_index: int
    reflection_round: int
    concept_map: ConceptMapData
    total_pages: int
    effective_target: float
    total_cards_cap: int
    actual_batch_size: int
    last_coverage_data: CoverageData
    generation_termination_reason_code: str | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_model_name(value: str | None) -> str:
    return str(value or config.DEFAULT_GEMINI_MODEL)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_card_list(value: Any) -> list[CardData]:
    if not isinstance(value, list):
        return []
    return [dict(card) for card in value if isinstance(card, dict)]


def _high_priority_ids_from_coverage(coverage_data: CoverageData | None) -> set[str]:
    if not coverage_data:
        return set()
    return {
        str(item.get("id") or "").strip()
        for item in (coverage_data.get("missing_high_priority") or [])
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    }


def _build_runner_state_payload(state: _RunnerState) -> dict[str, Any]:
    return {
        "batch_index": state.batch_index,
        "reflection_round": state.reflection_round,
        "all_cards": state.all_cards,
        "seen_keys": sorted(state.seen_keys),
        "concept_map": state.concept_map,
        "total_pages": state.total_pages,
        "effective_target": state.effective_target,
        "total_cards_cap": state.total_cards_cap,
        "actual_batch_size": state.actual_batch_size,
        "last_coverage_data": state.last_coverage_data,
    }


def _event_summary(event: DomainEvent) -> dict[str, Any]:
    if isinstance(event, CardEmitted):
        return {"card_uid": event.card_uid}
    if isinstance(event, CardsReplaced):
        return {"cards": event.cards, "coverage_data": event.coverage_data}
    if isinstance(event, WarningEmitted):
        return {"code": event.code, "message": event.message, "details": event.details}
    if isinstance(event, ProgressUpdated):
        return {"phase": event.phase, "current": event.current, "total": event.total}
    if isinstance(event, PhaseCompleted):
        return {"phase": event.phase, "summary": event.summary}
    if isinstance(event, SessionCompleted):
        return {"summary": event.summary}
    if isinstance(event, ErrorEmitted):
        return {
            "code": event.code,
            "message": event.message,
            "stage": event.stage,
            "recoverable": event.recoverable,
        }
    if isinstance(event, PhaseStarted):
        return {"phase": event.phase}
    if isinstance(event, SessionStarted):
        return {"mode": event.mode}
    return {}


def _event_stage(event: DomainEvent) -> str:
    if isinstance(event, SessionStarted):
        return "session_start"
    if isinstance(event, PhaseStarted):
        return f"{event.phase}_start"
    if isinstance(event, PhaseCompleted):
        return f"{event.phase}_complete"
    if isinstance(event, SessionCompleted):
        return "session_complete"
    if isinstance(event, ErrorEmitted):
        return event.stage
    if isinstance(event, WarningEmitted):
        return "warning"
    if isinstance(event, CardEmitted):
        return "card_emitted"
    if isinstance(event, CardsReplaced):
        return "cards_replaced"
    if isinstance(event, ProgressUpdated):
        return f"{event.phase}_progress"
    return "event"


def _termination_reason_text(code: str) -> str:
    if code == "coverage_sufficient_model_done":
        return (
            "Nice work. You already covered the key topics and concepts in good detail."
        )
    if code == "grounding_non_progress_duplicates":
        return (
            "You already built strong coverage. New grounded candidates were mostly repeats, so adding more would likely duplicate what you have."
        )
    if code == "grounding_non_progress_gate_failures":
        return (
            "You have a solid set now. Additional candidates were not meeting grounding quality standards."
        )
    if code == "max_cap_reached":
        return "Nice progress. This session reached the configured maximum cards for one run."
    return "Session complete with strong coverage."


def _build_completion_summary(
    *,
    cards_generated: int,
    duration_ms: int,
    requested_card_target: int | None,
    termination_reason_code: str,
) -> dict[str, Any]:
    target_shortfall = (
        max(int(requested_card_target) - cards_generated, 0)
        if requested_card_target is not None
        else None
    )
    reason_text = _termination_reason_text(termination_reason_code)
    if requested_card_target is not None:
        run_summary = (
            f"Generated {cards_generated} of requested {requested_card_target} cards. {reason_text}"
        )
    else:
        run_summary = f"Generated {cards_generated} cards. {reason_text}"
    return {
        "cards_generated": cards_generated,
        "duration_ms": duration_ms,
        "requested_card_target": requested_card_target,
        "target_shortfall": target_shortfall,
        "termination_reason_code": termination_reason_code,
        "termination_reason_text": reason_text,
        "run_summary_text": run_summary,
    }


async def _emit_with_runner_state(
    history: HistoryRepositoryPort | None,
    session_id: str,
    cursor_ref: dict[str, int],
    state: _RunnerState,
    event: DomainEvent,
) -> AsyncIterator[DomainEvent]:
    has_append = bool(history is not None and hasattr(history, "append_events"))
    has_sync = bool(history is not None and hasattr(history, "sync_state"))
    if has_append:
        next_sequence = int(cursor_ref.get("value", 0)) + 1
        cursor_ref["value"] = next_sequence
        record = DomainEventRecord(
            session_id=session_id,
            sequence_no=next_sequence,
            event=event,
        )
        assert history is not None
        await history.append_events(session_id, [record])
        if has_sync:
            phase = "generation"
            if isinstance(event, PhaseStarted):
                phase = str(event.phase)
            elif isinstance(event, PhaseCompleted):
                phase = str(event.phase)
            snapshot: dict[str, Any] = {
                "session_id": session_id,
                "cursor": next_sequence,
                "phase": phase,
                "status": "running",
                "runner_state": _build_runner_state_payload(state),
                "last_event": {
                    "type": event.event_type.value,  # type: ignore[attr-defined]
                    "stage": _event_stage(event),
                    "summary": _event_summary(event),
                },
                "updated_at_ms": _now_ms(),
            }
            if isinstance(event, SessionCompleted):
                snapshot["status"] = "completed"
            if isinstance(event, ErrorEmitted) and not event.recoverable:
                snapshot["status"] = "error"
            await history.sync_state(snapshot)
    yield event


def _infer_phase(session: dict[str, Any]) -> str:
    phase = str(session.get("phase") or "generation")
    if phase not in {"generation", "reflection"}:
        return "generation"
    return phase


async def _rebuild_state_from_history(
    *,
    session_id: str,
    history: HistoryRepositoryPort,
    concept_map: ConceptMapData,
    total_pages: int,
    total_cards_cap: int,
    actual_batch_size: int,
    effective_target: float,
) -> _RunnerState:
    cursor = _safe_int(0)
    cards: list[CardData] = []
    coverage: CoverageData = compute_coverage_data(
        cards=[],
        concept_map=concept_map,
        total_pages=total_pages,
    )
    while True:
        records = await history.get_events_after(
            session_id,
            after_sequence_no=cursor,
            limit=1000,
        )
        if not records:
            break
        for record in records:
            cursor = max(cursor, int(record.sequence_no))
            if isinstance(record.event, CardEmitted):
                cards.append(dict(record.event.card_payload))
            elif isinstance(record.event, CardsReplaced):
                cards = [dict(card) for card in record.event.cards if isinstance(card, dict)]
                coverage = dict(record.event.coverage_data)
    if not cards:
        coverage = compute_coverage_data(
            cards=[],
            concept_map=concept_map,
            total_pages=total_pages,
        )
    return _RunnerState(
        all_cards=cards,
        seen_keys=_rebuild_seen_keys(cards),
        batch_index=0,
        reflection_round=0,
        concept_map=concept_map,
        total_pages=total_pages,
        effective_target=effective_target,
        total_cards_cap=total_cards_cap,
        actual_batch_size=actual_batch_size,
        last_coverage_data=coverage,
    )


def _load_runner_state(
    *,
    session: dict[str, Any],
    concept_map: ConceptMapData,
    total_pages: int,
    total_cards_cap: int,
    actual_batch_size: int,
    effective_target: float,
) -> _RunnerState | None:
    payload = session.get("runner_state")
    if not isinstance(payload, dict):
        return None
    cards = _safe_card_list(payload.get("all_cards"))
    coverage_raw = payload.get("last_coverage_data")
    coverage = dict(coverage_raw) if isinstance(coverage_raw, dict) else compute_coverage_data(
        cards=cards,
        concept_map=concept_map,
        total_pages=total_pages,
    )
    return _RunnerState(
        all_cards=cards,
        seen_keys={
            str(key).strip()
            for key in (payload.get("seen_keys") or [])
            if str(key).strip()
        }
        or _rebuild_seen_keys(cards),
        batch_index=_safe_int(payload.get("batch_index"), 0),
        reflection_round=_safe_int(payload.get("reflection_round"), 0),
        concept_map=dict(payload.get("concept_map") or concept_map),
        total_pages=_safe_int(payload.get("total_pages"), total_pages),
        effective_target=_safe_float(payload.get("effective_target"), effective_target),
        total_cards_cap=_safe_int(payload.get("total_cards_cap"), total_cards_cap),
        actual_batch_size=_safe_int(payload.get("actual_batch_size"), actual_batch_size),
        last_coverage_data=coverage,
    )


async def _run_generation_phase(
    *,
    session_id: str,
    req: StartGenerationRequest | ResumeGenerationRequest,
    state: _RunnerState,
    ai_provider: AIProviderPort,
    history: HistoryRepositoryPort | None,
    cursor_ref: dict[str, int],
    min_quality: float,
    retry_max_attempts: int,
    non_progress_max_batches: int,
    examples: str = "",
    feedback_summary: dict[str, Any] | None = None,
) -> AsyncIterator[DomainEvent]:
    phase_started_at = time.perf_counter()
    async for event in _emit_with_runner_state(
        history,
        session_id,
        cursor_ref,
        state,
        PhaseStarted(phase="generation"),
    ):
        yield event

    consecutive_zero_promoted_batches = 0

    while len(state.all_cards) < state.total_cards_cap:
        state.batch_index += 1
        remaining = state.total_cards_cap - len(state.all_cards)
        limit = max(1, min(state.actual_batch_size, remaining))

        state.last_coverage_data = compute_coverage_data(
            cards=state.all_cards,
            concept_map=state.concept_map,
            total_pages=state.total_pages,
        )
        recent_keys = [
            get_card_key(card)[:120]
            for card in state.all_cards[-config.REFLECTION_RECENT_CARD_WINDOW :]
            if get_card_key(card)
        ]
        covered_slides = list(state.last_coverage_data.get("covered_pages") or [])
        pacing_hint = PacingState(
            current_cards=len(state.all_cards),
            covered_slides=covered_slides,
            total_pages=state.total_pages,
            focus_prompt=getattr(req, "focus_prompt", "") or "",
            target_density=state.effective_target,
            feedback_summary=feedback_summary,
        ).hint

        out = await ai_provider.generate_cards(
            limit=limit,
            context={
                "examples": examples if len(state.all_cards) == 0 else "",
                "avoid_fronts": recent_keys,
                "covered_slides": covered_slides,
                "pacing_hint": pacing_hint,
                "all_card_fronts": collect_card_fronts(state.all_cards)[-200:],
                "coverage_gap_text": build_generation_gap_text(state.last_coverage_data),
            },
        )

        provider_warnings = list(out.get("warnings") or []) + list(ai_provider.drain_warnings())
        for warning in provider_warnings:
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                WarningEmitted(
                    code="provider_warning",
                    message=str(warning),
                    details={"batch_index": state.batch_index},
                ),
            ):
                yield event

        new_cards = [card for card in list(out.get("cards") or []) if isinstance(card, dict)]
        model_done = bool(out.get("done", False))
        parse_error = str(out.get("parse_error") or "").strip()
        if parse_error:
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                WarningEmitted(
                    code="provider_parse_error",
                    message=(
                        "Generation response could not be fully parsed; treating batch as exhausted."
                    ),
                    details={
                        "batch_index": state.batch_index,
                        "parse_error": parse_error,
                    },
                ),
            ):
                yield event

        def _bump(counter: dict[str, int], key: str, amount: int = 1) -> None:
            counter[key] = counter.get(key, 0) + amount

        high_priority_ids = _high_priority_ids_from_coverage(state.last_coverage_data)
        generated_candidates_count = len(new_cards)
        grounding_repair_attempted_count = 0
        grounding_promoted_count = 0
        duplicate_drop_count = 0
        gate_failure_drop_count = 0
        grounding_drop_reasons: dict[str, int] = {}

        promotable_cards: list[CardData] = []
        cards_needing_repair: list[tuple[CardData, list[str]]] = []
        local_candidate_keys: set[str] = set()

        for card in new_cards:
            annotated_card = _annotate_card_quality(card, high_priority_ids=high_priority_ids)
            card_key = get_card_key(annotated_card)
            if (
                not card_key
                or card_key in state.seen_keys
                or card_key in local_candidate_keys
            ):
                duplicate_drop_count += 1
                _bump(grounding_drop_reasons, "duplicate")
                continue
            local_candidate_keys.add(card_key)

            gate_ok, gate_reasons = evaluate_grounding_gate(
                annotated_card,
                min_quality=min_quality,
            )
            if gate_ok:
                promotable_cards.append(annotated_card)
            else:
                cards_needing_repair.append((annotated_card, gate_reasons))

        for weak_card, weak_reasons in cards_needing_repair:
            input_card_key = get_card_key(weak_card)
            final_reasons = list(weak_reasons)
            repaired_ok = False

            for attempt_idx in range(retry_max_attempts):
                grounding_repair_attempted_count += 1
                strict_mode = attempt_idx > 0
                repair_out = await ai_provider.repair_card(
                    card=weak_card,
                    reasons=final_reasons,
                    context={"strict": strict_mode},
                )
                repair_warnings = list(repair_out.get("warnings") or []) + list(
                    ai_provider.drain_warnings()
                )
                for warning in repair_warnings:
                    async for event in _emit_with_runner_state(
                        history,
                        session_id,
                        cursor_ref,
                        state,
                        WarningEmitted(
                            code="repair_warning",
                            message=str(warning),
                            details={
                                "batch_index": state.batch_index,
                                "card_key": input_card_key,
                                "attempt": attempt_idx + 1,
                                "strict": strict_mode,
                            },
                        ),
                    ):
                        yield event

                candidate_raw = repair_out.get("card")
                candidate = candidate_raw if isinstance(candidate_raw, dict) else None
                if not candidate:
                    final_reasons = ["invalid_repaired_payload"]
                    _bump(grounding_drop_reasons, "invalid_repaired_payload")
                    continue

                annotated_repair = _annotate_card_quality(
                    candidate,
                    high_priority_ids=high_priority_ids,
                )
                repaired_key = get_card_key(annotated_repair)
                if not repaired_key:
                    final_reasons = ["invalid_repaired_payload"]
                    _bump(grounding_drop_reasons, "invalid_repaired_payload")
                    continue

                if repaired_key in state.seen_keys:
                    final_reasons = ["duplicate"]
                    _bump(grounding_drop_reasons, "duplicate")
                    duplicate_drop_count += 1
                    break

                gate_ok, gate_reasons = evaluate_grounding_gate(
                    annotated_repair,
                    min_quality=min_quality,
                )
                if gate_ok:
                    promotable_cards.append(annotated_repair)
                    repaired_ok = True
                    break
                final_reasons = gate_reasons

            if not repaired_ok and "duplicate" not in final_reasons:
                gate_failure_drop_count += 1
                for reason in final_reasons:
                    _bump(grounding_drop_reasons, reason)
                async for event in _emit_with_runner_state(
                    history,
                    session_id,
                    cursor_ref,
                    state,
                    WarningEmitted(
                        code="card_dropped_after_repair",
                        message=(
                            "Card dropped after repair attempts failed grounding gate."
                        ),
                        details={
                            "batch_index": state.batch_index,
                            "card_key": input_card_key,
                            "reasons": final_reasons,
                            "attempts": retry_max_attempts,
                        },
                    ),
                ):
                    yield event

        for promotable in promotable_cards:
            key = get_card_key(promotable)
            if not key or key in state.seen_keys:
                duplicate_drop_count += 1
                _bump(grounding_drop_reasons, "duplicate")
                continue
            card_uid = str(promotable.get("uid") or promotable.get("_uid") or uuid.uuid4().hex)
            promotable["uid"] = card_uid
            promotable["_uid"] = card_uid
            state.all_cards.append(promotable)
            state.seen_keys.add(key)
            grounding_promoted_count += 1
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                CardEmitted(
                    card_uid=card_uid,
                    batch_index=state.batch_index,
                    card_payload=dict(promotable),
                ),
            ):
                yield event

        state.last_coverage_data = compute_coverage_data(
            cards=state.all_cards,
            concept_map=state.concept_map,
            total_pages=state.total_pages,
        )
        async for event in _emit_with_runner_state(
            history,
            session_id,
            cursor_ref,
            state,
            ProgressUpdated(
                phase="generation",
                current=len(state.all_cards),
                total=state.total_cards_cap,
            ),
        ):
            yield event

        if model_done and _coverage_is_sufficient(state.last_coverage_data):
            state.generation_termination_reason_code = "coverage_sufficient_model_done"
            break

        if grounding_promoted_count == 0:
            consecutive_zero_promoted_batches += 1
        else:
            consecutive_zero_promoted_batches = 0

        if consecutive_zero_promoted_batches >= non_progress_max_batches:
            reason = (
                "grounding_non_progress_duplicates"
                if duplicate_drop_count > gate_failure_drop_count
                else "grounding_non_progress_gate_failures"
            )
            state.generation_termination_reason_code = reason
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                WarningEmitted(
                    code=reason,
                    message="Stopping generation due to non-progress in grounded promotion.",
                    details={
                        "consecutive_zero_promoted_batches": consecutive_zero_promoted_batches,
                        "last_batch_generated_candidates_count": generated_candidates_count,
                        "last_batch_grounding_repair_attempted_count": grounding_repair_attempted_count,
                        "last_batch_grounding_promoted_count": grounding_promoted_count,
                        "last_batch_grounding_dropped_count": max(
                            generated_candidates_count - grounding_promoted_count,
                            0,
                        ),
                        "last_batch_grounding_drop_reasons": grounding_drop_reasons,
                    },
                ),
            ):
                yield event
            break

        if model_done:
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                WarningEmitted(
                    code="model_premature_done",
                    message="Model reported done, but coverage is insufficient. Forcing another batch.",
                    details={},
                ),
            ):
                yield event

    if state.generation_termination_reason_code is None:
        state.generation_termination_reason_code = "max_cap_reached"

    generation_duration = int((time.perf_counter() - phase_started_at) * 1000)
    async for event in _emit_with_runner_state(
        history,
        session_id,
        cursor_ref,
        state,
        PhaseCompleted(
            phase="generation",
            duration_ms=generation_duration,
            summary={
                "cards_generated": len(state.all_cards),
                "batches": state.batch_index,
            },
        ),
    ):
        yield event


async def _run_reflection_phase(
    *,
    session_id: str,
    state: _RunnerState,
    ai_provider: AIProviderPort,
    history: HistoryRepositoryPort | None,
    cursor_ref: dict[str, int],
    min_quality: float,
) -> AsyncIterator[DomainEvent]:
    phase_started_at = time.perf_counter()
    async for event in _emit_with_runner_state(
        history,
        session_id,
        cursor_ref,
        state,
        PhaseStarted(phase="reflection"),
    ):
        yield event

    reflection_hard_cap = int(state.total_cards_cap * config.REFLECTION_HARD_CAP_MULTIPLIER) + int(
        config.REFLECTION_HARD_CAP_PADDING
    )
    max_rounds = max(1, min(3, len(state.all_cards) or 1))

    for _ in range(max_rounds):
        state.reflection_round += 1
        remaining = max(0, reflection_hard_cap - len(state.all_cards))
        if remaining == 0:
            break

        batch_size = min(len(state.all_cards), remaining)
        if batch_size == 0:
            break

        cards_to_refine = [dict(card) for card in state.all_cards[:batch_size]]
        state.last_coverage_data = compute_coverage_data(
            cards=state.all_cards,
            concept_map=state.concept_map,
            total_pages=state.total_pages,
        )
        out = await ai_provider.reflect_cards(
            limit=batch_size,
            context={
                "all_card_fronts": collect_card_fronts(state.all_cards)[-200:],
                "cards_to_refine_json": json.dumps(cards_to_refine, ensure_ascii=False),
                "coverage_gaps": build_reflection_gap_text(state.last_coverage_data),
            },
        )

        provider_warnings = list(out.get("warnings") or []) + list(ai_provider.drain_warnings())
        for warning in provider_warnings:
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                WarningEmitted(
                    code="provider_reflection_warning",
                    message=str(warning),
                    details={"round": state.reflection_round},
                ),
            ):
                yield event

        reflected_cards = [card for card in list(out.get("cards") or []) if isinstance(card, dict)]
        parse_error = str(out.get("parse_error") or "").strip()
        if parse_error:
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                WarningEmitted(
                    code="provider_parse_error",
                    message="Reflection response could not be fully parsed; keeping strongest cards.",
                    details={"round": state.reflection_round, "parse_error": parse_error},
                ),
            ):
                yield event

        selected_cards, selection_summary = _select_best_reflection_cards(
            original_cards=cards_to_refine,
            reflected_cards=reflected_cards,
            limit=batch_size,
            concept_map=state.concept_map,
            total_pages=state.total_pages,
        )

        accepted_selected_cards: list[CardData] = []
        for idx, original in enumerate(cards_to_refine):
            selected = selected_cards[idx] if idx < len(selected_cards) else original
            selected_key = get_card_key(selected)
            original_key = get_card_key(original)

            if selected_key == original_key:
                accepted_selected_cards.append(original)
                continue

            gate_ok, gate_reasons = evaluate_grounding_gate(
                selected,
                min_quality=min_quality,
            )
            if gate_ok:
                accepted_selected_cards.append(selected)
            else:
                async for event in _emit_with_runner_state(
                    history,
                    session_id,
                    cursor_ref,
                    state,
                    WarningEmitted(
                        code="grounding_gate_failed",
                        message="Reflection replacement rejected by grounding gate.",
                        details={
                            "round": state.reflection_round,
                            "card_key": get_card_key(selected),
                            "reasons": gate_reasons,
                        },
                    ),
                ):
                    yield event
                accepted_selected_cards.append(original)

        original_keys = [get_card_key(card) for card in cards_to_refine]
        selected_keys = [get_card_key(card) for card in accepted_selected_cards]
        did_change = selected_keys != original_keys or any(
            dict(selected) != dict(original)
            for selected, original in zip(accepted_selected_cards, cards_to_refine, strict=False)
        )

        state.all_cards = accepted_selected_cards + state.all_cards[batch_size:]
        for card in accepted_selected_cards:
            card_uid = str(card.get("uid") or card.get("_uid") or uuid.uuid4().hex)
            card["uid"] = card_uid
            card["_uid"] = card_uid
        state.seen_keys = _rebuild_seen_keys(state.all_cards)
        state.last_coverage_data = compute_coverage_data(
            cards=state.all_cards,
            concept_map=state.concept_map,
            total_pages=state.total_pages,
        )

        if did_change:
            async for event in _emit_with_runner_state(
                history,
                session_id,
                cursor_ref,
                state,
                CardsReplaced(
                    batch_index=state.reflection_round,
                    cards=[dict(card) for card in state.all_cards],
                    coverage_data=dict(state.last_coverage_data),
                ),
            ):
                yield event

        async for event in _emit_with_runner_state(
            history,
            session_id,
            cursor_ref,
            state,
            ProgressUpdated(
                phase="reflection",
                current=state.reflection_round,
                total=max_rounds,
            ),
        ):
            yield event

        if len(state.all_cards) >= reflection_hard_cap or not did_change or bool(out.get("done", False)):
            break

    reflection_duration = int((time.perf_counter() - phase_started_at) * 1000)
    async for event in _emit_with_runner_state(
        history,
        session_id,
        cursor_ref,
        state,
        PhaseCompleted(
            phase="reflection",
            duration_ms=reflection_duration,
            summary={
                "cards_reflected": len(state.all_cards),
                "rounds": state.reflection_round,
            },
        ),
    ):
        yield event


def make_start_runner(
    *,
    pdf_extractor: PdfExtractorPort,
    ai_provider: AIProviderPort,
    history: HistoryRepositoryPort | None = None,
):
    async def run_generation(req: StartGenerationRequest) -> AsyncIterator[DomainEvent]:
        session_id = f"runner-{uuid.uuid4().hex}"
        cursor_ref = {"value": 0}
        run_started_at = time.perf_counter()

        metadata = await pdf_extractor.extract_metadata(req.pdf_path)
        uploaded = await ai_provider.upload_document(req.pdf_path)
        uploaded_uri = str(getattr(uploaded, "uri", "") or "")
        uploaded_mime_type = str(
            getattr(uploaded, "mime_type", "") or "application/pdf"
        )
        concept_map_raw = await ai_provider.build_concept_map(uploaded_uri, uploaded_mime_type)
        concept_map: ConceptMapData = (
            dict(concept_map_raw) if isinstance(concept_map_raw, dict) else {}
        )
        total_pages = max(
            1,
            _safe_int(
                concept_map.get("page_count"),
                _safe_int(getattr(metadata, "page_count", 0), 1),
            ),
        )
        estimated_text_chars = _safe_int(
            concept_map.get("estimated_text_chars"),
            _safe_int(getattr(metadata, "text_chars", 0), 0),
        )
        image_count = _safe_int(getattr(metadata, "image_count", 0), 0)
        document_type = str(concept_map.get("document_type") or "").strip() or None
        effective_target, _ = derive_effective_target(
            page_count=total_pages,
            estimated_text_chars=estimated_text_chars,
            target_card_count=req.target_card_count,
            density_target=None,
            script_base_chars=config.SCRIPT_BASE_CHARS,
            force_mode=document_type,
        )
        total_cards_cap, _ = estimate_card_cap(
            page_count=total_pages,
            estimated_text_chars=estimated_text_chars,
            image_count=image_count,
            density_target=None,
            target_card_count=req.target_card_count,
            script_base_chars=config.SCRIPT_BASE_CHARS,
            force_mode=document_type,
        )
        actual_batch_size = max(
            1,
            min(config.MAX_NOTES_PER_BATCH, max(config.MIN_NOTES_PER_BATCH, total_cards_cap)),
        )
        initial_coverage = compute_coverage_data(
            cards=[],
            concept_map=concept_map,
            total_pages=total_pages,
        )
        state = _RunnerState(
            all_cards=[],
            seen_keys=set(),
            batch_index=0,
            reflection_round=0,
            concept_map=concept_map,
            total_pages=total_pages,
            effective_target=float(effective_target),
            total_cards_cap=int(total_cards_cap),
            actual_batch_size=actual_batch_size,
            last_coverage_data=initial_coverage,
        )

        async for event in _emit_with_runner_state(
            history,
            session_id,
            cursor_ref,
            state,
            SessionStarted(session_id=session_id, mode="start"),
        ):
            yield event

        async for event in _run_generation_phase(
            session_id=session_id,
            req=req,
            state=state,
            ai_provider=ai_provider,
            history=history,
            cursor_ref=cursor_ref,
            min_quality=float(config.GROUNDING_GATE_MIN_QUALITY),
            retry_max_attempts=max(1, int(config.GROUNDING_RETRY_MAX_ATTEMPTS)),
            non_progress_max_batches=max(1, int(config.GROUNDING_NON_PROGRESS_MAX_BATCHES)),
            examples="",
            feedback_summary=None,
        ):
            yield event

        async for event in _run_reflection_phase(
            session_id=session_id,
            state=state,
            ai_provider=ai_provider,
            history=history,
            cursor_ref=cursor_ref,
            min_quality=float(config.GROUNDING_GATE_MIN_QUALITY),
        ):
            yield event

        total_duration = int((time.perf_counter() - run_started_at) * 1000)
        async for event in _emit_with_runner_state(
            history,
            session_id,
            cursor_ref,
            state,
            SessionCompleted(
                summary=_build_completion_summary(
                    cards_generated=len(state.all_cards),
                    duration_ms=total_duration,
                    requested_card_target=req.target_card_count,
                    termination_reason_code=(
                        state.generation_termination_reason_code
                        or "generation_completed"
                    ),
                )
            ),
        ):
            yield event

    return run_generation


def make_resume_runner(
    *,
    ai_provider: AIProviderPort,
    history: HistoryRepositoryPort,
    pdf_extractor: PdfExtractorPort | None = None,
):
    _ = pdf_extractor

    async def run_resume(
        req: ResumeGenerationRequest,
        session: dict[str, Any],
    ) -> AsyncIterator[DomainEvent]:
        session_id = req.session_id
        cursor_ref = {"value": _safe_int(session.get("cursor"), 0)}
        run_started_at = time.perf_counter()

        runner_payload = session.get("runner_state")
        concept_map: ConceptMapData = {}
        total_pages = max(1, _safe_int(session.get("total_pages"), 1))
        if isinstance(runner_payload, dict):
            concept_map_raw = runner_payload.get("concept_map")
            if isinstance(concept_map_raw, dict):
                concept_map = dict(concept_map_raw)
            total_pages = max(
                1,
                _safe_int(runner_payload.get("total_pages"), total_pages),
            )
        if not concept_map:
            concept_map = {
                "concepts": [],
                "relations": [],
                "objectives": [],
                "page_count": total_pages,
            }

        total_cards_cap = _safe_int(
            (runner_payload or {}).get("total_cards_cap") if isinstance(runner_payload, dict) else None,
            max(config.MIN_NOTES_PER_BATCH, 20),
        )
        actual_batch_size = _safe_int(
            (runner_payload or {}).get("actual_batch_size") if isinstance(runner_payload, dict) else None,
            max(1, min(config.MAX_NOTES_PER_BATCH, total_cards_cap)),
        )
        effective_target = _safe_float(
            (runner_payload or {}).get("effective_target") if isinstance(runner_payload, dict) else None,
            float(getattr(config, "CARDS_PER_SLIDE_TARGET", 0.6)),
        )

        state = _load_runner_state(
            session=session,
            concept_map=concept_map,
            total_pages=total_pages,
            total_cards_cap=total_cards_cap,
            actual_batch_size=actual_batch_size,
            effective_target=effective_target,
        )
        if state is None:
            state = await _rebuild_state_from_history(
                session_id=session_id,
                history=history,
                concept_map=concept_map,
                total_pages=total_pages,
                total_cards_cap=total_cards_cap,
                actual_batch_size=actual_batch_size,
                effective_target=effective_target,
            )

        phase = _infer_phase(session)
        if phase == "generation":
            async for event in _run_generation_phase(
                session_id=session_id,
                req=req,
                state=state,
                ai_provider=ai_provider,
                history=history,
                cursor_ref=cursor_ref,
                min_quality=float(config.GROUNDING_GATE_MIN_QUALITY),
                retry_max_attempts=max(1, int(config.GROUNDING_RETRY_MAX_ATTEMPTS)),
                non_progress_max_batches=max(1, int(config.GROUNDING_NON_PROGRESS_MAX_BATCHES)),
                examples="",
                feedback_summary=None,
            ):
                yield event

        async for event in _run_reflection_phase(
            session_id=session_id,
            state=state,
            ai_provider=ai_provider,
            history=history,
            cursor_ref=cursor_ref,
            min_quality=float(config.GROUNDING_GATE_MIN_QUALITY),
        ):
            yield event

        total_duration = int((time.perf_counter() - run_started_at) * 1000)
        async for event in _emit_with_runner_state(
            history,
            session_id,
            cursor_ref,
            state,
            SessionCompleted(
                summary=_build_completion_summary(
                    cards_generated=len(state.all_cards),
                    duration_ms=total_duration,
                    requested_card_target=_safe_int(session.get("target_card_count"), 0) or None,
                    termination_reason_code=(
                        state.generation_termination_reason_code
                        or "generation_completed"
                    ),
                )
            ),
        ):
            yield event

    return run_resume
