from __future__ import annotations

import inspect

import pytest

from lectern.domain.generation.engine import GenerationEngine
from lectern.domain.generation.state import EngineState, InvalidStateTransition


def test_engine_state_blocks_duplicate_start_from_running() -> None:
    state = EngineState(session_id="s1", lifecycle="running")

    with pytest.raises(InvalidStateTransition):
        state.transition("start")


def test_engine_state_allows_resume_from_stopped() -> None:
    state = EngineState(session_id="s1", lifecycle="stopped")

    resumed = state.transition("resume")

    assert resumed.lifecycle == "running"


@pytest.mark.parametrize(
    ("lifecycle", "operation", "expected_lifecycle"),
    [
        ("idle", "start", "running"),
        ("error", "resume", "running"),
        ("running", "cancel", "cancelled"),
        ("cancelled", "cancel", "cancelled"),
        ("completed", "cancel", "completed"),
        ("error", "cancel", "error"),
    ],
)
def test_engine_state_transitions_follow_contract(
    lifecycle: str,
    operation: str,
    expected_lifecycle: str,
) -> None:
    state = EngineState(session_id="s1", lifecycle=lifecycle)

    transitioned = state.transition(operation)

    assert transitioned.lifecycle == expected_lifecycle


@pytest.mark.parametrize(
    ("lifecycle", "operation"),
    [
        ("running", "resume"),
        ("completed", "resume"),
        ("idle", "resume"),
    ],
)
def test_engine_state_rejects_invalid_transitions(lifecycle: str, operation: str) -> None:
    state = EngineState(session_id="s1", lifecycle=lifecycle)

    with pytest.raises(InvalidStateTransition):
        state.transition(operation)


def test_generation_engine_protocol_exposes_required_methods() -> None:
    required_methods = {
        "initialize",
        "run_generation",
        "run_reflection",
        "run_export",
        "cancel",
    }

    for method_name in required_methods:
        assert method_name in GenerationEngine.__dict__
        assert inspect.iscoroutinefunction(GenerationEngine.__dict__[method_name])
