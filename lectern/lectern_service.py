from __future__ import annotations

import logging
import time
import uuid
import asyncio
from dataclasses import dataclass
from typing import (
    Any,
    Dict,
    AsyncGenerator,
    List,
    Optional,
    Callable,
    Literal,
    Iterable,
)

from lectern import config
from lectern.anki_connector import get_connection_info
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
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.error_handling import capture_exception

from lectern.utils.history import HistoryManager
from lectern.events.pipeline_emitter import PipelineEmitter
from lectern.orchestration.pipeline_context import SessionContext
from lectern.orchestration.phases import (
    ConceptMappingPhase,
    InitializationPhase,
    PhaseExecutionHalt,
)


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
    async def run(
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
    ) -> AsyncGenerator[ServiceEvent, None]:

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
            session_id=session_id or uuid.uuid4().hex,
            entry_id=entry_id,
        )

        start_time = time.perf_counter()
        emitter = PipelineEmitter(cfg.session_id)
        
        async def _run_task():
            try:
                await self._execute_pipeline(cfg, start_time, cfg.entry_id, emitter)
            except asyncio.CancelledError:
                logger.info(f"Pipeline task for session {cfg.session_id} was cancelled.")
                # We need to notify the emitter so it can push a final cancellation event if possible
                if not emitter.is_closed():
                    await emitter.cancelled("Generation cancelled by user or system.")
                # Re-raise to ensure the task is properly cancelled
                raise
            except Exception as e:
                # Catch any unexpected errors that bypass the pipeline's own try-except
                logger.error(f"Pipeline crashed: {e}", exc_info=True)
                if not emitter.is_closed():
                    await emitter.emit("error", f"Pipeline crashed: {str(e)}", {"terminal": True, "recoverable": False})
            finally:
                await emitter.close()
                
        # Start the execution in the background
        task = asyncio.create_task(_run_task())
        
        try:
            # Yield from the emitter's queue
            async for event in emitter.stream():
                yield event
        finally:
            # CRITICAL: If the generator is closed (e.g. client disconnect), 
            # we MUST cancel the background task to stop AI generation immediately.
            if not task.done():
                task.cancel()
                try:
                    # Give it a slightly longer window for DB writes/cleanup during cancellation
                    await asyncio.wait_for(task, timeout=2.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
                except Exception as e:
                    logger.error(f"Error during task cancellation cleanup: {e}")
            
            # Ensure emitter is closed to release any resources
            await emitter.close()

    async def _execute_pipeline(
        self,
        cfg: GenerationConfig,
        start_time: float,
        history_id: str | None,
        emitter: PipelineEmitter,
    ) -> None:
        try:
            history_mgr = HistoryManager()
            context = SessionContext.from_generation_config(cfg)
            ai = LecternAIClient(
                model_name=context.config.model_name,
                focus_prompt=context.config.focus_prompt,
                slide_set_context=None,
            )

            try:
                await InitializationPhase().execute(context, emitter, ai)
            except PhaseExecutionHalt as e:
                if history_id:
                    await asyncio.to_thread(
                        history_mgr.update_entry, history_id, status=e.history_status
                    )
                return

            if self._should_stop(context.config.stop_check):
                await asyncio.to_thread(
                    history_mgr.update_entry, history_id, status="cancelled"
                )
                await emitter.emit_event(
                    self._cancelled_event("ai_session_init", start_time)
                )
                return

            try:
                await ConceptMappingPhase().execute(context, emitter, ai)
            except PhaseExecutionHalt as e:
                if history_id:
                    await asyncio.to_thread(
                        history_mgr.update_entry, history_id, status=e.history_status
                    )
                return

            # Extract variables for downstream phases (NOTE: context is single source of truth)
            actual_image_count = context.pdf.image_count
            pages = context.pages
            concept_map = context.concept_map
            examples = context.examples
            slide_set_name = context.slide_set_name
            total_text_chars = context.pdf.metadata_chars

            # 6. Generation Loop
            all_cards = []

            # Targets
            document_type = concept_map.get("document_type") if concept_map else None
            effective_target, _ = derive_effective_target(
                page_count=len(pages),
                estimated_text_chars=total_text_chars,
                target_card_count=context.config.target_card_count,
                density_target=None,
                script_base_chars=config.SCRIPT_BASE_CHARS,
                force_mode=document_type,
            )

            # Calculate chars per page for mode detection
            chars_per_page = total_text_chars / len(pages) if len(pages) > 0 else 0
            total_cards_cap, is_script_mode = estimate_card_cap(
                page_count=len(pages),
                estimated_text_chars=total_text_chars,
                image_count=actual_image_count,
                density_target=None,
                target_card_count=context.config.target_card_count,
                script_base_chars=config.SCRIPT_BASE_CHARS,
                force_mode=document_type,
            )

            if is_script_mode:
                await emitter.emit_event(
                    ServiceEvent(
                        "info",
                        f"Script mode: ~{total_cards_cap} cards target ({chars_per_page:.0f} chars/page)",
                    )
                )
            else:
                await emitter.emit_event(
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

            await emitter.emit_event(
                ServiceEvent(
                    "progress_start",
                    "Generating Cards",
                    {"total": total_cards_cap, "label": "Generation"},
                )
            )

            await emitter.emit_event(
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
                focus_prompt=context.config.focus_prompt,
                effective_target=effective_target,
                stop_check=context.config.stop_check,
                examples=examples,
            )

            # Generation loop
            async for event in orchestrator.run_generation(
                ai_client=ai, config=gen_config
            ):
                await emitter.emit_event(
                    SSEEmitter.domain_to_service_event(event)
                )

            all_cards = orchestrator.state.all_cards

            await emitter.emit_event(
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

            if rounds > 0 and not self._should_stop(context.config.stop_check):
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

                ref_config = OrchRefConfig(
                    total_cards_cap=total_cards_cap,
                    rounds=rounds,
                    stop_check=context.config.stop_check,
                )
                async for event in orchestrator.run_reflection(
                    ai_client=ai, config=ref_config
                ):
                    await emitter.emit_event(
                        SSEEmitter.domain_to_service_event(event)
                    )

                all_cards = orchestrator.state.all_cards

                reflected_coverage = await asyncio.to_thread(
                    compute_coverage_data,
                    cards=all_cards,
                    concept_map=concept_map,
                    total_pages=len(pages),
                )
                await emitter.emit_event(
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
                            "elapsed_ms": self._elapsed_ms(start_time),
                        },
                    )
                )
                return

            final_coverage = await asyncio.to_thread(
                compute_coverage_data,
                cards=all_cards,
                concept_map=concept_map,
                total_pages=len(pages),
            )

            # 8. Creation in Anki
            if context.config.skip_export:
                # Draft Mode: Save state but don't export
                await emitter.emit_event(
                    ServiceEvent("info", "Skipping Anki export (Draft Mode)")
                )

                # IMPORTANT: Persist cards to DB so they survive app restart/refresh
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

            if self._should_stop(context.config.stop_check):
                await asyncio.to_thread(
                    history_mgr.update_entry, history_id, status="cancelled"
                )
                await emitter.emit_event(
                    self._cancelled_event(
                        "export", start_time, {"generated_cards": len(all_cards)}
                    )
                )
                return

            # Re-check Anki right before export to avoid per-note warning spam if
            # Anki became unavailable during generation.
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
                            "elapsed_ms": self._elapsed_ms(start_time),
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

            for idx, card in enumerate(all_cards, start=1):
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
                        ServiceEvent(
                            "warning", f"Failed to create note: {result.error}"
                        )
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

            # Persist final state (including any note IDs created)
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

            elapsed = time.perf_counter() - start_time
            await emitter.emit_event(
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

        except asyncio.CancelledError:
            # Sync cancelled status to DB before task exits
            try:
                if history_id:
                    await asyncio.to_thread(
                        HistoryManager().update_entry, history_id, status="cancelled"
                    )
            except:
                pass
            raise

        except Exception as e:
            user_msg, _ = capture_exception(e, "Generation run")
            # Fallback history update if history_mgr exists
            try:
                await asyncio.to_thread(
                    HistoryManager().update_entry, history_id, status="error"
                )
            except:
                pass

            await emitter.emit_event(
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
