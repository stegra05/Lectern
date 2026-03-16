from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, replace as dataclass_replace
from typing import Any, Dict, Generator, List, Optional, Callable, Literal, Iterable

from lectern import config
from lectern.anki_connector import check_connection, sample_examples_from_deck
from lectern.ai_client import LecternAIClient

from lectern.cost_estimator import (
    derive_effective_target,
    estimate_card_cap,
    estimate_cost as estimate_cost_impl,
    estimate_cost_with_base as estimate_cost_with_base_impl,
    verify_image_token_cost as verify_image_token_cost_impl,
)
from lectern.coverage import compute_coverage_data
from lectern.orchestration.session_orchestrator import (
    SessionOrchestrator,
    GenerationConfig as OrchGenConfig,
    ReflectionConfig as OrchRefConfig,
)
from gui.backend.sse_emitter import SSEEmitter
from lectern.generation_loop import (
    collect_card_fronts as collect_card_fronts_impl,
    get_card_key as get_card_key_impl,
)
from lectern.utils.tags import infer_slide_set_name
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.error_handling import capture_exception
from pypdf import PdfReader
import tempfile

from lectern.utils.history import HistoryManager
from lectern.snapshot import SnapshotTracker


logger = logging.getLogger(__name__)


from lectern.events.service_events import EventType, ServiceEvent


@dataclass(frozen=True)
class GenerationConfig:
    pdf_path: str
    deck_name: str
    model_name: str
    tags: List[str]
    context_deck: str = ""
    skip_export: bool = False
    stop_check: Optional[Callable[[], bool]] = None
    focus_prompt: Optional[str] = None
    target_card_count: Optional[int] = None
    session_id: Optional[str] = None
    entry_id: Optional[str] = None


class LecternGenerationService:
    """
    Core business logic for Lectern.
    Orchestrates the PDF parsing, AI generation, Reflection, and Anki export.
    Yields ServiceEvent objects to allow UIs (CLI/GUI) to render progress.
    """

    def run(
        self,
        pdf_path: str,
        deck_name: str,
        model_name: str,
        tags: List[str],
        context_deck: str = "",
        skip_export: bool = False,
        stop_check: Optional[Callable[[], bool]] = None,
        focus_prompt: Optional[str] = None,
        target_card_count: Optional[int] = None,
        session_id: Optional[str] = None,
        entry_id: Optional[str] = None,
    ) -> Generator[ServiceEvent, None, None]:

        cfg = GenerationConfig(
            pdf_path=pdf_path,
            deck_name=deck_name,
            model_name=model_name,
            tags=tags,
            context_deck=context_deck,
            skip_export=skip_export,
            stop_check=stop_check,
            focus_prompt=focus_prompt,
            target_card_count=target_card_count,
            session_id=session_id,
            entry_id=entry_id,
        )

        start_time = time.perf_counter()
        return self._generate_stream(cfg, start_time, cfg.entry_id)

    def _generate_stream(
        self,
        cfg: GenerationConfig,
        start_time: float,
        history_id: str | None = None,
    ) -> Generator[ServiceEvent, None, None]:
        try:
            # Control plane state tracking
            tracker = SnapshotTracker(cfg.session_id)
            history_mgr = HistoryManager()

            def _yield_with_snapshot(event: ServiceEvent):
                """Process event through tracker and yield both if snapshot is ready."""
                # Track state
                snapshot = tracker.process_event(
                    event_type=event.type,
                    event_data=event.data,
                    event_message=event.message,
                )
                if snapshot:
                    yield ServiceEvent(
                        "control_snapshot",
                        "State snapshot update",
                        snapshot.to_dict(),
                    )
                yield event

            # 1. Initialization and Validation
            if not os.path.exists(cfg.pdf_path):
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "error",
                        f"PDF path not found: {cfg.pdf_path}",
                        {"recoverable": False},
                    )
                )
                return

            file_size = os.path.getsize(cfg.pdf_path)
            if file_size == 0:
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "error",
                        "The uploaded PDF is empty (0 bytes).",
                        {"recoverable": False},
                    )
                )
                return

            # Sanity check AnkiConnect
            if not cfg.skip_export:
                if not check_connection():
                    if config.DEBUG:
                        yield from _yield_with_snapshot(
                            ServiceEvent(
                                "warning",
                                f"AnkiConnect not found at {config.ANKI_CONNECT_URL}, but DEBUG is ON. Proceeding with skip_export=True.",
                            )
                        )
                        cfg = dataclass_replace(cfg, skip_export=True)
                    else:
                        yield from _yield_with_snapshot(
                            ServiceEvent(
                                "error",
                                f"Could not connect to AnkiConnect at {config.ANKI_CONNECT_URL}",
                                {"recoverable": False},
                            )
                        )
                        history_mgr.update_entry(history_id, status="error")
                        return
                else:
                    yield from _yield_with_snapshot(
                        ServiceEvent(
                            "step_end", "AnkiConnect Connected", {"success": True}
                        )
                    )

            # Emit start event
            yield from _yield_with_snapshot(
                ServiceEvent(
                    "step_start", "Extracting images and text", {"phase": "concept"}
                )
            )

            # 2. Sample style examples
            examples = ""
            yield from _yield_with_snapshot(
                ServiceEvent("step_start", "Sample examples from deck")
            )
            examples_started_at = time.perf_counter()
            try:
                deck_for_examples = cfg.context_deck or cfg.deck_name
                examples = sample_examples_from_deck(
                    deck_name=deck_for_examples, sample_size=5
                )
                if examples.strip():
                    yield from _yield_with_snapshot(
                        ServiceEvent("info", "Loaded style examples from Anki")
                    )
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_end",
                        "Examples Loaded",
                        {
                            "success": True,
                            "duration_ms": self._elapsed_ms(examples_started_at),
                        },
                    )
                )
            except Exception as e:
                user_msg, _ = capture_exception(e, "Sample examples")
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "error",
                        f"Failed to sample examples: {user_msg}",
                        {"recoverable": True},
                    )
                )
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_end",
                        "Examples Failed",
                        {
                            "success": False,
                            "duration_ms": self._elapsed_ms(examples_started_at),
                        },
                    )
                )

            # 3b. Native flow: PDF title resolved via concept map; fallback uses filename.
            pdf_filename = os.path.splitext(os.path.basename(cfg.pdf_path))[0]
            pdf_title = ""

            # 4. AI Session Init
            if self._should_stop(cfg.stop_check):
                history_mgr.update_entry(history_id, status="cancelled")
                yield from _yield_with_snapshot(
                    self._cancelled_event("ai_session_init", start_time)
                )
                return

            yield from _yield_with_snapshot(
                ServiceEvent("step_start", "Start AI session")
            )
            session_started_at = time.perf_counter()
            ai = LecternAIClient(
                model_name=cfg.model_name,
                focus_prompt=cfg.focus_prompt,
                slide_set_context=None,
            )
            yield from _yield_with_snapshot(
                ServiceEvent(
                    "step_end",
                    "Session Started",
                    {
                        "success": True,
                        "duration_ms": self._elapsed_ms(session_started_at),
                        "ai_log_path": getattr(ai, "log_path", ""),
                    },
                )
            )

            # 4b. Native PDF extraction & upload
            upload_path = cfg.pdf_path

            uploaded_pdf: Dict[str, str] = {}
            yield from _yield_with_snapshot(
                ServiceEvent("step_start", "Upload PDF to Gemini")
            )
            upload_started_at = time.perf_counter()
            try:
                uploaded_pdf = ai.upload_pdf(upload_path)
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_end",
                        "PDF Uploaded",
                        {
                            "success": True,
                            "duration_ms": self._elapsed_ms(upload_started_at),
                        },
                    )
                )
            except Exception as e:
                user_msg, _ = capture_exception(e, "PDF upload")
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_end",
                        "PDF Upload Failed",
                        {
                            "success": False,
                            "duration_ms": self._elapsed_ms(upload_started_at),
                        },
                    )
                )
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "error",
                        f"Native PDF upload failed: {user_msg}",
                        {
                            "recoverable": False,
                            "terminal": True,
                            "stage": "upload",
                            "elapsed_ms": self._elapsed_ms(start_time),
                        },
                    )
                )
                history_mgr.update_entry(history_id, status="error")
                return
            finally:
                pass

            # 5. Concept Map
            concept_map = {}
            if self._should_stop(cfg.stop_check):
                history_mgr.update_entry(history_id, status="cancelled")
                yield from _yield_with_snapshot(
                    self._cancelled_event("concept_map", start_time)
                )
                return

            # Estimate page count from file size for initial progress display
            estimated_pages = max(1, int(file_size / 80000))

            yield from _yield_with_snapshot(
                ServiceEvent(
                    "step_start", "Build global concept map", {"phase": "concept"}
                )
            )
            yield from _yield_with_snapshot(
                ServiceEvent(
                    "progress_start",
                    "Analyzing slides",
                    {"total": estimated_pages, "phase": "concept"},
                )
            )
            concept_started_at = time.perf_counter()

            # Emit initial progress to show activity
            yield from _yield_with_snapshot(
                ServiceEvent(
                    "progress_update",
                    "",
                    {"current": 0, "total": estimated_pages, "phase": "concept"},
                )
            )

            try:
                raw_concept_map = ai.concept_map_from_file(
                    file_uri=uploaded_pdf["uri"],
                    mime_type=uploaded_pdf.get("mime_type", "application/pdf"),
                )
                concept_map = (
                    raw_concept_map if isinstance(raw_concept_map, dict) else {}
                )
                if not concept_map:
                    try:
                        legacy_map = ai.concept_map([])
                        if isinstance(legacy_map, dict):
                            concept_map = legacy_map
                    except Exception as e:
                        logger.debug("Legacy concept map fallback failed: %s", e)
                metadata_pages = int(concept_map.get("page_count") or 0)
                metadata_chars = int(concept_map.get("estimated_text_chars") or 0)
                if metadata_pages <= 0:
                    metadata_pages = max(1, int(file_size / 80000))
                if metadata_chars <= 0:
                    metadata_chars = metadata_pages * 800
                pages = [{} for _ in range(metadata_pages)]
                total_text_chars = metadata_chars

                # Emit final progress to indicate concept phase completion
                yield from _yield_with_snapshot(
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

                initial_coverage = compute_coverage_data(
                    cards=[],
                    concept_map=concept_map,
                    total_pages=metadata_pages,
                )
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_end",
                        "Concept Map Built",
                        {
                            "success": True,
                            "page_count": metadata_pages,
                            "coverage_data": initial_coverage,
                            "duration_ms": self._elapsed_ms(concept_started_at),
                            "concept_count": len(concept_map.get("concepts") or []),
                            "relation_count": len(concept_map.get("relations") or []),
                        },
                    )
                )
                yield from _yield_with_snapshot(
                    ServiceEvent("info", "Concept Map built", {"map": concept_map})
                )
                for w in ai.drain_warnings():
                    yield from _yield_with_snapshot(ServiceEvent("warning", w))
            except Exception as e:
                user_msg, _ = capture_exception(e, "Concept map")
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "error",
                        f"Concept map failed: {user_msg}",
                        {
                            "recoverable": True,
                            "stage": "concept_map",
                        },
                    )
                )
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_end",
                        "Concept Map Failed",
                        {
                            "success": False,
                            "duration_ms": self._elapsed_ms(concept_started_at),
                        },
                    )
                )
                metadata_pages = max(1, int(file_size / 80000))
                pages = [{} for _ in range(metadata_pages)]
                total_text_chars = metadata_pages * 800

            # 5b. Extract Slide Set Name from Concept Map (or fallback to heuristic)
            slide_set_name = (
                concept_map.get("slide_set_name", "") if concept_map else ""
            )
            if not slide_set_name:
                slide_set_name = infer_slide_set_name(pdf_title, pdf_filename)
            if not slide_set_name:
                slide_set_name = (
                    pdf_filename.replace("_", " ").replace("-", " ").title()
                )
            yield from _yield_with_snapshot(
                ServiceEvent("info", f"Slide Set Name: '{slide_set_name}'")
            )

            # Build slide set context for AI
            slide_set_context = {
                "deck_name": cfg.deck_name,
                "slide_set_name": slide_set_name,
            }
            ai.set_slide_set_context(
                deck_name=slide_set_context["deck_name"],
                slide_set_name=slide_set_context["slide_set_name"],
            )

            # 6. Generation Loop
            all_cards = []
            seen_keys = set()

            # Targets
            document_type = concept_map.get("document_type") if concept_map else None
            effective_target, _ = derive_effective_target(
                page_count=len(pages),
                estimated_text_chars=total_text_chars,
                target_card_count=cfg.target_card_count,
                density_target=None,
                script_base_chars=config.SCRIPT_BASE_CHARS,
                force_mode=document_type,
            )

            # Calculate chars per page for mode detection
            chars_per_page = total_text_chars / len(pages) if len(pages) > 0 else 0
            total_cards_cap, is_script_mode = estimate_card_cap(
                page_count=len(pages),
                estimated_text_chars=total_text_chars,
                image_count=0,
                density_target=None,
                target_card_count=cfg.target_card_count,
                script_base_chars=config.SCRIPT_BASE_CHARS,
                force_mode=document_type,
            )

            if is_script_mode:
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "info",
                        f"Script mode: ~{total_cards_cap} cards target ({chars_per_page:.0f} chars/page)",
                    )
                )
            else:
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "info",
                        f"Slides mode: ~{total_cards_cap} cards target ({len(pages)} pages × {effective_target:.1f})",
                    )
                )

            # Batch sizing
            # Clamp batch size: at least 20, at most 50, targeting half the page count.
            batch_size = max(
                config.MIN_NOTES_PER_BATCH,
                min(config.MAX_NOTES_PER_BATCH, len(pages) // 2),
            )
            actual_batch_size = int(batch_size)

            yield from _yield_with_snapshot(
                ServiceEvent(
                    "progress_start",
                    "Generating Cards",
                    {"total": total_cards_cap, "label": "Generation"},
                )
            )

            yield from _yield_with_snapshot(
                ServiceEvent("step_start", "Generate cards", {"phase": "generating"})
            )
            generation_started_at = time.perf_counter()

            # Orchestrate generation
            orchestrator = SessionOrchestrator()
            orchestrator.state.pages = pages
            orchestrator.state.concept_map = concept_map

            # Configure the generation loop
            gen_config = OrchGenConfig(
                total_cards_cap=total_cards_cap,
                actual_batch_size=actual_batch_size,
                focus_prompt=cfg.focus_prompt,
                effective_target=effective_target,
                stop_check=cfg.stop_check,
                examples=examples,
            )

            # Generation loop
            for event in orchestrator.run_generation(ai_client=ai, config=gen_config):
                yield from _yield_with_snapshot(
                    SSEEmitter.domain_to_service_event(event)
                )

            all_cards = orchestrator.state.all_cards

            yield from _yield_with_snapshot(
                ServiceEvent(
                    "step_end",
                    "Generation Phase Complete",
                    {
                        "success": True,
                        "count": len(all_cards),
                        "duration_ms": self._elapsed_ms(generation_started_at),
                    },
                )
            )

            # 7. Reflection Phase
            card_count = len(all_cards)
            rounds = dynamic_rounds = 0
            if card_count > 0:
                rounds = dynamic_rounds = 1 if card_count < 50 else 2

            if rounds > 0 and not self._should_stop(cfg.stop_check):
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_start",
                        "Reflection and improvement",
                        {"phase": "reflecting"},
                    )
                )
                reflection_started_at = time.perf_counter()
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "progress_start",
                        "Reflection",
                        {"total": rounds, "label": "Reflection Rounds"},
                    )
                )

                ref_config = OrchRefConfig(
                    total_cards_cap=total_cards_cap,
                    rounds=rounds,
                    stop_check=cfg.stop_check,
                )
                for event in orchestrator.run_reflection(
                    ai_client=ai, config=ref_config
                ):
                    yield from _yield_with_snapshot(
                        SSEEmitter.domain_to_service_event(event)
                    )

                all_cards = orchestrator.state.all_cards

                reflected_coverage = compute_coverage_data(
                    cards=all_cards,
                    concept_map=concept_map,
                    total_pages=len(pages),
                )
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "step_end",
                        "Reflection Phase Complete",
                        {
                            "success": True,
                            "duration_ms": self._elapsed_ms(reflection_started_at),
                            "coverage_data": reflected_coverage,
                        },
                    )
                )

            if not all_cards:
                yield from _yield_with_snapshot(
                    ServiceEvent("warning", "No cards were generated.")
                )
                history_mgr.update_entry(history_id, status="error")
                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "error",
                        "Generation completed without any usable cards.",
                        {
                            "terminal": True,
                            "stage": "generation",
                            "elapsed_ms": self._elapsed_ms(start_time),
                        },
                    )
                )
                return

            final_coverage = compute_coverage_data(
                cards=all_cards,
                concept_map=concept_map,
                total_pages=len(pages),
            )

            # 8. Creation in Anki
            if cfg.skip_export:
                # Draft Mode: Save state but don't export
                yield from _yield_with_snapshot(
                    ServiceEvent("info", "Skipping Anki export (Draft Mode)")
                )

                # IMPORTANT: Persist cards to DB so they survive app restart/refresh
                history_mgr.sync_session_state(
                    session_id=cfg.session_id or history_id,
                    cards=all_cards,
                    status="completed",
                    deck_name=cfg.deck_name,
                    slide_set_name=slide_set_name,
                    model_name=cfg.model_name,
                    tags=cfg.tags,
                    total_pages=len(pages),
                    coverage_data=final_coverage,
                )

                yield from _yield_with_snapshot(
                    ServiceEvent(
                        "done",
                        "Draft Generation Complete",
                        {
                            "created": 0,
                            "failed": 0,
                            "total": len(all_cards),
                            "elapsed": time.perf_counter() - start_time,
                            "elapsed_ms": self._elapsed_ms(start_time),
                            "cards": all_cards,  # Return cards for draft store
                            "slide_set_name": slide_set_name,  # NOTE(Tags): Include for GUI draft sync
                            "total_pages": len(pages),
                            "coverage_data": final_coverage,
                            "terminal": True,
                        },
                    )
                )
                return

            if self._should_stop(cfg.stop_check):
                history_mgr.update_entry(history_id, status="cancelled")
                yield from _yield_with_snapshot(
                    self._cancelled_event(
                        "export", start_time, {"generated_cards": len(all_cards)}
                    )
                )
                return

            yield from _yield_with_snapshot(
                ServiceEvent(
                    "step_start",
                    f"Create {len(all_cards)} notes in Anki",
                    {"phase": "exporting"},
                )
            )
            yield from _yield_with_snapshot(
                ServiceEvent(
                    "progress_start",
                    "Exporting",
                    {"total": len(all_cards), "label": "Notes", "phase": "exporting"},
                )
            )
            export_started_at = time.perf_counter()

            created = 0
            failed = 0

            for idx, card in enumerate(all_cards, start=1):
                result = export_card_to_anki(
                    card=card,
                    deck_name=cfg.deck_name,
                    slide_set_name=slide_set_name,
                    fallback_model=config.DEFAULT_BASIC_MODEL,  # NOTE: Anki note type, not Gemini model
                    additional_tags=cfg.tags,
                )

                if result.success:
                    created += 1
                    yield from _yield_with_snapshot(
                        ServiceEvent(
                            "note",
                            f"Created note {result.note_id}",
                            {"id": result.note_id},
                        )
                    )
                else:
                    failed += 1
                    yield from _yield_with_snapshot(
                        ServiceEvent(
                            "warning", f"Failed to create note: {result.error}"
                        )
                    )

                yield from _yield_with_snapshot(
                    ServiceEvent("progress_update", "", {"current": created + failed})
                )

            yield from _yield_with_snapshot(
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

            # Persist final state (including any note IDs created)
            history_mgr.sync_session_state(
                session_id=cfg.session_id or history_id,
                cards=all_cards,
                status="completed",
                deck_name=cfg.deck_name,
                slide_set_name=slide_set_name,
                model_name=cfg.model_name,
                tags=cfg.tags,
                total_pages=len(pages),
                coverage_data=final_coverage,
            )

            elapsed = time.perf_counter() - start_time
            yield from _yield_with_snapshot(
                ServiceEvent(
                    "done",
                    "Job Complete",
                    {
                        "created": created,
                        "failed": failed,
                        "total": len(all_cards),
                        "elapsed": elapsed,
                        "elapsed_ms": self._elapsed_ms(start_time),
                        "slide_set_name": slide_set_name,  # NOTE(Tags): Include for GUI draft sync
                        "total_pages": len(pages),
                        "coverage_data": final_coverage,
                        "terminal": True,
                    },
                )
            )

        except Exception as e:
            user_msg, _ = capture_exception(e, "Generation run")
            # Fallback history update if history_mgr exists
            try:
                HistoryManager().update_entry(history_id, status="error")
            except:
                pass

            yield from _yield_with_snapshot(
                ServiceEvent(
                    "error",
                    f"Critical error: {user_msg}",
                    {
                        "recoverable": False,
                        "terminal": True,
                        "stage": "run",
                        "elapsed_ms": self._elapsed_ms(start_time),
                    },
                )
            )
            # Do not raise; let the generator exit gracefully so the frontend sees the error event
            return

    async def estimate_cost(
        self,
        pdf_path: str,
        model_name: str | None = None,
        target_card_count: int | None = None,
    ) -> Dict[str, Any]:
        """Estimate the token count and cost for processing a PDF.

        Skips OCR and image extraction for speed during estimation.
        """
        return await estimate_cost_impl(
            pdf_path=pdf_path,
            model_name=model_name,
            target_card_count=target_card_count,
        )

    async def estimate_cost_with_base(
        self,
        pdf_path: str,
        model_name: str | None = None,
        target_card_count: int | None = None,
    ) -> tuple[Dict[str, Any], Dict[str, Any]]:
        """Full estimate + base data for cache. Returns (response, base_data)."""
        return await estimate_cost_with_base_impl(
            pdf_path=pdf_path,
            model_name=model_name,
            target_card_count=target_card_count,
        )

    async def verify_image_token_cost(
        self, model_name: str | None = None
    ) -> Dict[str, Any]:
        """Estimate per-image token cost via count_tokens delta."""
        return await verify_image_token_cost_impl(model_name=model_name)

    def _get_card_key(self, card: Dict[str, Any]) -> str:
        return get_card_key_impl(card)

    def _should_stop(self, stop_check: Optional[Callable[[], bool]]) -> bool:
        return bool(stop_check and stop_check())

    def _elapsed_ms(self, started_at: float) -> int:
        return int((time.perf_counter() - started_at) * 1000)

    def _cancelled_event(
        self,
        stage: str,
        started_at: float,
        extra_data: Optional[Dict[str, Any]] = None,
    ) -> ServiceEvent:
        payload: Dict[str, Any] = {
            "terminal": True,
            "stage": stage,
            "elapsed_ms": self._elapsed_ms(started_at),
        }
        if extra_data:
            payload.update(extra_data)
        return ServiceEvent(
            "cancelled", f"Generation cancelled during {stage}.", payload
        )

    def _collect_card_fronts(self, cards: List[Dict[str, Any]]) -> List[str]:
        return collect_card_fronts_impl(cards)
