"""Pipeline context and phase interfaces for the generation pipeline.

This module defines the data structures that enable the "Strangle the Monolith"
refactor of the _execute_pipeline method. The SessionContext serves as a unified
state container, replacing loose local variables.

Ticket 2: Define SessionContext & PipelinePhase Interfaces
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Optional, Protocol, runtime_checkable

if TYPE_CHECKING:
    from lectern.events.pipeline_emitter import PipelineEmitter
    from lectern.providers.base import AIProvider


def _pdf_stem(pdf_path: str) -> str:
    if not pdf_path:
        return ""
    return os.path.splitext(os.path.basename(pdf_path))[0]


@dataclass
class SessionConfig:
    """User-provided configuration for a generation session.

    This captures all the inputs that control how generation proceeds.
    """

    deck_name: str = ""
    model_name: str = ""
    tags: list[str] = field(default_factory=list)
    pdf_path: str = ""
    context_deck: str = ""
    skip_export: bool = False
    stop_check: Optional[Callable[[], bool]] = None
    focus_prompt: Optional[str] = None
    target_card_count: Optional[int] = None
    session_id: Optional[str] = None
    entry_id: Optional[str] = None


@dataclass
class PDFMetadata:
    """Metadata extracted from the PDF document.

    Initial values are extracted during PDF parsing, then refined after
    the concept map phase provides advisory data.
    """

    path: str = ""
    filename: str = ""
    title: str = ""
    file_size: int = 0
    page_count: int = 0
    text_chars: int = 0
    image_count: int = 0
    # Refined after concept map
    metadata_pages: int = 0
    metadata_chars: int = 0

    def __post_init__(self) -> None:
        if self.path and not self.filename:
            self.filename = _pdf_stem(self.path)


@dataclass
class GenerationTargets:
    """Computed targets and settings for card generation.

    These values are derived from PDF metadata, concept map analysis,
    and user configuration.
    """

    effective_target: float = 0.0
    total_cards_cap: int = 0
    actual_batch_size: int = 0
    is_script_mode: bool = False
    chars_per_page: float = 0.0


@dataclass
class SessionContext:
    """Main state container for a generation session.

    This consolidates all the state that was previously passed as loose
    local variables in _execute_pipeline. It provides a single source of
    truth for pipeline phases.

    Usage:
        context = SessionContext.from_generation_config(cfg)
        context.pdf.page_count = 42
        await phase.execute(context, emitter, ai_client)
    """

    # Grouped configuration
    config: SessionConfig = field(default_factory=SessionConfig)
    pdf: PDFMetadata = field(default_factory=PDFMetadata)
    targets: GenerationTargets = field(default_factory=GenerationTargets)

    # AI context (populated during initialization phases)
    uploaded_pdf: dict[str, str] = field(default_factory=dict)
    concept_map: dict[str, Any] = field(default_factory=dict)
    examples: str = ""
    slide_set_name: str = ""

    # Accumulated state (mutated during generation)
    all_cards: list[dict[str, Any]] = field(default_factory=list)
    seen_keys: set[str] = field(default_factory=set)
    pages: list[dict[str, Any]] = field(default_factory=list)

    # Coverage tracking
    initial_coverage: dict[str, Any] = field(default_factory=dict)
    reflected_coverage: dict[str, Any] = field(default_factory=dict)
    final_coverage: dict[str, Any] = field(default_factory=dict)
    rubric_summary: dict[str, Any] | None = None

    # Loop state
    batch_index: int = 0
    reflection_round: int = 0
    run_started_at: float = 0.0

    def __post_init__(self) -> None:
        if self.config.pdf_path and not self.pdf.path:
            self.pdf.path = self.config.pdf_path
        if self.pdf.path and not self.pdf.filename:
            self.pdf.filename = _pdf_stem(self.pdf.path)

    # --- Convenience properties ---

    @property
    def total_pages(self) -> int:
        """Total number of pages in the document."""
        return self.pdf.metadata_pages or self.pdf.page_count or len(self.pages)

    @property
    def card_count(self) -> int:
        """Current number of generated cards."""
        return len(self.all_cards)

    @property
    def deck_name(self) -> str:
        """Target deck name for export."""
        return self.config.deck_name

    @property
    def session_id(self) -> str:
        """Session identifier."""
        return self.config.session_id or ""

    # --- Factory methods ---

    @classmethod
    def from_generation_config(
        cls,
        cfg: "GenerationConfig",
    ) -> "SessionContext":
        """Create context from legacy GenerationConfig.

        This factory method enables gradual migration from the existing
        GenerationConfig dataclass to SessionContext.
        """
        config = SessionConfig(
            pdf_path=cfg.pdf_path,
            deck_name=cfg.deck_name,
            model_name=cfg.model_name,
            tags=list(cfg.tags),
            context_deck=cfg.context_deck,
            skip_export=cfg.skip_export,
            stop_check=cfg.stop_check,
            focus_prompt=cfg.focus_prompt,
            target_card_count=cfg.target_card_count,
            session_id=cfg.session_id,
            entry_id=cfg.entry_id,
        )
        pdf = PDFMetadata(path=cfg.pdf_path)
        return cls(config=config, pdf=pdf)


@runtime_checkable
class PipelinePhase(Protocol):
    """Protocol for pipeline phases.

    Each phase in the generation pipeline (initialization, concept mapping,
    generation, reflection, export) implements this protocol.

    Phases receive:
    - context: Mutable state container
    - emitter: Event emitter for progress/status
    - ai_client: AI client for generation

    Phases mutate context in place and emit events for progress tracking.
    """

    async def execute(
        self,
        context: SessionContext,
        emitter: "PipelineEmitter",
        ai_client: "AIProvider",
    ) -> None:
        """Execute this pipeline phase.

        Args:
            context: Mutable session state
            emitter: Event emitter for progress updates
            ai_client: AI client for generation

        Raises:
            Exception: Phase-specific errors (handled by caller)
        """
        ...
