from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from typing import Any

from gui.backend.sse_emitter import SSEEmitter
from lectern import config
from lectern.ai_client import DocumentUploadError, UploadedDocument
from lectern.anki_connector import get_connection_info, sample_examples_from_deck
from lectern.cost_estimator import extract_pdf_metadata
from lectern.coverage import compute_coverage_data
from lectern.events.pipeline_emitter import PipelineEmitter
from lectern.events.service_events import ServiceEvent
from lectern.orchestration.pipeline_context import PipelinePhase, SessionContext
from lectern.providers.base import AIProvider
from lectern.orchestration.session_orchestrator import (
    GenerationConfig as OrchGenerationConfig,
    GenerationSetupConfig,
    ReflectionConfig as OrchReflectionConfig,
    SessionOrchestrator,
)
from lectern.utils.error_handling import capture_exception
from lectern.utils.history import HistoryManager
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.tags import infer_slide_set_name


@dataclass
class PhaseExecutionHalt(Exception):
    """Signal that pipeline execution should stop after a terminal phase event."""

    history_status: str = "error"


class InitializationPhase(PipelinePhase):
    async def execute(
        self,
        context: SessionContext,
        emitter: PipelineEmitter,
        ai_client: AIProvider,
    ) -> None:
        del ai_client
        pdf_path = context.config.pdf_path

        if not os.path.exists(pdf_path):
            await emitter.emit_event(
                ServiceEvent(
                    "error",
                    f"PDF path not found: {pdf_path}",
                    {"recoverable": False},
                )
            )
            raise PhaseExecutionHalt("error")

        file_size = os.path.getsize(pdf_path)
        if file_size == 0:
            await emitter.emit_event(
                ServiceEvent(
                    "error",
                    "The uploaded PDF is empty (0 bytes).",
                    {"recoverable": False},
                )
            )
            raise PhaseExecutionHalt("error")

        metadata = await asyncio.to_thread(extract_pdf_metadata, pdf_path)
        context.pdf.file_size = file_size
        context.pdf.path = pdf_path
        context.pdf.page_count = int(metadata.get("page_count") or 0)
        context.pdf.text_chars = int(metadata.get("text_chars") or 0)
        context.pdf.image_count = int(metadata.get("image_count") or 0)

        if context.config.skip_export:
            return

        anki_info = await get_connection_info()
        anki_ready = bool(
            anki_info.get("connected") and anki_info.get("collection_available", False)
        )
        if anki_ready:
            await emitter.emit_event(
                ServiceEvent("step_end", "AnkiConnect Connected", {"success": True})
            )
            return

        reason = (
            anki_info.get("error") or "AnkiConnect collection is not available yet."
        )
        if config.DEBUG:
            await emitter.emit_event(
                ServiceEvent(
                    "warning",
                    f"Anki unavailable ({reason}), but DEBUG is ON. Proceeding with skip_export=True.",
                )
            )
            context.config.skip_export = True
            return

        await emitter.emit_event(
            ServiceEvent(
                "error",
                f"Could not use AnkiConnect: {reason}",
                {"recoverable": False, "error_kind": anki_info.get("error_kind")},
            )
        )
        raise PhaseExecutionHalt("error")


class ConceptMappingPhase(PipelinePhase):
    async def execute(
        self,
        context: SessionContext,
        emitter: PipelineEmitter,
        ai_client: AIProvider,
    ) -> None:
        phase_started_at = time.perf_counter()
        await emitter.emit_event(
            ServiceEvent(
                "step_start", "Extracting images and text", {"phase": "concept"}
            )
        )

        examples = ""
        await emitter.emit_event(
            ServiceEvent("step_start", "Sample examples from deck")
        )
        examples_started_at = time.perf_counter()
        try:
            if not context.config.skip_export:
                deck_for_examples = (
                    context.config.context_deck or context.config.deck_name
                )
                examples = await sample_examples_from_deck(
                    deck_name=deck_for_examples, sample_size=5
                )
            if examples.strip():
                await emitter.emit_event(
                    ServiceEvent("info", "Loaded style examples from Anki")
                )
            elif context.config.skip_export:
                await emitter.emit_event(
                    ServiceEvent(
                        "info",
                        "Skipping style example sampling (Anki unavailable / draft mode).",
                    )
                )
            await emitter.emit_event(
                ServiceEvent(
                    "step_end",
                    "Examples Loaded",
                    {
                        "success": True,
                        "duration_ms": int(
                            (time.perf_counter() - examples_started_at) * 1000
                        ),
                    },
                )
            )
        except Exception as exc:
            user_msg, _ = capture_exception(exc, "Sample examples")
            await emitter.emit_event(
                ServiceEvent(
                    "error",
                    f"Failed to sample examples: {user_msg}",
                    {"recoverable": True},
                )
            )
            await emitter.emit_event(
                ServiceEvent(
                    "step_end",
                    "Examples Failed",
                    {
                        "success": False,
                        "duration_ms": int(
                            (time.perf_counter() - examples_started_at) * 1000
                        ),
                    },
                )
            )
        context.examples = examples

        await emitter.emit_event(ServiceEvent("step_start", "Start AI session"))
        session_started_at = time.perf_counter()
        await emitter.emit_event(
            ServiceEvent(
                "step_end",
                "Session Started",
                {
                    "success": True,
                    "duration_ms": int(
                        (time.perf_counter() - session_started_at) * 1000
                    ),
                    "ai_log_path": getattr(ai_client, "log_path", ""),
                },
            )
        )

        await emitter.emit_event(ServiceEvent("step_start", "Upload PDF to Gemini"))
        try:
            uploaded_doc = await ai_client.upload_document(context.config.pdf_path)
            if isinstance(uploaded_doc, UploadedDocument):
                context.uploaded_pdf = uploaded_doc.to_dict()
                duration_ms = uploaded_doc.duration_ms
            else:
                context.uploaded_pdf = dict(uploaded_doc)
                duration_ms = int(context.uploaded_pdf.get("duration_ms") or 0)
            await emitter.emit_event(
                ServiceEvent(
                    "step_end",
                    "PDF Uploaded",
                    {"success": True, "duration_ms": duration_ms},
                )
            )
        except DocumentUploadError as exc:
            await emitter.emit_event(
                ServiceEvent("step_end", "PDF Upload Failed", {"success": False})
            )
            await emitter.emit_event(
                ServiceEvent(
                    "error",
                    f"Native PDF upload failed: {exc.user_message}",
                    {
                        "recoverable": False,
                        "terminal": True,
                        "stage": "upload",
                        "elapsed_ms": int(
                            (time.perf_counter() - phase_started_at) * 1000
                        ),
                    },
                )
            )
            raise PhaseExecutionHalt("error")

        concept_map: dict[str, Any] = {}
        actual_pages = context.pdf.page_count
        actual_text_chars = context.pdf.text_chars

        await emitter.emit_event(
            ServiceEvent("step_start", "Build global concept map", {"phase": "concept"})
        )
        await emitter.emit_event(
            ServiceEvent(
                "progress_start",
                "Analyzing slides",
                {"total": actual_pages, "phase": "concept"},
            )
        )
        concept_started_at = time.perf_counter()
        await emitter.emit_event(
            ServiceEvent(
                "progress_update",
                "",
                {"current": 0, "total": actual_pages, "phase": "concept"},
            )
        )

        try:
            raw_concept_map = await ai_client.build_concept_map(
                file_uri=context.uploaded_pdf["uri"],
                mime_type=context.uploaded_pdf.get("mime_type", "application/pdf"),
            )
            concept_map = raw_concept_map if isinstance(raw_concept_map, dict) else {}
            if not concept_map:
                try:
                    legacy_map = await ai_client.build_concept_map(pdf_content=[])
                    if isinstance(legacy_map, dict):
                        concept_map = legacy_map
                except Exception:
                    pass

            advised_pages = int(concept_map.get("page_count") or 0)
            advised_chars = int(concept_map.get("estimated_text_chars") or 0)
            metadata_pages = actual_pages
            metadata_chars = actual_text_chars
            page_delta_limit = max(5, int(actual_pages * 0.25))
            if (
                advised_pages > 0
                and abs(advised_pages - actual_pages) <= page_delta_limit
            ):
                metadata_pages = advised_pages

            if advised_chars > 0:
                if actual_text_chars <= 0:
                    metadata_chars = advised_chars
                else:
                    min_chars = int(actual_text_chars * 0.25)
                    max_chars = int(actual_text_chars * 4.0)
                    if min_chars <= advised_chars <= max_chars:
                        metadata_chars = advised_chars

            if metadata_chars <= 0:
                metadata_chars = metadata_pages * 800

            context.pages = [{} for _ in range(metadata_pages)]
            context.pdf.metadata_pages = metadata_pages
            context.pdf.metadata_chars = metadata_chars

            await emitter.emit_event(
                ServiceEvent(
                    "progress_update",
                    "",
                    {
                        "current": metadata_pages,
                        "total": metadata_pages,
                        "phase": "concept",
                    },
                )
            )
            context.initial_coverage = await asyncio.to_thread(
                compute_coverage_data,
                cards=[],
                concept_map=concept_map,
                total_pages=metadata_pages,
            )
            await emitter.emit_event(
                ServiceEvent(
                    "step_end",
                    "Concept Map Built",
                    {
                        "success": True,
                        "page_count": metadata_pages,
                        "coverage_data": context.initial_coverage,
                        "duration_ms": int(
                            (time.perf_counter() - concept_started_at) * 1000
                        ),
                        "concept_count": len(concept_map.get("concepts") or []),
                        "relation_count": len(concept_map.get("relations") or []),
                    },
                )
            )
            await emitter.emit_event(
                ServiceEvent("info", "Concept Map built", {"map": concept_map})
            )
            for warning in ai_client.drain_warnings():
                await emitter.emit_event(ServiceEvent("warning", warning))
        except Exception as exc:
            user_msg, _ = capture_exception(exc, "Concept map")
            await emitter.emit_event(
                ServiceEvent(
                    "error",
                    f"Concept map failed: {user_msg}",
                    {"recoverable": True, "stage": "concept_map"},
                )
            )
            await emitter.emit_event(
                ServiceEvent(
                    "step_end",
                    "Concept Map Failed",
                    {
                        "success": False,
                        "duration_ms": int(
                            (time.perf_counter() - concept_started_at) * 1000
                        ),
                    },
                )
            )
            metadata_pages = actual_pages
            context.pages = [{} for _ in range(metadata_pages)]
            context.pdf.metadata_pages = metadata_pages
            context.pdf.metadata_chars = actual_text_chars or (metadata_pages * 800)

        pdf_filename = os.path.splitext(os.path.basename(context.config.pdf_path))[0]
        slide_set_name = concept_map.get("slide_set_name", "") if concept_map else ""
        if not slide_set_name:
            slide_set_name = infer_slide_set_name("", pdf_filename)
        if not slide_set_name:
            slide_set_name = pdf_filename.replace("_", " ").replace("-", " ").title()

        context.concept_map = concept_map
        context.slide_set_name = slide_set_name
        await emitter.emit_event(
            ServiceEvent("info", f"Slide Set Name: '{slide_set_name}'")
        )
        ai_client.set_slide_set_context(
            deck_name=context.config.deck_name,
            slide_set_name=slide_set_name,
        )


class GenerationPhase(PipelinePhase):
    async def execute(
        self,
        context: SessionContext,
        emitter: PipelineEmitter,
        ai_client: AIProvider,
    ) -> None:
        total_text_chars = context.pdf.metadata_chars or context.pdf.text_chars
        orchestrator = SessionOrchestrator()
        setup = orchestrator.prepare_generation(
            GenerationSetupConfig(
                pages=context.pages,
                concept_map=context.concept_map,
                examples=context.examples,
                estimated_text_chars=total_text_chars,
                image_count=context.pdf.image_count,
                target_card_count=context.config.target_card_count,
            )
        )

        context.targets.effective_target = setup.effective_target
        context.targets.total_cards_cap = setup.total_cards_cap
        context.targets.is_script_mode = setup.is_script_mode
        context.targets.chars_per_page = setup.chars_per_page
        context.initial_coverage = setup.initial_coverage

        if setup.is_script_mode:
            await emitter.emit_event(
                ServiceEvent(
                    "info",
                    f"Script mode: ~{setup.total_cards_cap} cards target ({setup.chars_per_page:.0f} chars/page)",
                )
            )
        else:
            await emitter.emit_event(
                ServiceEvent(
                    "info",
                    f"Slides mode: ~{setup.total_cards_cap} cards target ({len(context.pages)} pages × {setup.effective_target:.1f})",
                )
            )

        batch_size = max(
            config.MIN_NOTES_PER_BATCH,
            min(config.MAX_NOTES_PER_BATCH, len(context.pages) // 2),
        )
        context.targets.actual_batch_size = int(batch_size)

        await emitter.emit_event(
            ServiceEvent(
                "progress_start",
                "Generating Cards",
                {"total": setup.total_cards_cap, "label": "Generation"},
            )
        )
        await emitter.emit_event(
            ServiceEvent("step_start", "Generate cards", {"phase": "generating"})
        )
        generation_started_at = time.perf_counter()

        gen_config = OrchGenerationConfig(
            total_cards_cap=setup.total_cards_cap,
            actual_batch_size=context.targets.actual_batch_size,
            focus_prompt=context.config.focus_prompt,
            effective_target=setup.effective_target,
            stop_check=context.config.stop_check,
            examples=context.examples,
        )
        async for event in orchestrator.run_generation(
            ai_client=ai_client, config=gen_config
        ):
            await emitter.emit_event(SSEEmitter.domain_to_service_event(event))

        context.all_cards = list(orchestrator.state.all_cards)
        context.seen_keys = set(orchestrator.state.seen_keys)
        await emitter.emit_event(
            ServiceEvent(
                "step_end",
                "Generation Phase Complete",
                {
                    "success": True,
                    "count": len(context.all_cards),
                    "duration_ms": int(
                        (time.perf_counter() - generation_started_at) * 1000
                    ),
                },
            )
        )

        rounds = (
            1
            if 0 < len(context.all_cards) < 50
            else 2 if len(context.all_cards) > 0 else 0
        )
        if rounds > 0 and not orchestrator.should_stop(context.config.stop_check):
            await emitter.emit_event(
                ServiceEvent(
                    "step_start",
                    "Reflection and improvement",
                    {"phase": "reflecting"},
                )
            )
            reflection_started_at = time.perf_counter()
            await emitter.emit_event(
                ServiceEvent(
                    "progress_start",
                    "Reflection",
                    {"total": rounds, "label": "Reflection Rounds"},
                )
            )

            ref_config = OrchReflectionConfig(
                total_cards_cap=setup.total_cards_cap,
                rounds=rounds,
                stop_check=context.config.stop_check,
            )
            async for event in orchestrator.run_reflection(
                ai_client=ai_client, config=ref_config
            ):
                await emitter.emit_event(SSEEmitter.domain_to_service_event(event))

            context.all_cards = list(orchestrator.state.all_cards)
            context.seen_keys = set(orchestrator.state.seen_keys)
            context.reflected_coverage = await asyncio.to_thread(
                compute_coverage_data,
                cards=context.all_cards,
                concept_map=context.concept_map,
                total_pages=len(context.pages),
            )
            await emitter.emit_event(
                ServiceEvent(
                    "step_end",
                    "Reflection Phase Complete",
                    {
                        "success": True,
                        "duration_ms": int(
                            (time.perf_counter() - reflection_started_at) * 1000
                        ),
                        "coverage_data": context.reflected_coverage,
                    },
                )
            )

        context.final_coverage = await asyncio.to_thread(
            compute_coverage_data,
            cards=context.all_cards,
            concept_map=context.concept_map,
            total_pages=len(context.pages),
        )


class ExportPhase(PipelinePhase):
    async def execute(
        self,
        context: SessionContext,
        emitter: PipelineEmitter,
        ai_client: AIProvider,
    ) -> None:
        del ai_client
        history_mgr = HistoryManager()
        all_cards = context.all_cards
        pages = context.pages
        slide_set_name = context.slide_set_name
        final_coverage = context.final_coverage
        history_id = context.config.entry_id
        run_started_at = context.run_started_at or time.perf_counter()

        if not all_cards:
            await emitter.emit_event(
                ServiceEvent("warning", "No cards were generated.")
            )
            await asyncio.to_thread(
                history_mgr.update_entry, history_id, status="error"
            )
            await emitter.emit_event(
                ServiceEvent(
                    "error",
                    "Generation completed without any usable cards.",
                    {
                        "terminal": True,
                        "stage": "generation",
                        "elapsed_ms": self._elapsed_ms(run_started_at),
                    },
                )
            )
            return

        if context.config.skip_export:
            await emitter.emit_event(
                ServiceEvent("info", "Skipping Anki export (Draft Mode)")
            )
            await asyncio.to_thread(
                history_mgr.sync_session_state,
                session_id=context.config.session_id or history_id,
                cards=all_cards,
                status="completed",
                deck_name=context.config.deck_name,
                slide_set_name=slide_set_name,
                model_name=context.config.model_name,
                tags=context.config.tags,
                total_pages=len(pages),
                coverage_data=final_coverage,
            )
            await emitter.emit_event(
                ServiceEvent(
                    "done",
                    "Draft Generation Complete",
                    {
                        "created": 0,
                        "failed": 0,
                        "total": len(all_cards),
                        "elapsed": time.perf_counter() - run_started_at,
                        "elapsed_ms": self._elapsed_ms(run_started_at),
                        "cards": all_cards,
                        "slide_set_name": slide_set_name,
                        "total_pages": len(pages),
                        "coverage_data": final_coverage,
                        "terminal": True,
                    },
                )
            )
            return

        if self._should_stop(context.config.stop_check):
            await asyncio.to_thread(
                history_mgr.update_entry, history_id, status="cancelled"
            )
            await emitter.emit_event(
                ServiceEvent(
                    "cancelled",
                    "Generation cancelled during export.",
                    {
                        "terminal": True,
                        "stage": "export",
                        "elapsed_ms": self._elapsed_ms(run_started_at),
                        "generated_cards": len(all_cards),
                    },
                )
            )
            return

        anki_export_info = await get_connection_info()
        if not (
            anki_export_info.get("connected")
            and anki_export_info.get("collection_available", False)
        ):
            reason = anki_export_info.get("error") or "AnkiConnect unavailable."
            await emitter.emit_event(
                ServiceEvent(
                    "error",
                    f"Export skipped: {reason}",
                    {
                        "recoverable": False,
                        "terminal": True,
                        "stage": "export",
                        "error_kind": anki_export_info.get("error_kind"),
                        "elapsed_ms": self._elapsed_ms(run_started_at),
                    },
                )
            )
            await asyncio.to_thread(
                history_mgr.update_entry, history_id, status="error"
            )
            return

        await emitter.emit_event(
            ServiceEvent(
                "step_start",
                f"Create {len(all_cards)} notes in Anki",
                {"phase": "exporting"},
            )
        )
        await emitter.emit_event(
            ServiceEvent(
                "progress_start",
                "Exporting",
                {"total": len(all_cards), "label": "Notes", "phase": "exporting"},
            )
        )
        export_started_at = time.perf_counter()

        created = 0
        failed = 0
        for card in all_cards:
            result = await export_card_to_anki(
                card=card,
                deck_name=context.config.deck_name,
                slide_set_name=slide_set_name,
                fallback_model=config.DEFAULT_BASIC_MODEL,
                additional_tags=context.config.tags,
            )
            if result.success:
                created += 1
                await emitter.emit_event(
                    ServiceEvent(
                        "note",
                        f"Created note {result.note_id}",
                        {"id": result.note_id},
                    )
                )
            else:
                failed += 1
                await emitter.emit_event(
                    ServiceEvent("warning", f"Failed to create note: {result.error}")
                )
            await emitter.emit_event(
                ServiceEvent("progress_update", "", {"current": created + failed})
            )

        await emitter.emit_event(
            ServiceEvent(
                "step_end",
                "Export Complete",
                {
                    "success": True,
                    "created": created,
                    "failed": failed,
                    "duration_ms": self._elapsed_ms(export_started_at),
                },
            )
        )

        await asyncio.to_thread(
            history_mgr.sync_session_state,
            session_id=context.config.session_id or history_id,
            cards=all_cards,
            status="completed",
            deck_name=context.config.deck_name,
            slide_set_name=slide_set_name,
            model_name=context.config.model_name,
            tags=context.config.tags,
            total_pages=len(pages),
            coverage_data=final_coverage,
        )

        elapsed = time.perf_counter() - run_started_at
        await emitter.emit_event(
            ServiceEvent(
                "done",
                "Job Complete",
                {
                    "created": created,
                    "failed": failed,
                    "total": len(all_cards),
                    "elapsed": elapsed,
                    "elapsed_ms": self._elapsed_ms(run_started_at),
                    "slide_set_name": slide_set_name,
                    "total_pages": len(pages),
                    "coverage_data": final_coverage,
                    "terminal": True,
                },
            )
        )

    @staticmethod
    def _should_stop(stop_check: Any) -> bool:
        return bool(stop_check and stop_check())

    @staticmethod
    def _elapsed_ms(started_at: float) -> int:
        return int((time.perf_counter() - started_at) * 1000)


def build_orchestration_phases() -> list[PipelinePhase]:
    """Construct the canonical pipeline phase sequence."""
    return [
        InitializationPhase(),
        ConceptMappingPhase(),
        GenerationPhase(),
        ExportPhase(),
    ]
