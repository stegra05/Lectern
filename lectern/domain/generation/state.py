from __future__ import annotations

from dataclasses import dataclass

from lectern.domain.generation.types import EngineOperation, LifecycleState


class InvalidStateTransition(ValueError):
    pass


_TRANSITIONS: dict[tuple[LifecycleState, EngineOperation], LifecycleState] = {
    ("idle", "start"): "running",
    ("stopped", "resume"): "running",
    ("error", "resume"): "running",
    ("running", "cancel"): "cancelled",
    ("cancelled", "cancel"): "cancelled",
    ("completed", "cancel"): "completed",
    ("error", "cancel"): "error",
    ("running", "stop"): "stopped",
    ("running", "complete"): "completed",
    ("running", "fail"): "error",
}


@dataclass(frozen=True)
class EngineState:
    session_id: str
    lifecycle: LifecycleState = "idle"

    def transition(self, operation: EngineOperation) -> EngineState:
        next_lifecycle = _TRANSITIONS.get((self.lifecycle, operation))
        if next_lifecycle is None:
            raise InvalidStateTransition(
                f"Invalid transition: lifecycle={self.lifecycle}, operation={operation}"
            )
        return EngineState(session_id=self.session_id, lifecycle=next_lifecycle)
