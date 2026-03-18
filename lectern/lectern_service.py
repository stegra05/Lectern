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
)

from lectern.ai_client import LecternAIClient

from lectern.cost_estimator import (
    estimate_cost as estimate_cost_impl,
    estimate_cost_with_base as estimate_cost_with_base_impl,
    verify_image_token_cost as verify_image_token_cost_impl,
)
from lectern.utils.error_handling import capture_exception

from lectern.utils.history import HistoryManager
from lectern.events.pipeline_emitter import PipelineEmitter
from lectern.orchestration.pipeline_context import SessionContext
from lectern.orchestration.phases import (
    ConceptMappingPhase,
    ExportPhase,
    GenerationPhase,
    InitializationPhase,
    PhaseExecutionHalt,
)


logger = logging.getLogger(__name__)


from lectern.events.service_events import ServiceEvent


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
            context.run_started_at = start_time
            ai = LecternAIClient(
                model_name=context.config.model_name,
                focus_prompt=context.config.focus_prompt,
                slide_set_context=None,
            )

            phases = [
                InitializationPhase(),
                ConceptMappingPhase(),
                GenerationPhase(),
                ExportPhase(),
            ]
            for index, phase in enumerate(phases):
                try:
                    await phase.execute(context, emitter, ai)
                except PhaseExecutionHalt as e:
                    if history_id:
                        await asyncio.to_thread(
                            history_mgr.update_entry, history_id, status=e.history_status
                        )
                    return

                if index == 0 and self._should_stop(context.config.stop_check):
                    await asyncio.to_thread(
                        history_mgr.update_entry, history_id, status="cancelled"
                    )
                    await emitter.emit_event(
                        self._cancelled_event("ai_session_init", start_time)
                    )
                    return

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
