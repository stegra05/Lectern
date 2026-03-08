from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from html import unescape
from typing import Any, Callable, Dict, Generator, Iterable, List, Optional

from lectern.ai_pacing import PacingState
from lectern.coverage import (
    build_generation_gap_text,
    build_reflection_gap_text,
    compute_coverage_data,
    get_card_concept_ids,
    get_card_page_references,
    get_card_relation_keys,
)
from lectern.utils.error_handling import capture_exception

logger = logging.getLogger(__name__)

# Default values for reflection configuration
DEFAULT_RECENT_CARD_WINDOW = 100
DEFAULT_REFLECTION_HARD_CAP_MULTIPLIER = 1.2
DEFAULT_REFLECTION_HARD_CAP_PADDING = 5
_HTML_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
_CLOZE_RE = re.compile(r"\{\{c\d+::(.*?)(?:::[^}]*)?\}\}")
_NON_WORD_RE = re.compile(r"[^\w\s]")


@dataclass(frozen=True)
class GenerationLoopContext:
    ai: Any
    examples: str
    concept_map: Dict[str, Any]
    slide_set_name: str
    model_name: str
    tags: List[str]
    pdf_path: str
    deck_name: str
    history_id: Optional[str]
    session_id: Optional[str]


@dataclass
class GenerationLoopState:
    all_cards: List[Dict[str, Any]]
    seen_keys: set
    pages: List[Any]


@dataclass(frozen=True)
class GenerationLoopConfig:
    total_cards_cap: int
    actual_batch_size: int
    focus_prompt: Optional[str]
    effective_target: float
    stop_check: Optional[Callable[[], bool]]
    # Configuration for recent card window
    recent_card_window: int = DEFAULT_RECENT_CARD_WINDOW


@dataclass(frozen=True)
class ReflectionLoopConfig:
    total_cards_cap: int
    actual_batch_size: int
    rounds: int
    stop_check: Optional[Callable[[], bool]]
    # Configuration for reflection limits
    recent_card_window: int = DEFAULT_RECENT_CARD_WINDOW
    hard_cap_multiplier: float = DEFAULT_REFLECTION_HARD_CAP_MULTIPLIER
    hard_cap_padding: int = DEFAULT_REFLECTION_HARD_CAP_PADDING


def get_card_key(card: Dict[str, Any]) -> str:
    fields = card.get("fields") or {}
    val = str(
        card.get("text")
        or card.get("front")
        or fields.get("Text")
        or fields.get("Front")
        or ""
    )
    val = _strip_markup(val)
    val = _CLOZE_RE.sub(r"\1", val)
    val = _NON_WORD_RE.sub(" ", val)
    return " ".join(val.lower().split())


def _strip_markup(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", _HTML_RE.sub(" ", unescape(str(value or "")))).strip()


def _get_card_field(card: Dict[str, Any], field_name: str) -> str:
    fields = card.get("fields") or {}
    if isinstance(fields, dict):
        return str(fields.get(field_name) or "")
    return ""


def _get_card_front(card: Dict[str, Any]) -> str:
    return str(card.get("front") or _get_card_field(card, "Front") or card.get("text") or _get_card_field(card, "Text") or "")


def _get_card_back(card: Dict[str, Any]) -> str:
    return str(card.get("back") or _get_card_field(card, "Back") or "")


def _coerce_score(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(100.0, score))


def _normalize_flags(flags: Any) -> List[str]:
    if isinstance(flags, list):
        return [str(flag).strip() for flag in flags if str(flag).strip()]
    if isinstance(flags, str) and flags.strip():
        return [flag.strip() for flag in flags.split(",") if flag.strip()]
    return []


def _estimate_card_quality(
    card: Dict[str, Any],
    *,
    high_priority_ids: set[str] | None = None,
) -> tuple[float, List[str]]:
    high_priority_ids = high_priority_ids or set()
    flags: List[str] = []
    score = 30.0

    front = _strip_markup(_get_card_front(card))
    back = _strip_markup(_get_card_back(card))
    text = _strip_markup(str(card.get("text") or _get_card_field(card, "Text") or ""))
    answer_text = text or back
    source_pages = get_card_page_references(card)
    concept_ids = get_card_concept_ids(card)
    relation_keys = get_card_relation_keys(card)
    rationale = _strip_markup(str(card.get("rationale") or ""))
    source_excerpt = _strip_markup(str(card.get("source_excerpt") or ""))

    if front or text:
        score += 12
    else:
        flags.append("missing_prompt_text")
        score -= 20

    if answer_text:
        score += 10
    else:
        flags.append("missing_answer_text")
        score -= 15

    if source_pages:
        score += 12
    else:
        flags.append("missing_source_pages")
        score -= 10

    if concept_ids:
        score += 12
    else:
        flags.append("missing_concept_ids")
        score -= 8

    if relation_keys:
        score += 6

    if rationale:
        score += 7
    else:
        flags.append("missing_rationale")
        score -= 4

    if source_excerpt:
        score += 6
    else:
        flags.append("missing_source_excerpt")
        score -= 4

    if card.get("slide_number"):
        score += 3

    if len(front) > 180:
        flags.append("long_front")
        score -= 8
    if len(answer_text) > 420:
        flags.append("long_answer")
        score -= 8
    if len(source_pages) > 3:
        flags.append("broad_grounding")
        score -= 3
    if high_priority_ids.intersection(concept_ids):
        score += 5

    return max(0.0, min(100.0, score)), sorted(set(flags))


def _annotate_card_quality(
    card: Dict[str, Any],
    *,
    high_priority_ids: set[str] | None = None,
) -> Dict[str, Any]:
    annotated = dict(card)
    local_score, local_flags = _estimate_card_quality(annotated, high_priority_ids=high_priority_ids)
    model_score = _coerce_score(annotated.get("quality_score"))
    if model_score is None:
        final_score = local_score
    else:
        final_score = round((model_score + local_score) / 2.0, 1)
    merged_flags = sorted(set(_normalize_flags(annotated.get("quality_flags"))) | set(local_flags))
    annotated["quality_score"] = round(final_score, 1)
    annotated["quality_flags"] = merged_flags
    return annotated


def _coverage_is_sufficient(coverage_data: Dict[str, Any]) -> bool:
    high_priority_total = int(coverage_data.get("high_priority_total") or 0)
    high_priority_covered = int(coverage_data.get("high_priority_covered") or 0)
    high_priority_ok = high_priority_total == 0 or high_priority_covered >= high_priority_total
    page_pct = float(coverage_data.get("page_coverage_pct") or 0)
    explicit_concept_pct = float(coverage_data.get("explicit_concept_coverage_pct") or 0)
    relation_pct = float(coverage_data.get("relation_coverage_pct") or 0)
    total_relations = int(coverage_data.get("total_relations") or 0)
    relation_ok = total_relations == 0 or relation_pct >= 50
    return high_priority_ok and relation_ok and (explicit_concept_pct >= 60 or page_pct >= 75)


def _select_best_reflection_cards(
    *,
    original_cards: List[Dict[str, Any]],
    reflected_cards: List[Dict[str, Any]],
    limit: int,
    concept_map: Dict[str, Any],
    total_pages: int,
) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    baseline = compute_coverage_data(cards=[], concept_map=concept_map, total_pages=total_pages)
    high_priority_ids = {
        str(item.get("id") or "").strip()
        for item in (baseline.get("missing_high_priority") or [])
        if str(item.get("id") or "").strip()
    }
    candidates: List[Dict[str, Any]] = []
    for card in original_cards + reflected_cards:
        if not isinstance(card, dict):
            continue
        annotated = _annotate_card_quality(card, high_priority_ids=high_priority_ids)
        if get_card_key(annotated):
            candidates.append(annotated)

    selected: List[Dict[str, Any]] = []
    selected_keys: set[str] = set()
    selected_pages: set[int] = set()
    selected_concepts: set[str] = set()
    selected_relations: set[str] = set()
    per_page_counts: Dict[int, int] = {}

    def candidate_priority(card: Dict[str, Any]) -> float:
        base_score = float(card.get("quality_score") or 0.0)
        pages = set(get_card_page_references(card))
        concepts = set(get_card_concept_ids(card))
        relations = set(get_card_relation_keys(card))
        new_pages = pages.difference(selected_pages)
        new_concepts = concepts.difference(selected_concepts)
        new_relations = relations.difference(selected_relations)
        new_high_priority = high_priority_ids.intersection(new_concepts)
        saturation_penalty = sum(max((per_page_counts.get(page, 0) + 1) - 2, 0) for page in pages)
        return (
            base_score
            + len(new_high_priority) * 8.0
            + len(new_concepts) * 4.0
            + len(new_relations) * 3.0
            + len(new_pages) * 1.5
            - saturation_penalty * 6.0
        )

    remaining = list(candidates)
    while remaining and len(selected) < limit:
        best_idx = -1
        best_priority = float("-inf")
        for idx, card in enumerate(remaining):
            card_key = get_card_key(card)
            if not card_key or card_key in selected_keys:
                continue
            priority = candidate_priority(card)
            if priority > best_priority:
                best_priority = priority
                best_idx = idx
        if best_idx < 0:
            break
        chosen = remaining.pop(best_idx)
        selected.append(chosen)
        selected_keys.add(get_card_key(chosen))
        pages = get_card_page_references(chosen)
        selected_pages.update(pages)
        selected_concepts.update(get_card_concept_ids(chosen))
        selected_relations.update(get_card_relation_keys(chosen))
        for page in pages:
            per_page_counts[page] = per_page_counts.get(page, 0) + 1

    if not selected:
        selected = [_annotate_card_quality(card, high_priority_ids=high_priority_ids) for card in original_cards[:limit]]

    selected_coverage = compute_coverage_data(
        cards=selected,
        concept_map=concept_map,
        total_pages=total_pages,
    )
    original_coverage = compute_coverage_data(
        cards=original_cards,
        concept_map=concept_map,
        total_pages=total_pages,
    )
    selected_avg = round(
        sum(float(card.get("quality_score") or 0.0) for card in selected) / max(len(selected), 1),
        1,
    )
    original_avg = round(
        sum(float(_annotate_card_quality(card, high_priority_ids=high_priority_ids).get("quality_score") or 0.0) for card in original_cards)
        / max(len(original_cards), 1),
        1,
    )
    return selected, {
        "selected_avg_quality": selected_avg,
        "original_avg_quality": original_avg,
        "quality_delta": round(selected_avg - original_avg, 1),
        "page_coverage_delta": int(selected_coverage.get("covered_page_count", 0)) - int(original_coverage.get("covered_page_count", 0)),
        "concept_coverage_delta": int(selected_coverage.get("explicit_concept_count", 0)) - int(original_coverage.get("explicit_concept_count", 0)),
        "relation_coverage_delta": int(selected_coverage.get("explicit_relation_count", 0)) - int(original_coverage.get("explicit_relation_count", 0)),
    }


def _rebuild_seen_keys(cards: List[Dict[str, Any]]) -> set[str]:
    return {key for key in (get_card_key(card) for card in cards) if key}


def collect_card_fronts(cards: List[Dict[str, Any]]) -> List[str]:
    fronts: List[str] = []
    for card in cards:
        key = get_card_key(card)
        if key:
            fronts.append(key[:120])
    return fronts


def yield_new_cards(
    *,
    new_cards: Iterable[Dict[str, Any]],
    all_cards: List[Dict[str, Any]],
    seen_keys: set,
    message: str,
    event_factory: Callable[..., Any],
) -> Generator[Any, None, int]:
    added_count = 0
    for card in new_cards:
        key = get_card_key(card)
        if key and key not in seen_keys:
            seen_keys.add(key)
            all_cards.append(card)
            added_count += 1
            yield event_factory("card", message, {"card": card})
    return added_count


def run_generation_loop(
    *,
    context: GenerationLoopContext,
    state: GenerationLoopState,
    config: GenerationLoopConfig,
    event_factory: Callable[..., Any],
    should_stop: Callable[[Optional[Callable[[], bool]]], bool],
) -> Generator[Any, None, None]:
    targeted_retry_budget = 1
    batch_index = 0

    while len(state.all_cards) < config.total_cards_cap:
        batch_index += 1
        remaining = config.total_cards_cap - len(state.all_cards)
        limit = min(config.actual_batch_size, remaining)

        yield event_factory("status", f"Generating batch {batch_index} (limit={limit})...")

        if should_stop(config.stop_check):
            yield event_factory("warning", "Generation stopped by user.")
            return

        try:
            current_examples = context.examples if len(state.all_cards) == 0 else ""
            recent_keys = []
            for card in state.all_cards[-config.recent_card_window:]:
                key = get_card_key(card)
                if key:
                    recent_keys.append(key[:120])
            coverage_data = compute_coverage_data(
                cards=state.all_cards,
                concept_map=context.concept_map,
                total_pages=len(state.pages),
            )
            covered_slides = coverage_data.get("covered_pages", [])

            # NOTE(Pacing): Calculate real-time feedback using PacingState.
            pacing_hint = PacingState(
                current_cards=len(state.all_cards),
                covered_slides=covered_slides,
                total_pages=len(state.pages),
                focus_prompt=config.focus_prompt or "",
                target_density=config.effective_target,
            ).hint

            out = context.ai.generate_more_cards(
                limit=limit,
                examples=current_examples,
                avoid_fronts=recent_keys,
                covered_slides=covered_slides,
                pacing_hint=pacing_hint,
                all_card_fronts=collect_card_fronts(state.all_cards)[-200:],
                coverage_gap_text=build_generation_gap_text(coverage_data),
            )
            for w in context.ai.drain_warnings():
                yield event_factory("warning", w)
            new_cards = out.get("cards", [])
            model_done = bool(out.get("done", False))
            parse_error = str(out.get("parse_error") or "").strip()
            if parse_error:
                yield event_factory(
                    "warning",
                    f"Generation response could not be fully parsed; treating batch as exhausted. {parse_error}",
                )

            added_count = yield from yield_new_cards(
                new_cards=new_cards,
                all_cards=state.all_cards,
                seen_keys=state.seen_keys,
                message="New card",
                event_factory=event_factory,
            )

            updated_coverage = compute_coverage_data(
                cards=state.all_cards,
                concept_map=context.concept_map,
                total_pages=len(state.pages),
            )
            yield event_factory("progress_update", "", {"current": len(state.all_cards)})
            yield event_factory(
                "info",
                (
                    f"Batch {batch_index} summary: +{added_count} cards, "
                    f"{updated_coverage.get('page_coverage_pct', 0)}% pages, "
                    f"{updated_coverage.get('explicit_concept_coverage_pct', 0)}% explicit concepts."
                ),
                {
                    "batch": batch_index,
                    "added": added_count,
                    "model_done": model_done,
                    "coverage_data": updated_coverage,
                },
            )

            if model_done and _coverage_is_sufficient(updated_coverage):
                yield event_factory(
                    "info",
                    f"Model marked generation complete after batch {batch_index}; coverage threshold satisfied.",
                    {
                        "batch": batch_index,
                        "coverage_data": updated_coverage,
                    },
                )
                break

            if added_count == 0:
                if new_cards:
                    yield event_factory(
                        "warning",
                        "Batch returned cards, but all were duplicates.",
                    )
                has_coverage_gaps = bool(
                    coverage_data.get("missing_high_priority")
                    or coverage_data.get("uncovered_concepts")
                    or coverage_data.get("uncovered_pages")
                )
                if has_coverage_gaps and targeted_retry_budget > 0:
                    targeted_retry_budget -= 1
                    yield event_factory(
                        "warning",
                        "Retrying generation with an explicit coverage-gap prompt before stopping.",
                    )
                    continue
                break

            # Checkpoint was here, now handled by HistoryManager/DatabaseManager in service layer on completion or sync.
            pass
        except Exception as e:
            user_msg, _ = capture_exception(e, "Generation loop")
            yield event_factory("error", f"Generation error: {user_msg}")
            break


def run_reflection_loop(
    *,
    context: GenerationLoopContext,
    state: GenerationLoopState,
    config: ReflectionLoopConfig,
    event_factory: Callable[..., Any],
    should_stop: Callable[[Optional[Callable[[], bool]]], bool],
) -> Generator[Any, None, None]:
    # NOTE(Reflection): Allow exceeding the initial cap by configured multiplier to accommodate refinement.
    reflection_hard_cap = (
        int(config.total_cards_cap * config.hard_cap_multiplier)
        + config.hard_cap_padding
    )

    for round_idx in range(config.rounds):
        remaining = max(0, reflection_hard_cap - len(state.all_cards))
        if remaining == 0:
            yield event_factory("info", "Reflection cap reached (120% of target).")
            break

        yield event_factory("status", f"Reflection Round {round_idx + 1}/{config.rounds}")

        if should_stop(config.stop_check):
            yield event_factory("warning", "Reflection stopped by user.")
            return

        try:
            # Review the whole deck within the reflection cap so the model can rebalance coverage globally.
            batch_size = min(len(state.all_cards), remaining)
            if batch_size == 0:
                break

            cards_to_refine = state.all_cards[:batch_size]
            coverage_data = compute_coverage_data(
                cards=state.all_cards,
                concept_map=context.concept_map,
                total_pages=len(state.pages),
            )
            import json
            cards_to_refine_json = json.dumps(cards_to_refine, ensure_ascii=False)

            out = context.ai.reflect(
                limit=batch_size,
                all_card_fronts=collect_card_fronts(state.all_cards)[-200:],
                cards_to_refine_json=cards_to_refine_json,
                coverage_gaps=build_reflection_gap_text(coverage_data),
            )
            for w in context.ai.drain_warnings():
                yield event_factory("warning", w)
            reflected_cards = out.get("cards", [])
            parse_error = str(out.get("parse_error") or "").strip()
            if parse_error:
                yield event_factory(
                    "warning",
                    f"Reflection response could not be fully parsed; keeping strongest available cards. {parse_error}",
                )
            selected_cards, selection_summary = _select_best_reflection_cards(
                original_cards=cards_to_refine,
                reflected_cards=reflected_cards,
                limit=batch_size,
                concept_map=context.concept_map,
                total_pages=len(state.pages),
            )
            original_keys = [get_card_key(card) for card in cards_to_refine]
            selected_keys = [get_card_key(card) for card in selected_cards]
            did_change = selected_keys != original_keys or any(
                dict(selected) != dict(original)
                for selected, original in zip(selected_cards, cards_to_refine)
            )

            state.all_cards = selected_cards + state.all_cards[batch_size:]
            state.seen_keys = _rebuild_seen_keys(state.all_cards)

            if did_change:
                for card in selected_cards:
                    yield event_factory("card", "Refined card", {"card": card})

            updated_coverage = compute_coverage_data(
                cards=state.all_cards,
                concept_map=context.concept_map,
                total_pages=len(state.pages),
            )
            # Signal frontend to replace the whole deck
            yield event_factory(
                "cards_replaced",
                "Applied reflection batch",
                {
                    "cards": state.all_cards,
                    "coverage_data": updated_coverage,
                    "reflection": out.get("reflection", ""),
                    "selection_summary": selection_summary,
                },
            )
            yield event_factory(
                "info",
                (
                    f"Reflection round {round_idx + 1} summary: "
                    f"quality {selection_summary.get('original_avg_quality', 0)} -> "
                    f"{selection_summary.get('selected_avg_quality', 0)}, "
                    f"explicit concepts delta {selection_summary.get('concept_coverage_delta', 0)}."
                ),
                {
                    "round": round_idx + 1,
                    "coverage_data": updated_coverage,
                    "selection_summary": selection_summary,
                },
            )

            yield event_factory("progress_update", "", {"current": round_idx + 1})

            should_break = (
                len(state.all_cards) >= reflection_hard_cap
                or not did_change
                or bool(out.get("done", False))
            )
            if should_break:
                break
        except Exception as e:
            user_msg, _ = capture_exception(e, "Reflection loop")
            yield event_factory("warning", f"Reflection error: {user_msg}")

    yield event_factory("progress_update", "", {"current": config.rounds})
