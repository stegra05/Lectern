from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol

from lectern.domain.generation.events import DomainEvent
from lectern.domain.generation.state import EngineState
from lectern.domain.generation.types import SessionMode


@dataclass(frozen=True)
class EngineContext:
    session_id: str
    mode: SessionMode
    metadata: dict[str, Any] = field(default_factory=dict)


class GenerationEngine(Protocol):
    async def initialize(self, ctx: EngineContext) -> EngineState: ...

    async def run_generation(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...

    async def run_reflection(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...

    async def run_export(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...

    async def cancel(self, state: EngineState, *, reason: str) -> EngineState: ...
