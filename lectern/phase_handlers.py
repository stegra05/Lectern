"""
Phase handlers for Lectern generation service.

This module provides handlers for the different phases of card generation:
concept mapping, generation loop, reflection loop, and Anki export.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Generator, List, Optional

from lectern.anki_connector import sample_examples_from_deck
from lectern.ai_client import LecternAIClient
from lectern.cost_estimator import extract_pdf_metadata
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.tags import infer_slide_set_name
from lectern import config

logger = logging.getLogger(__name__)


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


class ConceptPhaseHandler:
    """Handler for the concept mapping and AI initialization phase."""

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

    def run(
        self,
        file_size: int,
        context_deck: str = "",
    ) -> Generator[Dict[str, Any], None, ConceptPhaseResult]:
        """Run the concept phase: sample examples, init AI, upload PDF, build concept map.

        Args:
            file_size: Size of the PDF file in bytes (for progress estimation).
            context_deck: Optional deck to sample examples from.

        Yields:
            ServiceEvent dicts for progress reporting.

        Returns:
            ConceptPhaseResult with concept map, slide set name, and AI client.
        """
        # Sample examples from deck
        examples = ""
        yield {
            "type": "step_start",
            "message": "Sample examples from deck",
            "data": {},
        }
        try:
            deck_for_examples = context_deck or self.deck_name
            examples = sample_examples_from_deck(
                deck_name=deck_for_examples, sample_size=5
            )
            if examples.strip():
                yield {
                    "type": "info",
                    "message": "Loaded style examples from Anki",
                    "data": {},
                }
            yield {
                "type": "step_end",
                "message": "Examples Loaded",
                "data": {"success": True},
            }
        except Exception as e:
            yield {
                "type": "error",
                "message": f"Failed to sample examples: {e}",
                "data": {"recoverable": True},
            }
            yield {
                "type": "step_end",
                "message": "Examples Failed",
                "data": {"success": False},
            }

        # Extract PDF filename for fallback slide set name
        pdf_filename = os.path.splitext(os.path.basename(self.pdf_path))[0]
        pdf_title = ""

        # Initialize AI session
        yield {
            "type": "step_start",
            "message": "Start AI session",
            "data": {},
        }
        ai = LecternAIClient(
            model_name=self.model_name,
            focus_prompt=self.focus_prompt,
            slide_set_context=None,
        )
        yield {
            "type": "step_end",
            "message": "Session Started",
            "data": {"success": True},
        }

        # Upload PDF to Gemini
        uploaded_pdf: Dict[str, str] = {}
        yield {
            "type": "step_start",
            "message": "Upload PDF to Gemini",
            "data": {},
        }
        try:
            uploaded_pdf = ai.upload_pdf(self.pdf_path)
            yield {
                "type": "step_end",
                "message": "PDF Uploaded",
                "data": {"success": True},
            }
        except Exception as e:
            yield {
                "type": "step_end",
                "message": "PDF Upload Failed",
                "data": {"success": False},
            }
            yield {
                "type": "error",
                "message": f"Native PDF upload failed: {e}",
                "data": {"recoverable": False},
            }
            return ConceptPhaseResult(
                success=False,
                concept_map={},
                slide_set_name="",
                pages=[],
                total_text_chars=0,
                uploaded_pdf={},
            )

        # Build concept map
        concept_map: Dict[str, Any] = {}
        metadata = extract_pdf_metadata(pdf_path)
        actual_pages = metadata["page_count"]
        actual_text_chars = metadata["text_chars"]
        estimated_pages = actual_pages

        yield {
            "type": "step_start",
            "message": "Build global concept map",
            "data": {"phase": "concept"},
        }
        yield {
            "type": "progress_start",
            "message": "Analyzing slides",
            "data": {"total": estimated_pages, "phase": "concept"},
        }
        yield {
            "type": "progress_update",
            "message": "",
            "data": {"current": 0, "total": estimated_pages, "phase": "concept"},
        }

        pages: List[Any] = []
        total_text_chars = 0

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

            pages = [{} for _ in range(metadata_pages)]
            total_text_chars = metadata_chars

            yield {
                "type": "progress_update",
                "message": "",
                "data": {
                    "current": metadata_pages,
                    "total": metadata_pages,
                    "phase": "concept",
                },
            }
            yield {
                "type": "step_end",
                "message": "Concept Map Built",
                "data": {"success": True, "page_count": metadata_pages},
            }
            yield {
                "type": "info",
                "message": "Concept Map built",
                "data": {"map": concept_map},
            }

            for w in ai.drain_warnings():
                yield {"type": "warning", "message": w, "data": {}}

        except Exception as e:
            yield {
                "type": "error",
                "message": f"Concept map failed: {e}",
                "data": {"recoverable": True},
            }
            yield {
                "type": "step_end",
                "message": "Concept Map Failed",
                "data": {"success": False},
            }
            metadata_pages = actual_pages
            pages = [{} for _ in range(metadata_pages)]
            total_text_chars = actual_text_chars or (metadata_pages * 800)

        # Extract slide set name from concept map or use fallback
        slide_set_name = concept_map.get("slide_set_name", "") if concept_map else ""
        if not slide_set_name:
            slide_set_name = infer_slide_set_name(pdf_title, pdf_filename)
        if not slide_set_name:
            slide_set_name = pdf_filename.replace("_", " ").replace("-", " ").title()

        yield {
            "type": "info",
            "message": f"Slide Set Name: '{slide_set_name}'",
            "data": {},
        }

        # Set slide set context in AI client
        ai.set_slide_set_context(
            deck_name=self.deck_name,
            slide_set_name=slide_set_name,
        )

        return ConceptPhaseResult(
            success=True,
            concept_map=concept_map,
            slide_set_name=slide_set_name,
            pages=pages,
            total_text_chars=total_text_chars,
            uploaded_pdf=uploaded_pdf,
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

    def run(
        self,
        cards: List[Dict[str, Any]],
    ) -> Generator[Dict[str, Any], None, ExportPhaseResult]:
        """Export cards to Anki.

        Args:
            cards: List of card dictionaries to export.

        Yields:
            ServiceEvent dicts for progress reporting.

        Returns:
            ExportPhaseResult with counts of created and failed notes.
        """
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
            result = export_card_to_anki(
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

        return ExportPhaseResult(
            success=True,
            created=created,
            failed=failed,
            total=len(cards),
        )
