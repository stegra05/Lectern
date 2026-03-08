from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generator, Iterable, List, Optional

from lectern.ai_pacing import PacingState
from lectern.coverage import (
    build_generation_gap_text,
    build_reflection_gap_text,
    compute_coverage_data,
)
from lectern.utils.error_handling import capture_exception

logger = logging.getLogger(__name__)

# Default values for reflection configuration
DEFAULT_RECENT_CARD_WINDOW = 100
DEFAULT_REFLECTION_HARD_CAP_MULTIPLIER = 1.2
DEFAULT_REFLECTION_HARD_CAP_PADDING = 5


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
    return " ".join(val.lower().split())


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

    while len(state.all_cards) < config.total_cards_cap:
        remaining = config.total_cards_cap - len(state.all_cards)
        limit = min(config.actual_batch_size, remaining)

        yield event_factory("status", f"Generating batch (limit={limit})...")

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

            added_count = yield from yield_new_cards(
                new_cards=new_cards,
                all_cards=state.all_cards,
                seen_keys=state.seen_keys,
                message="New card",
                event_factory=event_factory,
            )

            yield event_factory("progress_update", "", {"current": len(state.all_cards)})

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
            new_cards = out.get("cards", [])

            # We are replacing the batch we sent in.
            # Pop old ones from state to prevent duplicates in seen_keys, though seen_keys won't perfectly forget unless we manually remove them.
            # To be clean, just pop them from all_cards.
            state.all_cards = state.all_cards[batch_size:]
            
            # Note: seen_keys still contains the old keys, which might prevent slightly-modified duplicates. 
            # This is acceptable to prevent global duplicates, but to allow refining the exact SAME text (e.g. if LLM returns the card unmodified), 
            # we should ignore seen_keys for this replacement step or remove the old keys.
            for c in cards_to_refine:
                k = get_card_key(c)
                if k in state.seen_keys:
                    state.seen_keys.remove(k)

            added_count = yield from yield_new_cards(
                new_cards=new_cards,
                all_cards=state.all_cards,
                seen_keys=state.seen_keys,
                message="Refined card",
                event_factory=event_factory,
            )

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
                },
            )

            yield event_factory("progress_update", "", {"current": round_idx + 1})

            if added_count > 0:
                # Checkpoint was here, now handled by HistoryManager/DatabaseManager in service layer on completion or sync.
                pass

            should_break = len(state.all_cards) >= reflection_hard_cap or added_count == 0
            if should_break:
                break
        except Exception as e:
            user_msg, _ = capture_exception(e, "Reflection loop")
            yield event_factory("warning", f"Reflection error: {user_msg}")

    yield event_factory("progress_update", "", {"current": config.rounds})
