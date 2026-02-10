from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Generator, Iterable, List, Optional

from lectern.ai_pacing import PacingState

_RECENT_CARD_WINDOW = 30
_REFLECTION_HARD_CAP_MULTIPLIER = 1.2
_REFLECTION_HARD_CAP_PADDING = 5


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


@dataclass(frozen=True)
class ReflectionLoopConfig:
    total_cards_cap: int
    actual_batch_size: int
    rounds: int
    stop_check: Optional[Callable[[], bool]]


def get_card_key(card: Dict[str, Any]) -> str:
    fields = card.get("fields") or {}
    val = str(fields.get("Text") or fields.get("Front") or "")
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
    checkpoint_fn: Callable[..., None],
) -> Generator[Any, None, None]:
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
            for card in state.all_cards[-_RECENT_CARD_WINDOW:]:
                key = get_card_key(card)
                if key:
                    recent_keys.append(key[:120])
            covered_slides = sorted(
                {
                    int(card.get("slide_number"))
                    for card in state.all_cards
                    if isinstance(card, dict) and str(card.get("slide_number", "")).isdigit()
                }
            )

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
                all_card_fronts=collect_card_fronts(state.all_cards),
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
                break

            checkpoint_fn(
                pdf_path=context.pdf_path,
                deck_name=context.deck_name,
                cards=state.all_cards,
                concept_map=context.concept_map,
                ai=context.ai,
                session_id=context.session_id,
                slide_set_name=context.slide_set_name,
                model_name=context.model_name,
                tags=context.tags,
                history_id=context.history_id,
            )
        except Exception as e:
            yield event_factory("error", f"Generation error: {e}")
            break


def run_reflection_loop(
    *,
    context: GenerationLoopContext,
    state: GenerationLoopState,
    config: ReflectionLoopConfig,
    event_factory: Callable[..., Any],
    should_stop: Callable[[Optional[Callable[[], bool]]], bool],
    checkpoint_fn: Callable[..., None],
) -> Generator[Any, None, None]:
    # NOTE(Reflection): Allow exceeding the initial cap by 20% to accommodate refinement.
    reflection_hard_cap = (
        int(config.total_cards_cap * _REFLECTION_HARD_CAP_MULTIPLIER)
        + _REFLECTION_HARD_CAP_PADDING
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
            # Limit reflection batch to avoid overwhelming, but at least do 5 if space allows.
            batch_limit = min(config.actual_batch_size, remaining)
            out = context.ai.reflect(
                limit=batch_limit,
                all_card_fronts=collect_card_fronts(state.all_cards),
            )
            for w in context.ai.drain_warnings():
                yield event_factory("warning", w)
            new_cards = out.get("cards", [])

            added_count = yield from yield_new_cards(
                new_cards=new_cards,
                all_cards=state.all_cards,
                seen_keys=state.seen_keys,
                message="Refined card",
                event_factory=event_factory,
            )

            yield event_factory("progress_update", "", {"current": round_idx + 1})

            if added_count > 0:
                checkpoint_fn(
                    pdf_path=context.pdf_path,
                    deck_name=context.deck_name,
                    cards=state.all_cards,
                    concept_map=context.concept_map,
                    ai=context.ai,
                    session_id=context.session_id,
                    slide_set_name=context.slide_set_name,
                    model_name=context.model_name,
                    tags=context.tags,
                    history_id=context.history_id,
                )

            should_break = len(state.all_cards) >= reflection_hard_cap or added_count == 0
            if should_break:
                break
        except Exception as e:
            yield event_factory("warning", f"Reflection error: {e}")

    yield event_factory("progress_update", "", {"current": config.rounds})
