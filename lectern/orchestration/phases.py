from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from typing import Any

from lectern import config
from lectern.ai_client import DocumentUploadError, LecternAIClient, UploadedDocument
from lectern.anki_connector import get_connection_info, sample_examples_from_deck
from lectern.cost_estimator import extract_pdf_metadata
from lectern.coverage import compute_coverage_data
from lectern.events.pipeline_emitter import PipelineEmitter
from lectern.events.service_events import ServiceEvent
from lectern.orchestration.pipeline_context import PipelinePhase, SessionContext
from lectern.utils.error_handling import capture_exception
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
        ai_client: LecternAIClient,
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

        reason = anki_info.get("error") or "AnkiConnect collection is not available yet."
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
        ai_client: LecternAIClient,
    ) -> None:
        phase_started_at = time.perf_counter()
        await emitter.emit_event(
            ServiceEvent("step_start", "Extracting images and text", {"phase": "concept"})
        )

        examples = ""
        await emitter.emit_event(ServiceEvent("step_start", "Sample examples from deck"))
        examples_started_at = time.perf_counter()
        try:
            if not context.config.skip_export:
                deck_for_examples = context.config.context_deck or context.config.deck_name
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
                    "duration_ms": int((time.perf_counter() - session_started_at) * 1000),
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
                        "elapsed_ms": int((time.perf_counter() - phase_started_at) * 1000),
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
            raw_concept_map = await ai_client.concept_map_from_file(
                file_uri=context.uploaded_pdf["uri"],
                mime_type=context.uploaded_pdf.get("mime_type", "application/pdf"),
            )
            concept_map = raw_concept_map if isinstance(raw_concept_map, dict) else {}
            if not concept_map:
                try:
                    legacy_map = await ai_client.concept_map([])
                    if isinstance(legacy_map, dict):
                        concept_map = legacy_map
                except Exception:
                    pass

            advised_pages = int(concept_map.get("page_count") or 0)
            advised_chars = int(concept_map.get("estimated_text_chars") or 0)
            metadata_pages = actual_pages
            metadata_chars = actual_text_chars
            page_delta_limit = max(5, int(actual_pages * 0.25))
            if advised_pages > 0 and abs(advised_pages - actual_pages) <= page_delta_limit:
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
        await emitter.emit_event(ServiceEvent("info", f"Slide Set Name: '{slide_set_name}'"))
        ai_client.set_slide_set_context(
            deck_name=context.config.deck_name,
            slide_set_name=slide_set_name,
        )
