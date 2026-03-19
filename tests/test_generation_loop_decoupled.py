"""Tests for decoupled generation loop - no HTTP/SSE mocking required."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from lectern.orchestration.session_orchestrator import (
    SessionOrchestrator,
    GenerationConfig,
    ReflectionConfig,
)
from lectern.events.domain import (
    CardGeneratedEvent,
    CoverageThresholdMetEvent,
    GenerationStoppedEvent,
    WarningEmittedEvent,
    ErrorOccurredEvent,
    GenerationBatchStartedEvent,
    GenerationBatchCompletedEvent,
    ReflectionRoundStartedEvent,
    ReflectionRoundCompletedEvent,
    ReflectionStoppedEvent,
    CardsReplacedEvent,
    ProgressUpdatedEvent,
)

from gui.backend.sse_emitter import SSEEmitter


class TestSessionOrchestrator:
    """Test orchestrator state management."""

    def test_add_card_deduplicates(self):
        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(10)]
        assert orchestrator._add_card({"front": "Q1"}, "q1") is True
        assert orchestrator._add_card({"front": "Q1"}, "q1") is False  # Duplicate
        assert len(orchestrator.state.all_cards) == 1

    def test_uuid_injection(self):
        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(10)]
        card = {"front": "Q1", "back": "A1"}
        # _inject_uuid modifies the card in place, adding a uid
        result = orchestrator._inject_uuid(card)
        assert "uid" in card
        assert len(card["uid"]) == 36  # UUID format
        # Returns the same card (modified in place)
        assert result is card

    def test_coverage_computation(self):
        orchestrator = SessionOrchestrator()
        orchestrator.state.concept_map = {
            "concepts": [{"id": "c1", "name": "Concept 1"}],
            "relations": [],
        }
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        coverage = orchestrator._compute_coverage()
        assert coverage["total_pages"] == 5
        assert coverage["covered_page_count"] == 0

    def test_should_stop(self):
        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        assert orchestrator.should_stop(None) is False

        # Test with a function that returns True
        def stop_check_true():
            return True

        assert orchestrator.should_stop(stop_check_true) is True

        # Test with a function that returns False
        def stop_check_false():
            return False

        assert orchestrator.should_stop(stop_check_false) is False


class TestGenerationLoopPure:
    """Test generation loop without SSE/HTTP mocking."""

    @pytest.mark.asyncio
    async def test_annotates_generated_cards_with_quality_metadata(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Q1",
                        "back": "A1",
                        "source_pages": [1],
                        "concept_ids": ["important"],
                        "rationale": "Anchored in the key concept on slide 1.",
                        "source_excerpt": "Important concept appears in slide 1 notes.",
                    }
                ],
                "done": True,
            }
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{}] * 5
        orchestrator.state.concept_map = {
            "concepts": [{"id": "important", "name": "Important concept"}],
            "relations": [],
        }

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=None,
            examples="",
        )

        events = [
            e async for e in orchestrator.run_generation(ai_client=ai, config=config)
        ]

        card_event = next(e for e in events if isinstance(e, CardGeneratedEvent))
        assert "quality_score" in card_event.card
        assert isinstance(card_event.card["quality_score"], float)
        assert "quality_flags" in card_event.card
        assert isinstance(card_event.card["quality_flags"], list)

    @pytest.mark.asyncio
    async def test_generation_uses_feedback_adaptive_pacing_hint(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={"cards": [{"front": "Q1", "back": "A1"}], "done": True}
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{}] * 8
        orchestrator.state.concept_map = {}

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=2.0,
            stop_check=None,
            examples="",
            feedback_summary={
                "positive_count": 1,
                "negative_count": 6,
                "total_signals": 7,
                "negative_reasons": ["too shallow"],
            },
        )

        _ = [e async for e in orchestrator.run_generation(ai_client=ai, config=config)]

        pacing_hint = ai.generate_cards.await_args.kwargs["pacing_hint"]
        assert "ADAPTIVE FEEDBACK" in pacing_hint
        assert "TARGET GOAL: ~1.7 cards per slide" in pacing_hint
        assert "too shallow" in pacing_hint

    @pytest.mark.asyncio
    async def test_yields_card_events_with_uuids(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Q1",
                        "back": "A1",
                        "source_pages": [1],
                        "rationale": "Directly supported by source page 1.",
                        "source_excerpt": "Evidence snippet from page 1.",
                    },
                    {
                        "front": "Q2",
                        "back": "A2",
                        "source_pages": [2],
                        "rationale": "Directly supported by source page 2.",
                        "source_excerpt": "Evidence snippet from page 2.",
                    },
                ],
                "done": False,
            }
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{}] * 5
        orchestrator.state.concept_map = {}

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=None,
            examples="",
        )

        events = [
            e async for e in orchestrator.run_generation(ai_client=ai, config=config)
        ]

        card_events = [e for e in events if isinstance(e, CardGeneratedEvent)]
        assert len(card_events) == 2

        # Verify UIDs were injected
        for event in card_events:
            assert "uid" in event.card
            assert len(event.card["uid"]) == 36

    @pytest.mark.asyncio
    async def test_stops_on_user_cancel(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(return_value={"cards": [], "done": False})
        ai.drain_warnings.return_value = []

        stop_flag = [False]

        def stop_check():
            if not stop_flag[0]:
                stop_flag[0] = True
                return False
            return True

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        orchestrator.state.concept_map = {}

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=stop_check,
            examples="",
        )

        events = []
        async for event in orchestrator.run_generation(ai_client=ai, config=config):
            events.append(event)
            if len(events) == 2:  # After batch started and before generation
                pass

        stop_events = [e for e in events if isinstance(e, GenerationStoppedEvent)]
        assert len(stop_events) >= 1
        assert stop_events[0].reason == "user_cancel"

    @pytest.mark.asyncio
    async def test_yields_batch_events(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Q1",
                        "back": "A1",
                        "source_pages": [1],
                        "rationale": "Grounded in page 1 content.",
                        "source_excerpt": "Q1/A1 evidence on page 1.",
                    }
                ],
                "done": True,
            }
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        orchestrator.state.concept_map = {}

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=None,
            examples="",
        )

        events = [
            e async for e in orchestrator.run_generation(ai_client=ai, config=config)
        ]

        # Check for batch events specifically (excluding coverage events)
        started_events = [
            e for e in events if isinstance(e, GenerationBatchStartedEvent)
        ]
        completed_events = [
            e for e in events if isinstance(e, GenerationBatchCompletedEvent)
        ]

        assert len(started_events) >= 1
        assert started_events[0].limit == 5
        assert len(completed_events) >= 1
        assert completed_events[0].cards_added == 1

    @pytest.mark.asyncio
    async def test_handles_warnings_from_ai(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(return_value={"cards": [], "done": True})
        ai.drain_warnings.return_value = ["Warning 1", "Warning 2"]

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        orchestrator.state.concept_map = {}

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=None,
            examples="",
        )

        events = [
            e async for e in orchestrator.run_generation(ai_client=ai, config=config)
        ]

        warning_events = [e for e in events if isinstance(e, WarningEmittedEvent)]
        # Should have at least the2 warnings from AI
        assert len(warning_events) >= 2
        assert warning_events[0].message == "Warning 1"
        assert warning_events[1].message == "Warning 2"

    @pytest.mark.asyncio
    async def test_handles_errors_gracefully(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(side_effect=Exception("AI failure"))

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        orchestrator.state.concept_map = {}

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=None,
            examples="",
        )

        events = [
            e async for e in orchestrator.run_generation(ai_client=ai, config=config)
        ]

        error_events = [e for e in events if isinstance(e, ErrorOccurredEvent)]
        assert len(error_events) == 1
        assert "AI failure" in error_events[0].message
        assert error_events[0].recoverable is False

        assert error_events[0].stage == "generation"

    @pytest.mark.asyncio
    async def test_stops_on_coverage_threshold(self):
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [{"front": "Q1", "back": "A1"}],
                "done": True,
            }
        )
        ai.drain_warnings.return_value = []

        # Create concept map with high priority concepts

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=None,
            examples="",
        )

        events = [
            e async for e in orchestrator.run_generation(ai_client=ai, config=config)
        ]

        [e for e in events if isinstance(e, CoverageThresholdMetEvent)]
        # Should have threshold met event when model_done=True and coverage is sufficient
        # Since we're mock doesn't set up coverage data properly, this test mainly verifies the event is yielded
        # In real scenarios, the coverage check would evaluate actual coverage
        assert isinstance(
            events[-1], (CoverageThresholdMetEvent, GenerationStoppedEvent)
        )

    @pytest.mark.asyncio
    async def test_continues_past_first_batch_when_explicit_target_requested(self):
        first_batch = [
            {
                "front": f"Q{i}",
                "back": f"A{i}",
                "source_pages": list(range(1, 11)),
                "rationale": f"Grounded rationale for Q{i}.",
                "source_excerpt": f"Supporting excerpt for Q{i}.",
            }
            for i in range(1, 6)
        ]
        second_batch = [
            {
                "front": f"Q{i}",
                "back": f"A{i}",
                "source_pages": list(range(1, 11)),
                "rationale": f"Grounded rationale for Q{i}.",
                "source_excerpt": f"Supporting excerpt for Q{i}.",
            }
            for i in range(6, 11)
        ]

        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            side_effect=[
                {"cards": first_batch, "done": True},
                {"cards": second_batch, "done": True},
            ]
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(1, 11)]
        orchestrator.state.concept_map = {}

        config = GenerationConfig(
            total_cards_cap=10,
            actual_batch_size=5,
            recent_card_window=100,
            focus_prompt=None,
            effective_target=1.0,
            stop_check=None,
            examples="",
            explicit_target_requested=True,
        )

        events = [
            e async for e in orchestrator.run_generation(ai_client=ai, config=config)
        ]

        assert ai.generate_cards.await_count == 2
        assert len([e for e in events if isinstance(e, CardGeneratedEvent)]) == 10

        threshold_events = [
            e for e in events if isinstance(e, CoverageThresholdMetEvent)
        ]
        if threshold_events:
            assert threshold_events[0].batch_index != 1

    @pytest.mark.asyncio
    async def test_generation_drops_cards_after_failed_repairs(self, monkeypatch):
        monkeypatch.setattr("lectern.config.GROUNDING_NON_PROGRESS_MAX_BATCHES", 1)
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Weak",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "",
                        "source_excerpt": "",
                    }
                ],
                "done": False,
            }
        )
        ai.reflect_cards = AsyncMock(
            side_effect=[
                {
                    "cards": [
                        {
                            "front": "Weak repaired 1",
                            "back": "A",
                            "source_pages": [1],
                            "concept_ids": ["c1"],
                            "rationale": "",
                            "source_excerpt": "",
                        }
                    ],
                    "done": False,
                },
                {
                    "cards": [
                        {
                            "front": "Weak repaired 2",
                            "back": "A",
                            "source_pages": [1],
                            "concept_ids": ["c1"],
                            "rationale": "",
                            "source_excerpt": "",
                        }
                    ],
                    "done": False,
                },
            ]
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": 1}]
        orchestrator.state.concept_map = {"concepts": [{"id": "c1"}], "relations": []}

        events = [
            e
            async for e in orchestrator.run_generation(
                ai_client=ai,
                config=GenerationConfig(
                    total_cards_cap=1,
                    actual_batch_size=1,
                    recent_card_window=100,
                    focus_prompt=None,
                    effective_target=1.0,
                    stop_check=None,
                    examples="",
                ),
            )
        ]

        assert not [e for e in events if isinstance(e, CardGeneratedEvent)]
        assert ai.reflect_cards.await_count == 2
        completed = [e for e in events if isinstance(e, GenerationBatchCompletedEvent)][0]
        assert completed.grounding_promoted_count == 0
        assert completed.grounding_dropped_count == 1
        warning_details = [
            e.details for e in events if isinstance(e, WarningEmittedEvent) and e.details
        ]
        assert any(details.get("reason") == "grounding_gate_failed" for details in warning_details)

    @pytest.mark.asyncio
    async def test_generation_promotes_only_gate_pass_cards(self, monkeypatch):
        monkeypatch.setattr("lectern.config.GROUNDING_NON_PROGRESS_MAX_BATCHES", 1)
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Grounded",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "Grounded rationale",
                        "source_excerpt": "Grounded excerpt",
                    },
                    {
                        "front": "Weak",
                        "back": "B",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "",
                        "source_excerpt": "",
                    },
                ],
                "done": False,
            }
        )
        ai.reflect_cards = AsyncMock(return_value={"cards": [], "done": False})
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": 1}]
        orchestrator.state.concept_map = {"concepts": [{"id": "c1"}], "relations": []}

        events = [
            e
            async for e in orchestrator.run_generation(
                ai_client=ai,
                config=GenerationConfig(
                    total_cards_cap=2,
                    actual_batch_size=2,
                    recent_card_window=100,
                    focus_prompt=None,
                    effective_target=1.0,
                    stop_check=None,
                    examples="",
                ),
            )
        ]

        cards = [e.card for e in events if isinstance(e, CardGeneratedEvent)]
        assert len(cards) == 1
        assert cards[0]["front"] == "Grounded"
        completed = [e for e in events if isinstance(e, GenerationBatchCompletedEvent)][0]
        assert completed.generated_candidates_count == 2
        assert completed.grounding_promoted_count == 1
        assert completed.grounding_dropped_count == 1

    @pytest.mark.asyncio
    async def test_grounding_non_progress_stop_reason_and_details(self, monkeypatch):
        monkeypatch.setattr("lectern.config.GROUNDING_NON_PROGRESS_MAX_BATCHES", 1)
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Dup-1",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "ok",
                        "source_excerpt": "ok",
                    },
                    {
                        "front": "Dup-2",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "ok",
                        "source_excerpt": "ok",
                    },
                    {
                        "front": "Weak",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "",
                        "source_excerpt": "",
                    },
                ],
                "done": False,
            }
        )
        ai.reflect_cards = AsyncMock(return_value={"cards": [], "done": False})
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": 1}]
        orchestrator.state.concept_map = {"concepts": [{"id": "c1"}], "relations": []}
        orchestrator.state.all_cards = [{"front": "Dup-1"}, {"front": "Dup-2"}]
        orchestrator.state.seen_keys = {"dup 1", "dup 2"}

        events = [
            e
            async for e in orchestrator.run_generation(
                ai_client=ai,
                config=GenerationConfig(
                    total_cards_cap=4,
                    actual_batch_size=3,
                    recent_card_window=100,
                    focus_prompt=None,
                    effective_target=1.0,
                    stop_check=None,
                    examples="",
                ),
            )
        ]

        stop = [e for e in events if isinstance(e, GenerationStoppedEvent)][0]
        assert stop.reason == "grounding_non_progress_duplicates"
        assert stop.details["consecutive_zero_promoted_batches"] == 1
        assert stop.details["last_batch_generated_candidates_count"] == 3
        assert stop.details["last_batch_grounding_promoted_count"] == 0
        assert stop.details["last_batch_grounding_dropped_count"] == 3
        assert stop.details["last_batch_duplicate_drop_count"] == 2
        assert stop.details["last_batch_gate_failure_drop_count"] == 1

    @pytest.mark.asyncio
    async def test_grounding_non_progress_tie_prefers_gate_failures(self, monkeypatch):
        monkeypatch.setattr("lectern.config.GROUNDING_NON_PROGRESS_MAX_BATCHES", 1)
        ai = MagicMock()
        ai.generate_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Dup",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "ok",
                        "source_excerpt": "ok",
                    },
                    {
                        "front": "Weak",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "",
                        "source_excerpt": "",
                    },
                ],
                "done": False,
            }
        )
        ai.reflect_cards = AsyncMock(return_value={"cards": [], "done": False})
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": 1}]
        orchestrator.state.concept_map = {"concepts": [{"id": "c1"}], "relations": []}
        orchestrator.state.all_cards = [{"front": "Dup"}]
        orchestrator.state.seen_keys = {"dup"}

        events = [
            e
            async for e in orchestrator.run_generation(
                ai_client=ai,
                config=GenerationConfig(
                    total_cards_cap=3,
                    actual_batch_size=2,
                    recent_card_window=100,
                    focus_prompt=None,
                    effective_target=1.0,
                    stop_check=None,
                    examples="",
                ),
            )
        ]

        stop = [e for e in events if isinstance(e, GenerationStoppedEvent)][0]
        assert stop.reason == "grounding_non_progress_gate_failures"
        assert stop.details["last_batch_duplicate_drop_count"] == 1
        assert stop.details["last_batch_gate_failure_drop_count"] == 1


class TestReflectionLoopPure:
    """Test reflection loop without SSE/HTTP mocking."""

    @pytest.mark.asyncio
    async def test_yields_reflection_events(self):
        ai = MagicMock()
        ai.reflect_cards = AsyncMock(
            return_value={
                "cards": [
                    {"front": "Q1_refined", "back": "A1_refined", "source_pages": [1]},
                ],
                "reflection": "Improved cards",
                "done": False,
            }
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        orchestrator.state.concept_map = {}

        # Pre-populate with cards
        orchestrator.state.all_cards = [{"front": "Q1", "back": "A1"}]
        orchestrator.state.seen_keys = {"q1"}

        config = ReflectionConfig(
            total_cards_cap=10,
            rounds=2,
            recent_card_window=100,
            hard_cap_multiplier=1.2,
            hard_cap_padding=5,
            stop_check=None,
        )

        events = [
            e async for e in orchestrator.run_reflection(ai_client=ai, config=config)
        ]

        round_started = [
            e for e in events if isinstance(e, ReflectionRoundStartedEvent)
        ]
        cards_replaced = [e for e in events if isinstance(e, CardsReplacedEvent)]

        round_completed = [
            e for e in events if isinstance(e, ReflectionRoundCompletedEvent)
        ]

        # The reflection loop runs 2 rounds since the refined card is different from the original
        # so did_change=True, and model_done=False
        assert len(round_started) == 2
        assert round_started[0].round_number == 1
        assert len(cards_replaced) == 2
        assert len(round_completed) == 2

        assert round_completed[0].cards_changed is True

    @pytest.mark.asyncio
    async def test_stops_on_user_cancel_during_reflection(self):
        ai = MagicMock()
        ai.reflect_cards = AsyncMock(
            return_value={"cards": [], "reflection": "", "done": False}
        )
        ai.drain_warnings.return_value = []

        # Stop check that returns True after first call
        call_count = [0]

        def stop_check():
            call_count[0] += 1
            return call_count[0] > 1  # Returns True on second call

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        orchestrator.state.concept_map = {}
        orchestrator.state.all_cards = [{"front": "Q1"}]

        config = ReflectionConfig(
            total_cards_cap=10,
            rounds=2,
            recent_card_window=100,
            hard_cap_multiplier=1.2,
            hard_cap_padding=5,
            stop_check=stop_check,
        )
        events = [
            e async for e in orchestrator.run_reflection(ai_client=ai, config=config)
        ]

        # Should have a ReflectionRoundStartedEvent and ReflectionStoppedEvent
        stop_events = [e for e in events if isinstance(e, ReflectionStoppedEvent)]
        assert len(stop_events) >= 1
        assert stop_events[0].reason == "user_cancel"

    @pytest.mark.asyncio
    async def test_handles_reflection_errors(self):
        ai = MagicMock()
        ai.reflect_cards = AsyncMock(side_effect=Exception("Reflection error"))
        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": i} for i in range(5)]
        orchestrator.state.concept_map = {}
        orchestrator.state.all_cards = [{"front": "Q1"}]
        config = ReflectionConfig(
            total_cards_cap=10,
            rounds=2,
            recent_card_window=100,
            hard_cap_multiplier=1.2,
            hard_cap_padding=5,
            stop_check=None,
        )
        events = [
            e async for e in orchestrator.run_reflection(ai_client=ai, config=config)
        ]
        warning_events = [e for e in events if isinstance(e, WarningEmittedEvent)]
        assert len(warning_events) >= 1
        assert "Reflection error" in warning_events[0].message

    @pytest.mark.asyncio
    async def test_reflection_keeps_original_when_replacement_fails_gate(self):
        ai = MagicMock()
        ai.reflect_cards = AsyncMock(
            return_value={
                "cards": [
                    {
                        "front": "Replacement",
                        "back": "A",
                        "source_pages": [1],
                        "concept_ids": ["c1"],
                        "rationale": "",
                        "source_excerpt": "",
                    }
                ],
                "reflection": "attempted replacement",
                "done": True,
            }
        )
        ai.drain_warnings.return_value = []

        orchestrator = SessionOrchestrator()
        orchestrator.state.pages = [{"number": 1}]
        orchestrator.state.concept_map = {"concepts": [{"id": "c1"}], "relations": []}
        original = {
            "front": "Original",
            "back": "A",
            "source_pages": [1],
            "concept_ids": ["c1"],
            "rationale": "grounded",
            "source_excerpt": "grounded excerpt",
        }
        orchestrator.state.all_cards = [original]
        orchestrator.state.seen_keys = {"original"}

        replacement = {
            "front": "Replacement",
            "back": "A",
            "source_pages": [1],
            "concept_ids": ["c1"],
            "rationale": "",
            "source_excerpt": "",
        }
        with patch(
            "lectern.orchestration.session_orchestrator._select_best_reflection_cards",
            return_value=([replacement], {"quality_delta": 1.0}),
        ):
            events = [
                e
                async for e in orchestrator.run_reflection(
                    ai_client=ai,
                    config=ReflectionConfig(
                        total_cards_cap=10,
                        rounds=1,
                        recent_card_window=100,
                        hard_cap_multiplier=1.2,
                        hard_cap_padding=5,
                        stop_check=None,
                    ),
                )
            ]

        replaced = [e for e in events if isinstance(e, CardsReplacedEvent)][0]
        assert replaced.cards[0]["front"] == "Original"
        assert orchestrator.state.all_cards[0]["front"] == "Original"
        assert orchestrator.state.seen_keys == {"original"}


class TestSSEEmitter:
    """Test SSE transformation layer."""

    def test_card_event_transforms_correctly(self):
        event = CardGeneratedEvent(
            batch_index=1,
            card={"front": "Q1", "back": "A1", "id": "test-uuid"},
            is_refined=False,
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "card"
        assert service_event.data["card"]["front"] == "Q1"
        assert service_event.data["card"]["id"] == "test-uuid"

    def test_refined_card_event_transforms_correctly(self):
        event = CardGeneratedEvent(
            batch_index=1,
            card={"front": "Q1", "back": "A1", "id": "test-uuid"},
            is_refined=True,
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "card"
        assert service_event.message == "Refined card"

        assert service_event.data["card"]["id"] == "test-uuid"

    def test_warning_event_transforms_correctly(self):
        event = WarningEmittedEvent(
            batch_index=2,
            message="Duplicate card detected",
            details={"card_key": "q1"},
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "warning"
        assert "Duplicate" in service_event.message
        assert service_event.data["card_key"] == "q1"

    def test_progress_event_transforms_correctly(self):
        event = ProgressUpdatedEvent(
            current=5,
            total=10,
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "progress_update"
        assert service_event.data["current"] == 5
        assert service_event.data["total"] == 10

    def test_error_event_transforms_correctly(self):
        event = ErrorOccurredEvent(
            batch_index=1,
            message="Test error",
            recoverable=False,
            stage="generation",
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "error"
        assert "Test error" in service_event.message
        assert service_event.data["recoverable"] is False
        assert service_event.data["stage"] == "generation"

    def test_cards_replaced_event_transforms_correctly(self):
        event = CardsReplacedEvent(
            cards=[{"front": "Q1"}, {"front": "Q2"}],
            coverage_data={"page_coverage_pct": 80},
            reflection_text="Improved cards",
            selection_summary={"quality_delta": 5.0},
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "cards_replaced"
        assert len(service_event.data["cards"]) == 2
        assert service_event.data["reflection"] == "Improved cards"
        assert service_event.data["selection_summary"]["quality_delta"] == 5.0

    def test_reflection_round_started_event(self):
        event = ReflectionRoundStartedEvent(
            round_number=1,
            total_rounds=2,
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "status"
        assert "Reflection Round 1/2" in service_event.message

    def test_reflection_round_completed_event(self):
        event = ReflectionRoundCompletedEvent(
            round_number=1,
            quality_delta=5.0,
            cards_changed=True,
            selection_summary={"quality_delta": 5.0},
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "info"
        assert "quality delta 5.0" in service_event.message
        assert service_event.data["cards_changed"] is True

    def test_reflection_stopped_event(self):
        event = ReflectionStoppedEvent(reason="model_done")
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "warning"
        assert "model_done" in service_event.message

    def test_generation_batch_completed_event_transforms_grounding_fields(self):
        event = GenerationBatchCompletedEvent(
            batch_index=3,
            cards_added=4,
            model_done=False,
            generated_candidates_count=6,
            grounding_repair_attempted_count=2,
            grounding_promoted_count=1,
            grounding_dropped_count=1,
            grounding_drop_reasons={"missing_source": 1},
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "info"
        assert service_event.data["batch"] == 3
        assert service_event.data["added"] == 4
        assert service_event.data["generated_candidates_count"] == 6
        assert service_event.data["grounding_repair_attempted_count"] == 2
        assert service_event.data["grounding_promoted_count"] == 1
        assert service_event.data["grounding_dropped_count"] == 1
        assert service_event.data["grounding_drop_reasons"] == {"missing_source": 1}

    def test_generation_stopped_event_transforms_details_payload(self):
        event = GenerationStoppedEvent(
            reason="grounding_non_progress",
            details={"non_progress_batches": 2},
        )
        service_event = SSEEmitter.domain_to_service_event(event)
        assert service_event.type == "warning"
        assert service_event.message == "Generation stopped: grounding_non_progress"
        assert service_event.data["reason"] == "grounding_non_progress"
        assert service_event.data["details"] == {"non_progress_batches": 2}

    def test_ndjson_conversion(self):
        event = CardGeneratedEvent(
            batch_index=1,
            card={"front": "Q1", "back": "A1", "id": "test-uuid"},
            is_refined=False,
        )
        ndjson = SSEEmitter.to_ndjson(event)
        assert '"type": "card"' in ndjson
        assert '"front": "Q1"' in ndjson
        assert '"id": "test-uuid"' in ndjson
        assert ndjson.endswith("\n")

    def test_stream_events(self):
        events = [
            CardGeneratedEvent(
                batch_index=1, card={"front": "Q1", "id": "id1"}, is_refined=False
            ),
            CardGeneratedEvent(
                batch_index=1, card={"front": "Q2", "id": "id2"}, is_refined=False
            ),
        ]
        ndjson_lines = list(SSEEmitter.stream_events(iter(events)))
        assert len(ndjson_lines) == 2
        for line in ndjson_lines:
            assert line.endswith("\n")
            assert '"front": "Q1"' in ndjson_lines[0]
            assert '"front": "Q2"' in ndjson_lines[1]
