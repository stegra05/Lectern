"""
Phase handlers for Lectern generation service.

This module keeps the legacy handler API while delegating concept mapping
logic to the new pipeline phases to avoid duplicated behavior.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Dict, AsyncGenerator, List, Optional

from lectern.ai_client import LecternAIClient
from lectern.cost_estimator import extract_pdf_metadata
from lectern.events.service_events import ServiceEvent
from lectern.orchestration.phases import ConceptMappingPhase, PhaseExecutionHalt
from lectern.orchestration.pipeline_context import SessionConfig, SessionContext
from lectern.utils.note_export import export_card_to_anki
from lectern import config


@dataclass
class ConceptPhaseResult:
    """Result of the concept phase."""

    success: bool
    concept_map: Dict[str, Any]
    slide_set_name: str
    pages: List[Any]
    total_text_chars: int
    uploaded_pdf: Dict[str, str]
    ai: Optional[LecternAIClient] = None


@dataclass
class ExportPhaseResult:
    """Result of the export phase."""

    success: bool
    created: int
    failed: int
    total: int


@dataclass
class _QueueEmitter:
    queue: asyncio.Queue[ServiceEvent | None]

    async def emit_event(self, event: ServiceEvent) -> None:
        await self.queue.put(event)


class ConceptPhaseHandler:
    """Legacy adapter for concept mapping and AI initialization phase."""

    def __init__(
        self,
        pdf_path: str,
        deck_name: str,
        model_name: str,
        focus_prompt: Optional[str] = None,
    ):
        self.pdf_path = pdf_path
        self.deck_name = deck_name
        self.model_name = model_name
        self.focus_prompt = focus_prompt

    async def run(
        self,
        file_size: int,
        context_deck: str = "",
    ) -> AsyncGenerator[Dict[str, Any], ConceptPhaseResult]:
        """Run concept phase through the shared ConceptMappingPhase."""
        context = SessionContext(
            config=SessionConfig(
                pdf_path=self.pdf_path,
                deck_name=self.deck_name,
                model_name=self.model_name,
                tags=[],
                context_deck=context_deck,
                skip_export=False,
                focus_prompt=self.focus_prompt,
            )
        )
        context.pdf.file_size = file_size
        metadata = await asyncio.to_thread(extract_pdf_metadata, self.pdf_path)
        context.pdf.page_count = int(metadata.get("page_count") or 0)
        context.pdf.text_chars = int(metadata.get("text_chars") or 0)
        context.pdf.image_count = int(metadata.get("image_count") or 0)

        ai = LecternAIClient(
            model_name=self.model_name,
            focus_prompt=self.focus_prompt,
            slide_set_context=None,
        )
        queue: asyncio.Queue[ServiceEvent | None] = asyncio.Queue()
        emitter = _QueueEmitter(queue=queue)
        phase = ConceptMappingPhase()

        async def _run_phase() -> PhaseExecutionHalt | None:
            try:
                await phase.execute(context, emitter, ai)
                return None
            except PhaseExecutionHalt as exc:
                return exc
            finally:
                await queue.put(None)

        phase_task = asyncio.create_task(_run_phase())

        while True:
            event = await queue.get()
            if event is None:
                break
            yield {
                "type": event.type,
                "message": event.message,
                "data": event.data,
            }

        halt = await phase_task
        if halt is not None:
            return

        yield ConceptPhaseResult(
            success=True,
            concept_map=context.concept_map,
            slide_set_name=context.slide_set_name,
            pages=context.pages,
            total_text_chars=context.pdf.metadata_chars or context.pdf.text_chars,
            uploaded_pdf=context.uploaded_pdf,
            ai=ai,
        )


class ExportPhaseHandler:
    """Handler for exporting cards to Anki."""

    def __init__(
        self,
        deck_name: str,
        slide_set_name: str,
        additional_tags: List[str],
    ):
        self.deck_name = deck_name
        self.slide_set_name = slide_set_name
        self.additional_tags = additional_tags

    async def run(
        self,
        cards: List[Dict[str, Any]],
    ) -> AsyncGenerator[Dict[str, Any], ExportPhaseResult]:
        """Export cards to Anki (Async)."""
        yield {
            "type": "step_start",
            "message": f"Create {len(cards)} notes in Anki",
            "data": {},
        }
        yield {
            "type": "progress_start",
            "message": "Exporting",
            "data": {"total": len(cards), "label": "Notes"},
        }

        created = 0
        failed = 0

        for idx, card in enumerate(cards, start=1):
            result = await export_card_to_anki(
                card=card,
                deck_name=self.deck_name,
                slide_set_name=self.slide_set_name,
                fallback_model=config.DEFAULT_BASIC_MODEL,
                additional_tags=self.additional_tags,
            )

            if result.success:
                created += 1
                yield {
                    "type": "note",
                    "message": f"Created note {result.note_id}",
                    "data": {"id": result.note_id},
                }
            else:
                failed += 1
                yield {
                    "type": "warning",
                    "message": f"Failed to create note: {result.error}",
                    "data": {},
                }

            yield {
                "type": "progress_update",
                "message": "",
                "data": {"current": created + failed},
            }

        yield {
            "type": "step_end",
            "message": "Export Complete",
            "data": {"success": True, "created": created, "failed": failed},
        }

        yield ExportPhaseResult(
            success=True,
            created=created,
            failed=failed,
            total=len(cards),
        )
