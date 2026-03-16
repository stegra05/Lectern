from typing import Any, Dict, Literal
from dataclasses import dataclass, field

EventType = Literal[
    "status",
    "info",
    "warning",
    "error",
    "step_start",
    "step_end",
    "progress_start",
    "progress_update",
    "card",
    "note",
    "done",
    "cancelled",
    "note_created",
    "note_updated",
    "note_recreated",
    "cards_replaced",
    "control_snapshot",
]


@dataclass
class ServiceEvent:
    type: EventType
    message: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
