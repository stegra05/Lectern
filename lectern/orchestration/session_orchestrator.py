"""Session Orchestrator - owns the generation loop and all state mutations.

The SessionOrchestrator is the SINGLE SOURCE OF TRUTH for session state.
It calls the AI client, mutates its own state, and yields immutable DomainEvent objects.

Key principle: The orchestrator OWNS the loop. It does not receive state to mutate - it IS the state.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, AsyncGenerator, List, Optional

from lectern.ai_pacing import PacingState
from lectern.coverage import (
    build_generation_gap_text,
    build_reflection_gap_text,
    compute_coverage_data,
)
from lectern.events.domain import (
    CardGeneratedEvent,
    CardsReplacedEvent,
    CoverageThresholdMetEvent,
    CoverageUpdatedEvent,
    DomainEvent,
    ErrorOccurredEvent,
    GenerationBatchCompletedEvent,
    GenerationBatchStartedEvent,
    GenerationStoppedEvent,
    ProgressUpdatedEvent,
    ReflectionRoundCompletedEvent,
    ReflectionRoundStartedEvent,
    ReflectionStoppedEvent,
    WarningEmittedEvent,
)
from lectern.generation_loop import (
    _coverage_is_sufficient,
    _rebuild_seen_keys,
    _select_best_reflection_cards,
    collect_card_fronts,
    get_card_key,
)
from lectern.utils.error_handling import capture_exception


@dataclass
class SessionState:
    """Internal state for a generation session."""

    all_cards: list[dict] = field(default_factory=list)
    seen_keys: set[str] = field(default_factory=set)
    batch_index: int = 0
    reflection_round: int = 0
    last_coverage_data: Optional[dict] = None

    # Context fields populated by service layer
    pages: list[dict] = field(default_factory=list)
    concept_map: dict = field(default_factory=dict)
    examples: str = ""


@dataclass
class GenerationConfig:
    """Configuration for the generation phase."""

    total_cards_cap: int
    actual_batch_size: int
    focus_prompt: Optional[str]
    effective_target: float
    stop_check: Optional[Callable[[], bool]]
    recent_card_window: int = 100
    examples: str = ""


@dataclass
class ReflectionConfig:
    """Configuration for the reflection phase."""

    total_cards_cap: int
    rounds: int
    stop_check: Optional[Callable[[], bool]]
    recent_card_window: int = 100
    hard_cap_multiplier: float = 1.2
    hard_cap_padding: int = 5


class SessionOrchestrator:
    """
    Owns the generation loop and all state mutations.

    This is the SINGLE SOURCE OF TRUTH for session state.
    The orchestrator calls the AI client, mutates its own state,
    and yields domain events.

    Key responsibilities:
    - Own the while loop (not passed in)
    - Call AI client directly
    - Mutate own state
    - Inject UUIDs on cards before yielding
    - Yield immutable DomainEvent objects
    """

    def __init__(self):
        """
        Initialize orchestrator.
        Context (pages, concept_map) is populated via orchestrator.state
        by the service layer before running loops.
        """
        self.state = SessionState()
        self.stop_requested = False

    # --- State Queries ---

    @property
    def card_count(self) -> int:
        return len(self.state.all_cards)

    def should_stop(self, stop_check: Optional[Callable[[], bool]]) -> bool:
        return bool(stop_check and stop_check())

    # --- State Mutations (internal) ---

    def _add_card(self, card: Dict[str, Any], key: str) -> bool:
        """Add a card if not duplicate. Returns True if added."""
        if key and key not in self.state.seen_keys:
            self.state.seen_keys.add(key)
            self.state.all_cards.append(card)
            return True
        return False

    def _inject_uuid(self, card: Dict[str, Any]) -> Dict[str, Any]:
        """Inject a backend-assigned uid into the card for React key stability."""
        if not card.get("uid"):
            card["uid"] = str(uuid.uuid4())
        return card

    def _compute_coverage(self) -> Dict[str, Any]:
        """Calculates content coverage statistics based on current cards."""
        total_pages = len(self.state.pages)
        coverage = compute_coverage_data(
            cards=self.state.all_cards,
            concept_map=self.state.concept_map,
            total_pages=total_pages,
        )
        self.state.last_coverage_data = coverage
        return coverage

    def _compute_pacing_hint(self, target_density: float, focus_prompt: str) -> str:
        """Compute pacing hint for AI context."""
        coverage = self.state.last_coverage_data
        covered_slides = coverage.get("covered_pages", [])

        pacing = PacingState(
            current_cards=len(self.state.all_cards),
            covered_slides=covered_slides,
            total_pages=len(self.state.pages),
            focus_prompt=focus_prompt,
            target_density=target_density,
        )
        return pacing.hint

    def _is_coverage_sufficient(self) -> bool:
        """Check if current coverage meets thresholds."""
        if not self.state.last_coverage_data:
            return False
        return _coverage_is_sufficient(self.state.last_coverage_data)

    # --- Event Factories ---

    def _emit_coverage_event(self) -> CoverageUpdatedEvent:
        return CoverageUpdatedEvent(
            batch_index=self.state.batch_index,
            coverage_data=self.state.last_coverage_data,
            cards_count=len(self.state.all_cards),
        )

    # --- Main Loop: Generation ---

    async def run_generation(
        self,
        ai_client: Any,  # LecternAIClient
        config: GenerationConfig,
    ) -> AsyncGenerator[DomainEvent, None]:
        """
        Run the generation loop. The orchestrator OWNS this loop.

        Yields immutable DomainEvent objects. All state mutations
        happen internally.
        """
        targeted_retry_budget = 1

        while len(self.state.all_cards) < config.total_cards_cap:
            self.state.batch_index += 1
            batch_index = self.state.batch_index

            remaining = config.total_cards_cap - len(self.state.all_cards)
            limit = min(config.actual_batch_size, remaining)

            # Emit batch started
            yield GenerationBatchStartedEvent(
                batch_index=batch_index,
                limit=limit,
            )

            # Check for user cancel
            if self.should_stop(config.stop_check):
                yield GenerationStoppedEvent(
                    batch_index=batch_index,
                    reason="user_cancel",
                )
                return

            try:
                # Compute initial coverage for this batch
                self._compute_coverage()

                # Build recent keys for dedup
                recent_keys = [
                    get_card_key(card)[:120]
                    for card in self.state.all_cards[-config.recent_card_window :]
                    if get_card_key(card)
                ]

                covered_slides = self.state.last_coverage_data.get("covered_pages", [])

                # Compute pacing hint
                pacing_hint = self._compute_pacing_hint(
                    target_density=config.effective_target,
                    focus_prompt=config.focus_prompt or "",
                )

                # Pure AI call (no side effects)
                out = await ai_client.generate_more_cards(
                    limit=limit,
                    examples=config.examples if len(self.state.all_cards) == 0 else "",
                    avoid_fronts=recent_keys,
                    covered_slides=covered_slides,
                    pacing_hint=pacing_hint,
                    all_card_fronts=collect_card_fronts(self.state.all_cards)[-200:],
                    coverage_gap_text=build_generation_gap_text(
                        self.state.last_coverage_data
                    ),
                )

                # Drain warnings from AI
                for w in ai_client.drain_warnings():
                    yield WarningEmittedEvent(
                        batch_index=batch_index,
                        message=w,
                    )

                new_cards = out.get("cards", [])
                model_done = bool(out.get("done", False))
                parse_error = str(out.get("parse_error") or "").strip()

                if parse_error:
                    yield WarningEmittedEvent(
                        batch_index=batch_index,
                        message=f"Generation response could not be fully parsed; treating batch as exhausted. {parse_error}",
                    )

                # State Mutation: Add cards with UUID injection
                added_count = 0
                for card in new_cards:
                    key = get_card_key(card)
                    if self._add_card(card, key):
                        # INJECT UUID before yielding (for React key stability)
                        self._inject_uuid(card)
                        added_count += 1
                        yield CardGeneratedEvent(
                            batch_index=batch_index,
                            card=card,
                            is_refined=False,
                        )

                # Update coverage after adding cards
                self._compute_coverage()
                yield self._emit_coverage_event()

                # Progress update
                yield ProgressUpdatedEvent(
                    batch_index=batch_index,
                    current=len(self.state.all_cards),
                )

                # Batch summary
                coverage = self.state.last_coverage_data
                yield GenerationBatchCompletedEvent(
                    batch_index=batch_index,
                    cards_added=added_count,
                    model_done=model_done,
                )

                # Check if done
                if model_done and self._is_coverage_sufficient():
                    yield CoverageThresholdMetEvent(
                        batch_index=batch_index,
                        coverage_data=coverage,
                        reason=f"Model marked generation complete after batch {batch_index}; coverage threshold satisfied.",
                    )
                    break

                # Handle no new cards
                if added_count == 0:
                    if new_cards:
                        yield WarningEmittedEvent(
                            batch_index=batch_index,
                            message="Batch returned cards, but all were duplicates.",
                        )

                    has_coverage_gaps = bool(
                        self.state.last_coverage_data.get("missing_high_priority")
                        or self.state.last_coverage_data.get("uncovered_concepts")
                        or self.state.last_coverage_data.get("uncovered_pages")
                    )

                    if has_coverage_gaps and targeted_retry_budget > 0:
                        targeted_retry_budget -= 1
                        yield WarningEmittedEvent(
                            batch_index=batch_index,
                            message="Retrying generation with an explicit coverage-gap prompt before stopping.",
                        )
                        continue

                    yield GenerationStoppedEvent(
                        batch_index=batch_index,
                        reason="no_new_cards",
                    )
                    break

            except Exception as e:
                user_msg, _ = capture_exception(e, "Generation loop")
                yield ErrorOccurredEvent(
                    batch_index=batch_index,
                    message=f"Generation error: {user_msg}",
                    recoverable=False,
                    stage="generation",
                )
                break

    # --- Main Loop: Reflection ---

    async def run_reflection(
        self,
        ai_client: Any,
        config: ReflectionConfig,
    ) -> AsyncGenerator[DomainEvent, None]:
        """
        Run the reflection loop. The orchestrator OWNS this loop.
        """
        reflection_hard_cap = (
            int(config.total_cards_cap * config.hard_cap_multiplier)
            + config.hard_cap_padding
        )

        for round_idx in range(config.rounds):
            self.state.reflection_round = round_idx + 1
            remaining = max(0, reflection_hard_cap - len(self.state.all_cards))

            if remaining == 0:
                yield ReflectionStoppedEvent(reason="cap_reached")
                break

            yield ReflectionRoundStartedEvent(
                round_number=round_idx + 1,
                total_rounds=config.rounds,
            )

            if self.should_stop(config.stop_check):
                yield ReflectionStoppedEvent(reason="user_cancel")
                return

            try:
                batch_size = min(len(self.state.all_cards), remaining)
                if batch_size == 0:
                    break

                cards_to_refine = self.state.all_cards[:batch_size]
                self._compute_coverage()

                cards_to_refine_json = json.dumps(cards_to_refine, ensure_ascii=False)

                out = await ai_client.reflect(
                    limit=batch_size,
                    all_card_fronts=collect_card_fronts(self.state.all_cards)[-200:],
                    cards_to_refine_json=cards_to_refine_json,
                    coverage_gaps=build_reflection_gap_text(
                        self.state.last_coverage_data
                    ),
                )

                for w in ai_client.drain_warnings():
                    yield WarningEmittedEvent(
                        batch_index=self.state.reflection_round,
                        message=w,
                    )

                reflected_cards = out.get("cards", [])
                parse_error = str(out.get("parse_error") or "").strip()

                if parse_error:
                    yield WarningEmittedEvent(
                        batch_index=self.state.reflection_round,
                        message=f"Reflection response could not be fully parsed; keeping strongest available cards. {parse_error}",
                    )

                selected_cards, selection_summary = _select_best_reflection_cards(
                    original_cards=cards_to_refine,
                    reflected_cards=reflected_cards,
                    limit=batch_size,
                    concept_map=self.state.concept_map,
                    total_pages=len(self.state.pages),
                )

                original_keys = [get_card_key(card) for card in cards_to_refine]
                selected_keys = [get_card_key(card) for card in selected_cards]
                did_change = selected_keys != original_keys or any(
                    dict(selected) != dict(original)
                    for selected, original in zip(selected_cards, cards_to_refine)
                )

                # State Mutation: Replace cards
                self.state.all_cards = (
                    selected_cards + self.state.all_cards[batch_size:]
                )
                self.state.seen_keys = _rebuild_seen_keys(self.state.all_cards)

                # Inject UUIDs and emit
                if did_change:
                    for card in selected_cards:
                        self._inject_uuid(card)
                        yield CardGeneratedEvent(
                            batch_index=self.state.reflection_round,
                            card=card,
                            is_refined=True,
                        )

                self._compute_coverage()

                yield CardsReplacedEvent(
                    cards=self.state.all_cards,
                    coverage_data=self.state.last_coverage_data,
                    reflection_text=out.get("reflection", ""),
                    selection_summary=selection_summary,
                )

                yield ReflectionRoundCompletedEvent(
                    round_number=round_idx + 1,
                    quality_delta=selection_summary.get("quality_delta", 0.0),
                    cards_changed=did_change,
                    selection_summary=selection_summary,
                )

                yield ProgressUpdatedEvent(current=round_idx + 1)

                should_break = (
                    len(self.state.all_cards) >= reflection_hard_cap
                    or not did_change
                    or bool(out.get("done", False))
                )
                if should_break:
                    yield ReflectionStoppedEvent(
                        reason=(
                            "cap_reached"
                            if len(self.state.all_cards) >= reflection_hard_cap
                            else "no_changes" if not did_change else "model_done"
                        )
                    )
                    break

            except Exception as e:
                user_msg, _ = capture_exception(e, "Reflection loop")
                yield WarningEmittedEvent(
                    message=f"Reflection error: {user_msg}",
                )

        yield ProgressUpdatedEvent(current=config.rounds)
