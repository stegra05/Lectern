from __future__ import annotations

from typing import Literal

LifecycleState = Literal[
    "idle",
    "running",
    "stopped",
    "error",
    "completed",
    "cancelled",
]

EngineOperation = Literal[
    "start",
    "resume",
    "cancel",
    "stop",
    "complete",
    "fail",
]

GenerationPhase = Literal[
    "generation",
    "reflection",
    "export",
]

SessionMode = Literal[
    "start",
    "resume",
]
