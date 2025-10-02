from __future__ import annotations

import json
from typing import Any, Dict, List

import google.generativeai as genai  # type: ignore

import config
from ai_common import (
    _compose_multimodal_content,
    _extract_json_array_string,
    _salvage_truncated_json_array,
)


DEFAULT_MODEL_NAME = config.DEFAULT_GEMINI_MODEL
MAX_NOTES = config.MAX_NOTES_PER_BATCH


def _build_prompt(examples: str) -> str:
    """Construct the instruction prompt for Gemini.

    The prompt explicitly requests a strict JSON array of note objects to
    minimize parsing ambiguity.
    """

    example_prefix = (
        f"Examples from user's deck (style guide):\n{examples}\n\n"
        if examples.strip()
        else ""
    )

    instructions = (
        "You are an expert at creating high-quality Anki flashcards from "
        "university lecture slides. Generate concise, atomic cards that test "
        "one idea per card. Prefer cloze deletions when appropriate; otherwise "
        "use a Basic note with Front/Back fields.\n\n"
        "Return ONLY JSON. Prefer a JSON array of note objects; alternatively, you may return an object with a 'cards' array. No prose. The note objects contain "
        "these fields: \n"
        "- model_name: string (\"prettify-nord-basic\" for basic front/back or \"prettify-nord-cloze\" for cloze). Accepting 'Basic'/'Cloze' is also fine.\n"
        "- fields: object mapping field names to strings (Front/Back for basic, Text for cloze)\n"
        "- tags: array of strings\n"
        "- media: optional array of objects with 'filename' and 'data' (base64-encoded image)\n\n"
        "Do not include Markdown in field values unless present in the slide.\n"
        "If including media, choose short, unique filenames (e.g., 'slide-3-diagram.png').\n\n"
        "Definitive Guidelines for LLM Anki Card Generation\n"
        "Core principles (non-negotiable):\n"
        "- Prioritize comprehension over rote memorization: if concepts are ambiguous, first synthesize understanding; avoid hallucinations.\n"
        "- Minimum information principle: each card must test exactly one distinct fact or idea. Split multi-fact statements into multiple cards.\n"
        "- Build upon basics: prefer foundational definitions and core principles before nuanced details.\n\n"
        "Card creation process:\n"
        "- Input analysis: read the slide text; extract key facts, definitions, relationships; ignore filler.\n"
        "- Information extraction: simplify to the smallest clear QA or cloze.\n"
        "- Example transformation: break complex sentences into separate atomic units (e.g., location, property, value, comparison).\n\n"
        "Card type selection (in priority):\n"
        "1) Cloze deletion: prefer when a sentence can hide a key term/date/phrase. Use Anki syntax {{c1::...}}; multiple clozes per note should use c1, c2, ...; overlapping clozes reuse the same index. Hints allowed as {{c1::text::hint}}.\n"
        "2) Image occlusion (when a visual is present): describe the visual and the hidden region as text, but still output as either a cloze or basic card within this JSON schema. If an image is provided, include it under media; otherwise, describe the occlusion context in the Front/Text.\n"
        "3) Basic Q&A: use when cloze is unnatural; ensure a clear, unambiguous question and concise answer.\n\n"
        "Wording optimization:\n"
        "- Be concise; remove redundant words.\n"
        "- Ensure unambiguity and specificity; add minimal context to uniquely identify the target.\n\n"
        "Contextualization & personalization:\n"
        "- If categories or groupings exist, include subtle context cues in the text (short prefixes), but keep the card atomic.\n\n"
        "Mnemonic integration (optional):\n"
        "- For difficult items, you may append a short mnemonic suggestion at the end of the Back or Text, clearly separated in plain parentheses (no markdown). Keep it brief.\n\n"
        "Avoidance guidelines:\n"
        "- Avoid unordered sets; do not ask to list many items.\n"
        "- Avoid long enumerations; if needed, split across multiple cards or use overlapping clozes.\n"
        "- Avoid yes/no questions; rephrase to elicit recall.\n\n"
        "Metadata (optional):\n"
        "- For debatable or changing facts, you may add a brief source or date in plain text at the end of Back/Text, in parentheses, e.g., (as of 2025).\n\n"
        "Output constraints (critical):\n"
        "- Return ONLY JSON. Either a strict JSON array of note objects, or an object with key 'cards' containing that array. Use model_name values 'prettify-nord-cloze' or 'prettify-nord-basic' (or 'Cloze'/'Basic').\n"
        f"- Limit output to at most {MAX_NOTES} notes. Focus on the most central, atomic facts first.\n"
    )

    return example_prefix + instructions


def generate_cards(pdf_content: List[Dict[str, Any]], examples: str = "") -> List[Dict[str, Any]]:
    """Generate Anki card specifications from parsed PDF content.

    Returns a list of card objects as emitted by the model (no normalization).
    """

    if not config.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")

    genai.configure(api_key=config.GEMINI_API_KEY)

    generation_config = {
        "response_mime_type": "application/json",
        "temperature": 0.2,
        "max_output_tokens": 8192,
    }
    model = genai.GenerativeModel(DEFAULT_MODEL_NAME, generation_config=generation_config)

    prompt = _build_prompt(examples=examples)

    # Tolerate both dataclass objects and dicts
    normalized_pages: List[Dict[str, Any]] = []
    for page in pdf_content:
        if hasattr(page, "text") and hasattr(page, "images"):
            normalized_pages.append({"text": page.text, "images": page.images})  # type: ignore[attr-defined]
        else:
            normalized_pages.append({
                "text": page.get("text", ""),  # type: ignore[union-attr]
                "images": page.get("images", []),  # type: ignore[union-attr]
            })

    content_parts = _compose_multimodal_content(normalized_pages, prompt)

    try:
        response = model.generate_content(content_parts, request_options={"timeout": 180})
    except Exception as exc:
        raise RuntimeError(f"Gemini generation failed: {exc}")

    text = getattr(response, "text", None)
    if not text:
        try:
            candidates = getattr(response, "candidates", None) or []
            for cand in candidates:
                cand_text = getattr(cand, "text", None)
                if cand_text:
                    text = cand_text
                    break
                content = getattr(cand, "content", None)
                parts = getattr(content, "parts", []) if content else []
                for p in parts:
                    p_text = getattr(p, "text", None)
                    if p_text:
                        text = p_text
                        break
                if text:
                    break
        except Exception:
            text = None
        if not text:
            return []

    try:
        extracted = _extract_json_array_string(text)
        try:
            data = json.loads(extracted)
        except json.JSONDecodeError:
            salvaged = _salvage_truncated_json_array(extracted)
            data = json.loads(salvaged)
    except json.JSONDecodeError:
        return []

    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        return [item for item in data.get("cards", []) if isinstance(item, dict)]

    return []


