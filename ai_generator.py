"""
AI generator module responsible for turning parsed PDF content into
Anki-ready notes using Google's Gemini API.

The generator composes a multimodal prompt from text and images extracted
from the PDF and (optionally) few-shot examples sampled from an existing deck.
It requests a structured JSON response describing notes to create.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple
import os

import google.generativeai as genai  # type: ignore

import config
from ai_common import (
    _compose_multimodal_content,
    _strip_code_fences,
    _start_session_log,
    _append_session_log,
    _extract_json_array_string,
)
from ai_cards import _normalize_card_object


DEFAULT_MODEL_NAME = config.DEFAULT_GEMINI_MODEL


    # imported from ai_common


def start_single_session() -> Tuple[Any, str]:
    if not config.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")
    genai.configure(api_key=config.GEMINI_API_KEY)
    # In a single-session flow, avoid response_schema to keep flexibility
    generation_config: Dict[str, Any] = {
        "response_mime_type": "application/json",
        "temperature": 0.2,
        "max_output_tokens": 8192,
    }
    model = genai.GenerativeModel(DEFAULT_MODEL_NAME, generation_config=generation_config)
    chat = model.start_chat(history=[])
    log_path = _start_session_log()
    print(f"[AI] Started single session; log={os.path.basename(log_path) if log_path else 'disabled'}")
    return chat, log_path


def chat_concept_map(chat: Any, pdf_content: List[Dict[str, Any]], log_path: str) -> Dict[str, Any]:
    prompt = (
        "You are an expert educator. From the following slides, extract a compact global concept map for learning.\n"
        "- Identify learning objectives (explicit or inferred).\n"
        "- List key concepts (entities, definitions, categories), assign stable short IDs.\n"
        "- Extract relations between concepts (is-a, part-of, causes, contrasts-with, depends-on), noting page references.\n"
        "Return ONLY a JSON object with keys: objectives (array), concepts (array), relations (array). No prose.\n"
    )
    parts = _compose_multimodal_content(pdf_content, prompt)
    print(f"[Chat/ConceptMap] parts={len(parts)} prompt_len={len(prompt)}")
    response = chat.send_message(parts, request_options={"timeout": 180})
    text = getattr(response, "text", None) or ""
    print(f"[Chat/ConceptMap] Response snippet: {text[:200].replace('\n',' ')}...")
    _append_session_log(log_path, "conceptmap", parts, text, False)
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
    except Exception:
        return {"concepts": []}
    return data if isinstance(data, dict) else {"concepts": []}


def chat_generate_more_cards(chat: Any, limit: int, log_path: str) -> Dict[str, Any]:
    prompt = (
        f"Generate up to {int(limit)} high-quality, atomic Anki notes continuing from our prior turns.\n"
        "- Avoid duplicates; complement existing coverage.\n"
        "- Prefer cloze when natural; otherwise Basic Front/Back.\n"
        "- Return ONLY JSON: either an array of note objects or {\"cards\": [...], \"done\": bool}. No prose.\n"
        "- If no more high-quality cards remain, return an empty array or {\"cards\": [], \"done\": true}.\n"
    )
    parts: List[Dict[str, Any]] = [{"text": prompt}]
    response = chat.send_message(parts, request_options={"timeout": 180})
    text = getattr(response, "text", None) or ""
    print(f"[Chat/Gen] Response snippet: {text[:200].replace('\n',' ')}...")
    _append_session_log(log_path, "generation", parts, text, False)
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
    except Exception:
        # Try array salvage
        arr = _extract_json_array_string(s)
        try:
            cards = json.loads(arr)
            if isinstance(cards, list):
                normalized = [_normalize_card_object(c) for c in cards if isinstance(c, dict)]
                normalized = [c for c in normalized if c]
                return {"cards": normalized, "done": len(normalized) == 0}
        except Exception:
            return {"cards": [], "done": True}
    if isinstance(data, list):
        normalized = [_normalize_card_object(c) for c in data if isinstance(c, dict)]
        normalized = [c for c in normalized if c]
        return {"cards": normalized, "done": len(normalized) == 0}
    if isinstance(data, dict):
        cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
        normalized = [_normalize_card_object(c) for c in cards]
        normalized = [c for c in normalized if c]
        done = bool(data.get("done", False)) or (len(normalized) == 0)
        return {"cards": normalized, "done": done}
    return {"cards": [], "done": True}


def chat_reflect(chat: Any, deck_summary: List[str], limit: int, log_path: str, reflection_prompt: str | None = None) -> Dict[str, Any]:
    base = (
        "You are a reflective and critical learner tasked with creating high-quality Anki flashcards from lecture materials. "
        "Review your last set of cards with a deep and analytical mindset. Goals: coverage, gaps, inaccuracies, depth, clarity/atomicity, and cross-concept connections.\n"
        "First, write a concise reflection (≤1200 chars). Then provide improved or additional cards.\n"
        f"Return ONLY JSON: {{\"reflection\": str, \"cards\": [...], \"done\": bool}}. Limit to at most {int(limit)} cards.\n"
    )
    deck_summary_json = json.dumps(deck_summary or [], ensure_ascii=False)
    prompt = (reflection_prompt or base) + f"\nDeck summary (Front or Cloze Text only): {deck_summary_json}"
    parts: List[Dict[str, Any]] = [{"text": prompt}]
    response = chat.send_message(parts, request_options={"timeout": 180})
    text = getattr(response, "text", None) or ""
    print(f"[Chat/Reflect] Response snippet: {text[:200].replace('\n',' ')}...")
    _append_session_log(log_path, "reflection", parts, text, False)
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
    except Exception:
        return {"reflection": "", "cards": [], "done": True}
    if isinstance(data, dict):
        cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
        normalized = [_normalize_card_object(c) for c in cards]
        normalized = [c for c in normalized if c]
        done = bool(data.get("done", False)) or (len(normalized) == 0)
        return {"reflection": str(data.get("reflection", "")), "cards": normalized, "done": done}
    return {"reflection": "", "cards": [], "done": True}


def _normalize_card_object(card: Dict[str, Any]) -> Dict[str, Any] | None:
    """Normalize a model-returned card into { model_name, fields, tags?, media? }.

    Accepts variants like {front, back}, {question, answer}, {Text}, or already 'fields'.
    Infers model_name based on presence of cloze markup or 'Text'. Returns None if invalid.
    """

    if not isinstance(card, dict):
        return None

    # If already canonical fields present
    fields_obj = card.get("fields")
    model_name = str(card.get("model_name")) if card.get("model_name") else None
    if isinstance(fields_obj, dict):
        # Ensure strings
        fields: Dict[str, str] = {str(k): str(v) for k, v in fields_obj.items() if v is not None}
        text_val = fields.get("Text", "")
        front_val = fields.get("Front", "")
        back_val = fields.get("Back", "")
        content = f"{text_val} {front_val} {back_val}".lower()
        if model_name is None:
            model_name = "Cloze" if "{{c" in content else "Basic"
        return {
            "model_name": model_name,
            "fields": {k: v for k, v in fields.items() if k in ("Text", "Front", "Back") and v},
            "tags": [str(t) for t in (card.get("tags") or []) if isinstance(t, (str, int))],
            "media": [m for m in (card.get("media") or []) if isinstance(m, dict)],
        }

    # Case-insensitive key accessors
    def _get_ci(keys: List[str]) -> str:
        for k in keys:
            if k in card and isinstance(card[k], (str, int)):
                return str(card[k])
        # lowercase variants
        lower_map = {str(k).lower(): k for k in card.keys()}
        for k in keys:
            lk = k.lower()
            if lk in lower_map and isinstance(card[lower_map[lk]], (str, int)):
                return str(card[lower_map[lk]])
        return ""

    text = _get_ci(["Text", "text", "cloze"])  # cloze-like
    front = _get_ci(["Front", "front", "question", "q"])  # basic
    back = _get_ci(["Back", "back", "answer", "a"])  # basic

    # Determine model
    is_cloze = False
    content_all = f"{text} {front} {back}".lower()
    if "{{c" in content_all:
        is_cloze = True
    if text.strip():
        is_cloze = True

    if is_cloze:
        val = text.strip() if text.strip() else (front if "{{c" in front.lower() else "")
        if not val:
            return None
        return {
            "model_name": model_name or "Cloze",
            "fields": {"Text": val},
            "tags": [str(t) for t in (card.get("tags") or []) if isinstance(t, (str, int))],
            "media": [m for m in (card.get("media") or []) if isinstance(m, dict)],
        }

    # Basic card
    if not front.strip() and not back.strip():
        return None
    return {
        "model_name": model_name or "Basic",
        "fields": {"Front": front.strip(), "Back": back.strip()},
        "tags": [str(t) for t in (card.get("tags") or []) if isinstance(t, (str, int))],
        "media": [m for m in (card.get("media") or []) if isinstance(m, dict)],
    }


    # legacy prompt and content builders moved to ai_legacy/ai_common


    # batch functions moved to ai_batch


    # batch functions moved to ai_batch


    # batch functions moved to ai_batch


    # moved to ai_common


    # legacy generator moved to ai_legacy


