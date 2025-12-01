import asyncio
import json
import logging
import os
import time
from typing import AsyncGenerator, Dict, List, Any

import config
from anki_connector import add_note, check_connection, store_media_file, sample_examples_from_deck
from pdf_parser import extract_content_from_pdf
from ai_client import LecternAIClient
from utils.tags import build_grouped_tags

# Mocking rich-like events for the GUI
class ProgressEvent:
    def __init__(self, type: str, message: str = "", data: Dict[str, Any] = None):
        self.type = type
        self.message = message
        self.data = data or {}

    def to_json(self):
        return json.dumps({
            "type": self.type,
            "message": self.message,
            "data": self.data,
            "timestamp": time.time()
        })

class GenerationService:
    def __init__(self):
        self.logger = logging.getLogger("lectern.gui")

    async def run_generation(
        self,
        pdf_path: str,
        deck_name: str,
        model_name: str,
        tags: List[str],
        context_deck: str = ""
    ) -> AsyncGenerator[str, None]:
        
        yield ProgressEvent("status", "Initializing...").to_json()

        # 1. Validation
        if not os.path.exists(pdf_path):
            yield ProgressEvent("error", f"PDF not found: {pdf_path}").to_json()
            return

        if not check_connection():
            yield ProgressEvent("error", "AnkiConnect unreachable").to_json()
            return

        # 2. Parse PDF
        yield ProgressEvent("status", "Parsing PDF...").to_json()
        try:
            # Run CPU-bound task in executor
            pages = await asyncio.to_thread(extract_content_from_pdf, pdf_path)
            yield ProgressEvent("info", f"Parsed {len(pages)} pages").to_json()
        except Exception as e:
            yield ProgressEvent("error", f"PDF parsing failed: {str(e)}").to_json()
            return

        # 3. AI Session
        yield ProgressEvent("status", "Starting AI Session...").to_json()
        ai = LecternAIClient()
        
        # 4. Concept Map (Optional)
        yield ProgressEvent("status", "Building Concept Map...").to_json()
        try:
            concept_map = await asyncio.to_thread(ai.concept_map, [p.__dict__ for p in pages])
            yield ProgressEvent("info", "Concept Map built", data={"map": concept_map}).to_json()
        except Exception as e:
            yield ProgressEvent("warning", f"Concept map failed: {e}").to_json()

        # 5. Generation Loop
        all_cards = []
        seen_keys = set()
        total_cards_cap = int(len(pages) * getattr(config, "CARDS_PER_SLIDE_TARGET", 1.5))
        max_batch = config.MAX_NOTES_PER_BATCH

        # Calculate minimum required cards (enforced threshold)
        min_cards_required = int(len(pages) * getattr(config, "MIN_CARDS_PER_SLIDE", 0.8))

        yield ProgressEvent("progress_start", "Generating Cards", data={"total": total_cards_cap}).to_json()

        while len(all_cards) < total_cards_cap:
            remaining = total_cards_cap - len(all_cards)
            limit = min(max_batch, remaining)
            
            yield ProgressEvent("status", f"Generating batch (limit={limit})...").to_json()
            
            try:
                out = await asyncio.to_thread(ai.generate_more_cards, limit=limit)
                new_cards = out.get("cards", [])
                
                added_count = 0
                for card in new_cards:
                    # Simple dedup key
                    key = str(card.get("fields", {}).get("Front", "") or card.get("fields", {}).get("Text", ""))
                    if key and key not in seen_keys:
                        seen_keys.add(key)
                        all_cards.append(card)
                        added_count += 1
                        # Stream individual card for preview
                        yield ProgressEvent("card_generated", "New card", data={"card": card}).to_json()
                
                yield ProgressEvent("progress_update", data={"current": len(all_cards)}).to_json()

                # Only stop if:
                # 1. We added no new cards (stuck/exhausted)
                # 2. OR (AI says done AND we met the minimum requirement)
                should_stop = (
                    added_count == 0 or
                    (out.get("done") and len(all_cards) >= min_cards_required)
                )
                
                if should_stop:
                    break
            except Exception as e:
                yield ProgressEvent("error", f"Generation error: {e}").to_json()
                break

        # 6. Creation in Anki
        yield ProgressEvent("status", "Creating notes in Anki...").to_json()
        created = 0
        failed = 0
        
        for idx, card in enumerate(all_cards):
            try:
                # Media handling
                for media in card.get("media", []) or []:
                    filename = media.get("filename", f"lectern-{idx}.png")
                    data_b64 = media.get("data", "")
                    if data_b64:
                        await asyncio.to_thread(
                            store_media_file, 
                            filename, 
                            base64.b64decode(data_b64) if isinstance(data_b64, str) else data_b64
                        )

                # Note creation
                note_model = card.get("model_name") or model_name
                note_fields = {str(k): str(v) for k, v in (card.get("fields") or {}).items()}
                note_tags = list(set((card.get("tags") or []) + tags))
                
                await asyncio.to_thread(add_note, deck_name, note_model, note_fields, note_tags)
                created += 1
                yield ProgressEvent("note_created", f"Created note {created}").to_json()
            except Exception as e:
                failed += 1
                yield ProgressEvent("warning", f"Failed to create note: {e}").to_json()

        yield ProgressEvent("done", "Job Complete", data={"created": created, "failed": failed}).to_json()
