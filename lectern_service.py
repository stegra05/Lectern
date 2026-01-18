from __future__ import annotations

import base64
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Generator, List, Optional, Callable

import config
from anki_connector import (
    check_connection, 
    sample_examples_from_deck,
    get_deck_slide_set_patterns,
)
from pdf_parser import extract_content_from_pdf, extract_pdf_title
from ai_client import LecternAIClient
from utils.tags import infer_slide_set_name, infer_slide_set_name_with_ai
from utils.note_export import export_card_to_anki
from utils.state import save_state, clear_state, load_state
from utils.history import HistoryManager

@dataclass
class ServiceEvent:
    type: str  # 'status', 'info', 'warning', 'error', 'step_start', 'step_end', 'progress_start', 'progress_update', 'card', 'note', 'done'
    message: str = ""
    data: Dict[str, Any] = field(default_factory=dict)

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
        resume: bool = False,
        # Options matching CLI args/config
        max_notes_per_batch: int = config.MAX_NOTES_PER_BATCH,
        enable_reflection: bool = config.ENABLE_REFLECTION,
        reflection_rounds: int = config.REFLECTION_MAX_ROUNDS,
        skip_export: bool = False,
        stop_check: Optional[Callable[[], bool]] = None,
        exam_mode: bool = False,  # NOTE(Exam-Mode): Pass through to AI client
    ) -> Generator[ServiceEvent, None, None]:
        
        start_time = time.perf_counter()
        history_mgr = HistoryManager()
        history_id = None

        # 1. Validation & Setup
        if not os.path.exists(pdf_path):
            yield ServiceEvent("error", f"PDF not found: {pdf_path}")
            return
            
        file_size = os.path.getsize(pdf_path)
        yield ServiceEvent("info", f"Processing file: {os.path.basename(pdf_path)} ({file_size} bytes)")

        # Initialize History Entry
        # NOTE: Always create a new entry - resume logic uses state file, not history
        history_id = history_mgr.add_entry(pdf_path, deck_name, status="draft")

        try:
            yield ServiceEvent("step_start", "Check AnkiConnect")
            if not check_connection():
                yield ServiceEvent("step_end", "AnkiConnect unreachable", {"success": False})
                yield ServiceEvent("error", f"Could not connect to AnkiConnect at {config.ANKI_CONNECT_URL}")
                history_mgr.update_entry(history_id, status="error")
                return
            yield ServiceEvent("step_end", "AnkiConnect Connected", {"success": True})

            # State Resume Check
            saved_state = None
            if resume:
                saved_state = load_state()
                if saved_state and saved_state.get("pdf_path") == os.path.abspath(pdf_path):
                     yield ServiceEvent("info", f"Resuming session for {os.path.basename(pdf_path)}")
                else:
                    saved_state = None # Invalid state or mismatch

            # 2. Parse PDF
            pages = []
            total_text_chars = 0
            avg_chars_per_page = 0.0


            if stop_check and stop_check():
                return

            yield ServiceEvent("step_start", "Parse PDF")
            try:
                pages = extract_content_from_pdf(pdf_path, stop_check=stop_check)
                if stop_check and stop_check():
                     yield ServiceEvent("warning", "PDF parsing stopped by user.")
                     return
                total_chars = 0
                non_empty_pages = 0
                image_pages = 0
                for page in pages:
                    page_text = page.text or ""
                    if page_text.strip():
                        non_empty_pages += 1
                        total_chars += len(page_text)
                    if page.images:
                        image_pages += 1
                total_text_chars = total_chars
                avg_chars_per_page = (total_chars / len(pages)) if pages else 0.0
                yield ServiceEvent("info", f"Parsed {len(pages)} pages")
                yield ServiceEvent("step_end", "PDF Parsed", {"success": True, "pages": len(pages)})
            except Exception as e:
                yield ServiceEvent("step_end", "PDF Parsing Failed", {"success": False})
                yield ServiceEvent("error", f"PDF parsing failed: {str(e)}")
                history_mgr.update_entry(history_id, status="error")
                return

            # 3. Sample Examples & Analyze Deck Patterns
            if stop_check and stop_check():
                return

            examples = ""
            pattern_info: Dict[str, Any] = {}
            yield ServiceEvent("step_start", "Sample examples & analyze deck patterns")
            try:
                deck_for_examples = (context_deck or deck_name)
                examples = sample_examples_from_deck(deck_name=deck_for_examples, sample_size=5)
                # NOTE(Tags): Analyze existing tags to detect naming patterns
                pattern_info = get_deck_slide_set_patterns(deck_name)
                if examples.strip():
                    yield ServiceEvent("info", "Loaded style examples from Anki")
                if pattern_info.get('slide_sets'):
                    yield ServiceEvent("info", f"Found {len(pattern_info['slide_sets'])} existing slide sets in deck")
                yield ServiceEvent("step_end", "Examples & Patterns Analyzed", {"success": True})
            except Exception as e:
                 yield ServiceEvent("warning", f"Failed to sample examples: {e}")
                 yield ServiceEvent("step_end", "Analysis Failed", {"success": False})

            # 3b. Extract PDF Title for Slide Set Naming
            pdf_title = ""
            pdf_filename = os.path.splitext(os.path.basename(pdf_path))[0]
            try:
                pdf_title = extract_pdf_title(pdf_path)
                if pdf_title:
                    yield ServiceEvent("info", f"Extracted PDF title: '{pdf_title}'")
            except Exception as e:
                yield ServiceEvent("warning", f"PDF title extraction failed: {e}")

            # 3c. Infer Slide Set Name using AI
            # NOTE(Naming): Use AI to infer a semantic name from context (filename, title, first slides)
            # This prevents generic names like "Week 1" when the content is about a specific topic.
            yield ServiceEvent("step_start", "Infer slide set name")
            first_slides_text = [p.text for p in pages[:3]] if pages else []
            slide_set_name = infer_slide_set_name_with_ai(
                pdf_filename=pdf_filename,
                pdf_title=pdf_title,
                first_slides_text=first_slides_text,
                pattern_info=pattern_info,
            )
            if slide_set_name:
                yield ServiceEvent("step_end", f"Slide Set Name: '{slide_set_name}'", {"success": True})
            else:
                # Fallback to filename if all inference failed
                slide_set_name = pdf_filename.replace('_', ' ').replace('-', ' ').title()
                yield ServiceEvent("step_end", f"Using filename as Slide Set Name: '{slide_set_name}'", {"success": False})

            # Build slide set context for AI
            slide_set_context = {
                'deck_name': deck_name,
                'slide_set_name': slide_set_name,
                'pattern_info': pattern_info,
                'pdf_title': pdf_title,
            }

            # 4. AI Session Init
            if stop_check and stop_check():
                return

            yield ServiceEvent("step_start", "Start AI session")
            ai = LecternAIClient(model_name=model_name, exam_mode=exam_mode, slide_set_context=slide_set_context)
            if saved_state:
                history = saved_state.get("history", [])
                if history:
                    ai.restore_history(history)
            yield ServiceEvent("step_end", "Session Started", {"success": True})
            
            # 5. Concept Map
            concept_map = {}
            if saved_state and saved_state.get("concept_map"):
                concept_map = saved_state["concept_map"]
                yield ServiceEvent("info", "Restored Concept Map from state", {"map": concept_map})
            else:
                if stop_check and stop_check():
                    return

                yield ServiceEvent("step_start", "Build global concept map")
                try:
                    concept_map = ai.concept_map([p.__dict__ for p in pages])
                    yield ServiceEvent("step_end", "Concept Map Built", {"success": True})
                    yield ServiceEvent("info", "Concept Map built", {"map": concept_map})
                except Exception as e:
                    yield ServiceEvent("warning", f"Concept map failed: {e}")
                    yield ServiceEvent("step_end", "Concept Map Failed", {"success": False})

            # 6. Generation Loop
            all_cards = []
            seen_keys = set()
            
            if saved_state:
                all_cards = saved_state.get("cards", [])
                for card in all_cards:
                    key = self._get_card_key(card)
                    if key:
                        seen_keys.add(key)
                yield ServiceEvent("info", f"Restored {len(all_cards)} cards from state")

            # Targets
            base_target = float(getattr(config, "CARDS_PER_SLIDE_TARGET", 1.5))
            effective_target = base_target
            target_reason = "config_default"
            if len(pages) >= 100 and effective_target < 2.0:
                effective_target = 2.0
                target_reason = "large_deck_boost_100"
            elif len(pages) >= 50 and effective_target < 1.8:
                effective_target = 1.8
                target_reason = "large_deck_boost_50"
            total_cards_cap = int(len(pages) * effective_target)
            hard_cap = int(getattr(config, "MAX_TOTAL_NOTES", 0))
            if hard_cap > 0:
                total_cards_cap = min(total_cards_cap, hard_cap)
            
            min_cards_required = int(len(pages) * getattr(config, "MIN_CARDS_PER_SLIDE", 0.8))
            
            # Dynamic batching logic
            dynamic_batch_size = min(50, max(20, len(pages) // 2))
            actual_batch_size = int(max_notes_per_batch or dynamic_batch_size)

            # Text-density-based cap
            chars_per_card_target = max(50, int(getattr(config, "CHARS_PER_CARD_TARGET", 200)))
            text_cap = int(total_text_chars / chars_per_card_target) if total_text_chars else 0
            if text_cap > total_cards_cap:
                total_cards_cap = text_cap
                target_reason = f"{target_reason}+text_density"

            # region agent log
            _debug_log({
                "sessionId": "debug-session",
                "runId": "baseline",
                "hypothesisId": "B",
                "location": "lectern_service.py:cap_calc",
                "message": "Computed card caps",
                "data": {
                    "pages": len(pages),
                    "total_cards_cap": total_cards_cap,
                    "min_cards_required": min_cards_required,
                    "hard_cap": hard_cap,
                    "max_notes_per_batch": max_notes_per_batch,
                    "actual_batch_size": actual_batch_size,
                    "cards_per_slide_target": getattr(config, "CARDS_PER_SLIDE_TARGET", None),
                    "effective_target": effective_target,
                    "target_reason": target_reason,
                        "total_text_chars": total_text_chars,
                        "avg_chars_per_page": avg_chars_per_page,
                        "chars_per_card_target": chars_per_card_target,
                        "text_cap": text_cap,
                },
                "timestamp": int(time.time() * 1000),
            })
            # endregion

            yield ServiceEvent("progress_start", "Generating Cards", {"total": total_cards_cap, "label": "Generation"})

            yield ServiceEvent("step_start", "Generate cards")
            
            # Generation loop
            while len(all_cards) < total_cards_cap:
                remaining = total_cards_cap - len(all_cards)
                limit = min(actual_batch_size, remaining)
                
                yield ServiceEvent("status", f"Generating batch (limit={limit})...")

                # region agent log
                _debug_log({
                    "sessionId": "debug-session",
                    "runId": "baseline",
                    "hypothesisId": "C",
                    "location": "lectern_service.py:gen_batch_start",
                    "message": "Starting generation batch",
                    "data": {
                        "current_cards": len(all_cards),
                        "remaining": remaining,
                        "limit": limit,
                        "examples_used": len(all_cards) == 0,
                        "seen_keys": len(seen_keys),
                    },
                    "timestamp": int(time.time() * 1000),
                })
                # endregion
                
                if stop_check and stop_check():
                    yield ServiceEvent("warning", "Generation stopped by user.")
                    return
                
                try:
                    # Pass examples only if we are starting fresh (or maybe always? logic said 'continue from prior')
                    # Previous fix used: examples=examples if turn_idx == 0 else ""
                    # We can approximate this: if len(all_cards) == 0 (and not resumed with cards)
                    current_examples = examples if len(all_cards) == 0 else ""
                    recent_keys = []
                    for card in all_cards[-30:]:
                        key = self._get_card_key(card)
                        if key:
                            recent_keys.append(key[:120])
                    covered_slides = sorted(
                        {
                            int(card.get("slide_number"))
                            for card in all_cards
                            if isinstance(card, dict) and str(card.get("slide_number", "")).isdigit()
                        }
                    )
                    # region agent log
                    _debug_log({
                        "sessionId": "debug-session",
                        "runId": "baseline",
                        "hypothesisId": "G",
                        "location": "lectern_service.py:gen_prompt_context",
                        "message": "Prepared anti-duplication context",
                        "data": {
                            "recent_keys_count": len(recent_keys),
                            "covered_slides_count": len(covered_slides),
                        },
                        "timestamp": int(time.time() * 1000),
                    })
                    # endregion
                    
                    out = ai.generate_more_cards(
                        limit=limit,
                        examples=current_examples,
                        avoid_fronts=recent_keys,
                        covered_slides=covered_slides,
                    )
                    new_cards = out.get("cards", [])
                    
                    added_count = 0
                    duplicate_count = 0
                    sample_unique = []
                    sample_duplicate = []
                    for card in new_cards:
                        key = self._get_card_key(card)
                        if key:
                            key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
                            if key in seen_keys:
                                duplicate_count += 1
                                if len(sample_duplicate) < 3:
                                    sample_duplicate.append(key_hash)
                            else:
                                seen_keys.add(key)
                                all_cards.append(card)
                                added_count += 1
                                if len(sample_unique) < 3:
                                    sample_unique.append(key_hash)
                                yield ServiceEvent("card", "New card", {"card": card})
                    # region agent log
                    _debug_log({
                        "sessionId": "debug-session",
                        "runId": "baseline",
                        "hypothesisId": "F",
                        "location": "lectern_service.py:gen_batch_result",
                        "message": "Batch generation results",
                        "data": {
                            "new_cards_raw": len(new_cards),
                            "added_count": added_count,
                            "done_flag": bool(out.get("done")),
                            "empty_keys": sum(1 for c in new_cards if not self._get_card_key(c)),
                            "duplicate_count": duplicate_count,
                            "sample_unique_hashes": sample_unique,
                            "sample_duplicate_hashes": sample_duplicate,
                        },
                        "timestamp": int(time.time() * 1000),
                    })
                    # endregion
                    
                    yield ServiceEvent("progress_update", "", {"current": len(all_cards)})
                    history_mgr.update_entry(history_id, card_count=len(all_cards))

                    # Save state
                    save_state(
                        pdf_path=os.path.abspath(pdf_path),
                        deck_name=deck_name,
                        cards=all_cards,
                        concept_map=concept_map,
                        history=ai.get_history(),
                        log_path=ai.log_path
                    )

                    should_stop = added_count == 0
                    
                    # region agent log
                    _debug_log({
                        "sessionId": "debug-session",
                        "runId": "baseline",
                        "hypothesisId": "E",
                        "location": "lectern_service.py:gen_should_stop",
                        "message": "Stop condition evaluated",
                        "data": {
                            "should_stop": should_stop,
                            "added_count": added_count,
                            "done_flag": bool(out.get("done")),
                            "cards_so_far": len(all_cards),
                            "min_cards_required": min_cards_required,
                            "total_cards_cap": total_cards_cap,
                        },
                        "timestamp": int(time.time() * 1000),
                    })
                    # endregion
                    if should_stop:
                        break
                except Exception as e:
                    yield ServiceEvent("error", f"Generation error: {e}")
                    break
            
            yield ServiceEvent("step_end", "Generation Phase Complete", {"success": True, "count": len(all_cards)})

            # 7. Reflection Phase
            if enable_reflection and len(all_cards) > 0 and len(all_cards) < total_cards_cap:
                yield ServiceEvent("step_start", "Reflection and improvement")
                
                # Dynamic rounds logic
                page_count = len(pages)
                if page_count < 20:
                    dynamic_rounds = 2
                elif page_count < 50:
                    dynamic_rounds = 3
                elif page_count < 100:
                    dynamic_rounds = 4
                else:
                    dynamic_rounds = 5
                
                rounds = reflection_rounds if reflection_rounds > 0 else dynamic_rounds
                
                yield ServiceEvent("progress_start", "Reflection", {"total": rounds, "label": "Reflection Rounds"})
                
                for round_idx in range(rounds):
                    remaining = max(0, total_cards_cap - len(all_cards))
                    if remaining == 0:
                        break
                        
                    yield ServiceEvent("status", f"Reflection Round {round_idx + 1}/{rounds}")
                    
                    if stop_check and stop_check():
                        yield ServiceEvent("warning", "Reflection stopped by user.")
                        return

                    try:
                        out = ai.reflect(limit=min(actual_batch_size, remaining))
                        new_cards = out.get("cards", [])
                        
                        added_count = 0
                        for card in new_cards:
                            key = self._get_card_key(card)
                            if key and key not in seen_keys:
                                seen_keys.add(key)
                                all_cards.append(card)
                                added_count += 1
                                yield ServiceEvent("card", "Refined card", {"card": card})
                        
                        yield ServiceEvent("progress_update", "", {"current": round_idx + 1})
                        history_mgr.update_entry(history_id, card_count=len(all_cards))
                        
                        # Save state
                        save_state(
                            pdf_path=os.path.abspath(pdf_path),
                            deck_name=deck_name,
                            cards=all_cards,
                            concept_map=concept_map,
                            history=ai.get_history(),
                            log_path=ai.log_path
                        )

                        should_stop = len(all_cards) >= total_cards_cap or added_count == 0
                        if should_stop:
                            break
                    except Exception as e:
                        yield ServiceEvent("warning", f"Reflection error: {e}")

                yield ServiceEvent("step_end", "Reflection Phase Complete", {"success": True})

            if not all_cards:
                yield ServiceEvent("warning", "No cards were generated.")
                history_mgr.update_entry(history_id, status="error")
                return

            # 8. Creation in Anki
            if skip_export:
                 yield ServiceEvent("info", "Skipping Anki export (Draft Mode)")
                 yield ServiceEvent("done", "Draft Generation Complete", {
                    "created": 0, 
                    "failed": 0, 
                    "total": len(all_cards),
                    "elapsed": time.perf_counter() - start_time,
                    "cards": all_cards,  # Return cards for draft store
                    "slide_set_name": slide_set_name,  # NOTE(Tags): Include for GUI draft sync
                })
                 return

            if stop_check and stop_check():
                return

            yield ServiceEvent("step_start", f"Create {len(all_cards)} notes in Anki")
            yield ServiceEvent("progress_start", "Exporting", {"total": len(all_cards), "label": "Notes"})
            
            created = 0
            failed = 0
            
            for idx, card in enumerate(all_cards, start=1):
                result = export_card_to_anki(
                    card=card,
                    card_index=idx,
                    deck_name=deck_name,
                    slide_set_name=slide_set_name,
                    fallback_model=config.DEFAULT_BASIC_MODEL,  # NOTE: Anki note type, not Gemini model
                    additional_tags=tags,
                )
                
                # Report media uploads
                for media_file in result.media_uploaded:
                    yield ServiceEvent("status", f"Uploaded media {media_file}")
                
                if result.success:
                    created += 1
                    yield ServiceEvent("note", f"Created note {result.note_id}", {"id": result.note_id})
                else:
                    failed += 1
                    yield ServiceEvent("warning", f"Failed to create note: {result.error}")
                
                yield ServiceEvent("progress_update", "", {"current": created + failed})

            yield ServiceEvent("step_end", "Export Complete", {"success": True, "created": created, "failed": failed})
            
            # Clear state on success
            clear_state()
            history_mgr.update_entry(history_id, status="completed")
            
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
            raise e

    async def estimate_cost(self, pdf_path: str) -> Dict[str, Any]:
        """Estimate the token count and cost for processing a PDF.
        
        Skips OCR for speed during estimation.
        """
        from ai_common import _compose_multimodal_content
        from pdf_parser import extract_content_from_pdf
        import asyncio
        
        # Parse PDF without OCR for speed
        pages = await asyncio.to_thread(extract_content_from_pdf, pdf_path, skip_ocr=True)
        pdf_content = [{"text": p.text, "images": p.images} for p in pages]
        
        # Compose content as it would be sent to the AI
        content = _compose_multimodal_content(pdf_content, "Analyze this PDF.")
        
        # Count tokens
        ai = LecternAIClient()
        token_count = ai.count_tokens(content)
        
        # Calculate cost ($0.50 per 1M tokens)
        estimated_cost = (token_count / 1_000_000) * 0.50
        
        return {
            "tokens": token_count,
            "cost": estimated_cost,
            "pages": len(pages)
        }

    def _get_card_key(self, card: Dict[str, Any]) -> str:
        fields = card.get("fields") or {}
        val = str(fields.get("Text") or fields.get("Front") or "")
        return " ".join(val.lower().split())
