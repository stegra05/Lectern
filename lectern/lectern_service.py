from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Generator, List, Optional, Callable, Literal, Iterable

from lectern import config
from lectern.anki_connector import check_connection, sample_examples_from_deck
from lectern.ai_client import LecternAIClient
from lectern.checkpoint import save_checkpoint
from lectern.cost_estimator import (
    derive_effective_target,
    estimate_card_cap,
    estimate_cost as estimate_cost_impl,
    estimate_cost_with_base as estimate_cost_with_base_impl,
    verify_image_token_cost as verify_image_token_cost_impl,
)
from lectern.generation_loop import (
    GenerationLoopConfig,
    GenerationLoopContext,
    GenerationLoopState,
    ReflectionLoopConfig,
    collect_card_fronts as collect_card_fronts_impl,
    get_card_key as get_card_key_impl,
    run_generation_loop as run_generation_loop_impl,
    run_reflection_loop as run_reflection_loop_impl,
    yield_new_cards as yield_new_cards_impl,
)
from lectern.utils.tags import infer_slide_set_name
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.state import save_state, clear_state
from lectern.utils.history import HistoryManager


logger = logging.getLogger(__name__)



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
]


@dataclass
class ServiceEvent:
    type: EventType
    message: str = ""
    data: Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(
            {
                "type": self.type,
                "message": self.message,
                "data": self.data,
                "timestamp": time.time(),
            }
        )

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
    source_type: str = "auto"  # "auto", "slides", "script"
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
        source_type: str = "auto",  # "auto", "slides", "script"
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
            source_type=source_type,
            target_card_count=target_card_count,
            session_id=session_id,
            entry_id=entry_id,
        )

        start_time = time.perf_counter()
        history_mgr = HistoryManager()
        history_id = None

        # 1. Validation & Setup
        if not os.path.exists(cfg.pdf_path):
            yield ServiceEvent("error", f"PDF not found: {cfg.pdf_path}")
            return
            
        file_size = os.path.getsize(cfg.pdf_path)
        if file_size == 0:
            yield ServiceEvent("error", f"PDF file is empty (0 bytes): {os.path.basename(cfg.pdf_path)}")
            return
            
        yield ServiceEvent("info", f"Processing file: {os.path.basename(cfg.pdf_path)} ({file_size} bytes)")

        # Initialize History Entry
        # If entry_id provided (e.g. from GUI), use it. otherwise create new.
        if cfg.entry_id:
            history_id = cfg.entry_id
        else:
            # NOTE: Always create a new entry for a new run.
            history_id = history_mgr.add_entry(
                cfg.pdf_path,
                cfg.deck_name,
                status="draft",
                session_id=cfg.session_id,
            )

        try:
            yield ServiceEvent("step_start", "Check AnkiConnect")
            if not check_connection():
                yield ServiceEvent("step_end", "AnkiConnect unreachable", {"success": False})
                yield ServiceEvent("error", f"Could not connect to AnkiConnect at {config.ANKI_CONNECT_URL}")
                history_mgr.update_entry(history_id, status="error")
                return
            yield ServiceEvent("step_end", "AnkiConnect Connected", {"success": True})

            # 2. PDF metadata placeholders (filled after native concept map call)
            pages = []
            total_text_chars = 0


            if self._should_stop(cfg.stop_check):
                return

            # 3. Sample Examples
            if self._should_stop(cfg.stop_check):
                return

            examples = ""
            yield ServiceEvent("step_start", "Sample examples from deck")
            try:
                deck_for_examples = (cfg.context_deck or cfg.deck_name)
                examples = sample_examples_from_deck(deck_name=deck_for_examples, sample_size=5)
                if examples.strip():
                    yield ServiceEvent("info", "Loaded style examples from Anki")
                yield ServiceEvent("step_end", "Examples Loaded", {"success": True})
            except Exception as e:
                 yield ServiceEvent("warning", f"Failed to sample examples: {e}")
                 yield ServiceEvent("step_end", "Examples Failed", {"success": False})

            # 3b. Native flow: PDF title resolved via concept map; fallback uses filename.
            pdf_filename = os.path.splitext(os.path.basename(cfg.pdf_path))[0]
            pdf_title = ""

            # 3c. Slide Set Name -- extracted from concept map response in step 5b below.

            # 4. AI Session Init
            if self._should_stop(cfg.stop_check):
                return

            yield ServiceEvent("step_start", "Start AI session")
            # NOTE: slide_set_context is set after concept map for the slide_set_name
            ai = LecternAIClient(
                model_name=cfg.model_name,
                focus_prompt=cfg.focus_prompt,
                slide_set_context=None,
            )
            yield ServiceEvent("step_end", "Session Started", {"success": True})

            # 4b. Native PDF upload
            uploaded_pdf: Dict[str, str] = {}
            yield ServiceEvent("step_start", "Upload PDF to Gemini")
            try:
                uploaded_pdf = ai.upload_pdf(cfg.pdf_path)
                yield ServiceEvent("step_end", "PDF Uploaded", {"success": True})
            except Exception as e:
                yield ServiceEvent("step_end", "PDF Upload Failed", {"success": False})
                yield ServiceEvent("error", f"Native PDF upload failed: {e}")
                history_mgr.update_entry(history_id, status="error")
                return
            
            # 5. Concept Map
            concept_map = {}
            if self._should_stop(cfg.stop_check):
                return

            yield ServiceEvent("step_start", "Build global concept map", {"phase": "concept"})
            try:
                raw_concept_map = ai.concept_map_from_file(
                    file_uri=uploaded_pdf["uri"],
                    mime_type=uploaded_pdf.get("mime_type", "application/pdf"),
                )
                concept_map = raw_concept_map if isinstance(raw_concept_map, dict) else {}
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
                yield ServiceEvent("step_end", "Concept Map Built", {"success": True})
                yield ServiceEvent("info", "Concept Map built", {"map": concept_map})
                for w in ai.drain_warnings():
                    yield ServiceEvent("warning", w)
            except Exception as e:
                yield ServiceEvent("warning", f"Concept map failed: {e}")
                yield ServiceEvent("step_end", "Concept Map Failed", {"success": False})
                metadata_pages = max(1, int(file_size / 80000))
                pages = [{} for _ in range(metadata_pages)]
                total_text_chars = metadata_pages * 800

            # 5b. Extract Slide Set Name from Concept Map (or fallback to heuristic)
            slide_set_name = concept_map.get('slide_set_name', '') if concept_map else ''
            if not slide_set_name:
                slide_set_name = infer_slide_set_name(pdf_title, pdf_filename)
            if not slide_set_name:
                slide_set_name = pdf_filename.replace('_', ' ').replace('-', ' ').title()
            yield ServiceEvent("info", f"Slide Set Name: '{slide_set_name}'")

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
            effective_target, _ = derive_effective_target(
                page_count=len(pages),
                estimated_text_chars=total_text_chars,
                source_type=cfg.source_type,
                target_card_count=cfg.target_card_count,
                density_target=None,
                script_base_chars=config.SCRIPT_BASE_CHARS,
            )

            # Calculate chars per page for mode detection
            chars_per_page = total_text_chars / len(pages) if len(pages) > 0 else 0
            total_cards_cap, is_script_mode = estimate_card_cap(
                page_count=len(pages),
                estimated_text_chars=total_text_chars,
                image_count=0,
                source_type=cfg.source_type,
                density_target=None,
                target_card_count=cfg.target_card_count,
                script_base_chars=config.SCRIPT_BASE_CHARS,
            )

            if is_script_mode:
                yield ServiceEvent(
                    "info",
                    f"Script mode: ~{total_cards_cap} cards target ({chars_per_page:.0f} chars/page)",
                )
            else:
                yield ServiceEvent(
                    "info",
                    f"Slides mode: ~{total_cards_cap} cards target ({len(pages)} pages × {effective_target:.1f})",
                )

            # Batch sizing
            # Clamp batch size: at least 20, at most 50, targeting half the page count.
            batch_size = max(config.MIN_NOTES_PER_BATCH, min(config.MAX_NOTES_PER_BATCH, len(pages) // 2))
            actual_batch_size = int(batch_size)

            yield ServiceEvent("progress_start", "Generating Cards", {"total": total_cards_cap, "label": "Generation"})

            yield ServiceEvent("step_start", "Generate cards", {"phase": "generating"})
            
            loop_context = GenerationLoopContext(
                ai=ai,
                examples=examples,
                concept_map=concept_map,
                slide_set_name=slide_set_name,
                model_name=cfg.model_name,
                tags=cfg.tags,
                pdf_path=cfg.pdf_path,
                deck_name=cfg.deck_name,
                history_id=history_id,
                session_id=cfg.session_id,
            )
            loop_state = GenerationLoopState(
                all_cards=all_cards,
                seen_keys=seen_keys,
                pages=pages,
            )
            loop_config = GenerationLoopConfig(
                total_cards_cap=total_cards_cap,
                actual_batch_size=actual_batch_size,
                focus_prompt=cfg.focus_prompt,
                effective_target=effective_target,
                stop_check=cfg.stop_check,
            )

            # Generation loop
            yield from self._run_generation_loop(
                context=loop_context,
                state=loop_state,
                config=loop_config,
            )
            
            yield ServiceEvent("step_end", "Generation Phase Complete", {"success": True, "count": len(all_cards)})

            # 7. Reflection Phase
            card_count = len(all_cards)
            if card_count < 25:
                dynamic_rounds = 0
            elif card_count < 50:
                dynamic_rounds = 1
            else:
                dynamic_rounds = 2
            rounds = dynamic_rounds

            if rounds > 0:
                yield ServiceEvent("step_start", "Reflection and improvement", {"phase": "reflecting"})
                
                yield ServiceEvent("progress_start", "Reflection", {"total": rounds, "label": "Reflection Rounds"})
                
                reflection_config = ReflectionLoopConfig(
                    total_cards_cap=total_cards_cap,
                    actual_batch_size=actual_batch_size,
                    rounds=rounds,
                    stop_check=cfg.stop_check,
                )
                yield from self._run_reflection_loop(
                    context=loop_context,
                    state=loop_state,
                    config=reflection_config,
                )

                yield ServiceEvent("step_end", "Reflection Phase Complete", {"success": True})

            if not all_cards:
                yield ServiceEvent("warning", "No cards were generated.")
                history_mgr.update_entry(history_id, status="error")
                return

            # 8. Creation in Anki
            if cfg.skip_export:
                 # Draft Mode: Save state but don't export
                 yield ServiceEvent("info", "Skipping Anki export (Draft Mode)")
                 history_mgr.update_entry(history_id, card_count=len(all_cards))
                 yield ServiceEvent("done", "Draft Generation Complete", {
                    "created": 0, 
                    "failed": 0, 
                    "total": len(all_cards),
                    "elapsed": time.perf_counter() - start_time,
                    "cards": all_cards,  # Return cards for draft store
                    "slide_set_name": slide_set_name,  # NOTE(Tags): Include for GUI draft sync
                })
                 return

            if self._should_stop(cfg.stop_check):
                return

            yield ServiceEvent("step_start", f"Create {len(all_cards)} notes in Anki")
            yield ServiceEvent("progress_start", "Exporting", {"total": len(all_cards), "label": "Notes"})
            
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
                    yield ServiceEvent("note", f"Created note {result.note_id}", {"id": result.note_id})
                else:
                    failed += 1
                    yield ServiceEvent("warning", f"Failed to create note: {result.error}")
                
                yield ServiceEvent("progress_update", "", {"current": created + failed})

            yield ServiceEvent("step_end", "Export Complete", {"success": True, "created": created, "failed": failed})
            
            # Clear state on success
            clear_state(session_id=cfg.session_id)
            history_mgr.update_entry(history_id, status="completed", card_count=len(all_cards))
            
            elapsed = time.perf_counter() - start_time
            yield ServiceEvent("done", "Job Complete", {
                "created": created, 
                "failed": failed, 
                "total": len(all_cards),
                "elapsed": elapsed,
                "slide_set_name": slide_set_name,  # NOTE(Tags): Include for GUI draft sync
            })

        except Exception as e:
            if history_id:
                history_mgr.update_entry(history_id, status="error")
            yield ServiceEvent("error", f"Critical error: {e}")
            # Do not raise; let the generator exit gracefully so the frontend sees the error event
            return

    async def estimate_cost(
        self,
        pdf_path: str,
        model_name: str | None = None,
        source_type: str = "auto",
        target_card_count: int | None = None,
    ) -> Dict[str, Any]:
        """Estimate the token count and cost for processing a PDF.
        
        Skips OCR and image extraction for speed during estimation.
        """
        return await estimate_cost_impl(
            pdf_path=pdf_path,
            model_name=model_name,
            source_type=source_type,
            target_card_count=target_card_count,
        )

    async def estimate_cost_with_base(
        self,
        pdf_path: str,
        model_name: str | None = None,
        source_type: str = "auto",
        target_card_count: int | None = None,
    ) -> tuple[Dict[str, Any], Dict[str, Any]]:
        """Full estimate + base data for cache. Returns (response, base_data)."""
        return await estimate_cost_with_base_impl(
            pdf_path=pdf_path,
            model_name=model_name,
            source_type=source_type,
            target_card_count=target_card_count,
        )

    async def verify_image_token_cost(self, model_name: str | None = None) -> Dict[str, Any]:
        """Estimate per-image token cost via count_tokens delta."""
        return await verify_image_token_cost_impl(model_name=model_name)

    def _get_card_key(self, card: Dict[str, Any]) -> str:
        return get_card_key_impl(card)

    def _should_stop(self, stop_check: Optional[Callable[[], bool]]) -> bool:
        return bool(stop_check and stop_check())

    def _save_checkpoint(
        self,
        *,
        pdf_path: str,
        deck_name: str,
        cards: List[Dict[str, Any]],
        concept_map: Dict[str, Any],
        ai: LecternAIClient,
        session_id: Optional[str],
        slide_set_name: str,
        model_name: str,
        tags: List[str],
        history_id: Optional[str],
    ) -> None:
        save_checkpoint(
            pdf_path=pdf_path,
            deck_name=deck_name,
            cards=cards,
            concept_map=concept_map,
            ai=ai,
            session_id=session_id,
            slide_set_name=slide_set_name,
            model_name=model_name,
            tags=tags,
            history_id=history_id,
        )

    def _yield_new_cards(
        self,
        *,
        new_cards: Iterable[Dict[str, Any]],
        all_cards: List[Dict[str, Any]],
        seen_keys: set,
        message: str,
    ) -> Generator[ServiceEvent, None, int]:
        return (yield from yield_new_cards_impl(
            new_cards=new_cards,
            all_cards=all_cards,
            seen_keys=seen_keys,
            message=message,
            event_factory=ServiceEvent,
        ))

    def _collect_card_fronts(self, cards: List[Dict[str, Any]]) -> List[str]:
        return collect_card_fronts_impl(cards)

    def _run_generation_loop(
        self,
        *,
        context: GenerationLoopContext,
        state: GenerationLoopState,
        config: GenerationLoopConfig,
    ) -> Generator[ServiceEvent, None, None]:
        return (yield from run_generation_loop_impl(
            context=context,
            state=state,
            config=config,
            event_factory=ServiceEvent,
            should_stop=self._should_stop,
            checkpoint_fn=self._save_checkpoint,
        ))

    def _run_reflection_loop(
        self,
        *,
        context: GenerationLoopContext,
        state: GenerationLoopState,
        config: ReflectionLoopConfig,
    ) -> Generator[ServiceEvent, None, None]:
        return (yield from run_reflection_loop_impl(
            context=context,
            state=state,
            config=config,
            event_factory=ServiceEvent,
            should_stop=self._should_stop,
            checkpoint_fn=self._save_checkpoint,
        ))
