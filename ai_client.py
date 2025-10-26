from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

import google.generativeai as genai  # type: ignore

import config
from ai_common import (
    LATEX_STYLE_GUIDE,
    _compose_multimodal_content,
    _strip_code_fences,
    _start_session_log,
    _append_session_log,
    _extract_json_array_string,
    _extract_json_object_string,
)
from ai_cards import _normalize_card_object
from utils.cli import debug


class LecternAIClient:
    def __init__(self, model_name: str | None = None) -> None:
        if not config.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")
        genai.configure(api_key=config.GEMINI_API_KEY)
        generation_config = {
            "response_mime_type": "application/json",
            "temperature": 0.2,
            "max_output_tokens": 8192,
        }
        self._model = genai.GenerativeModel(
            model_name or config.DEFAULT_GEMINI_MODEL,
            generation_config=generation_config,
            system_instruction=LATEX_STYLE_GUIDE,
        )
        self._chat = self._model.start_chat(history=[])
        self._log_path = _start_session_log()
        debug("[AI] Started session via LecternAIClient")

    @property
    def log_path(self) -> str:
        return self._log_path

    def concept_map(self, pdf_content: List[Dict[str, Any]]) -> Dict[str, Any]:
        prompt = (
            "You are an expert educator. From the following slides, extract a compact global concept map for learning.\n"
            "- Identify learning objectives (explicit or inferred).\n"
            "- List key concepts (entities, definitions, categories), assign stable short IDs.\n"
            "- Extract relations between concepts (is-a, part-of, causes, contrasts-with, depends-on), noting page references.\n"
            "Return ONLY a JSON object with keys: objectives (array), concepts (array), relations (array). No prose.\n"
        )
        parts = _compose_multimodal_content(pdf_content, prompt)
        debug(f"[Chat/ConceptMap] parts={len(parts)} prompt_len={len(prompt)}")
        response = self._chat.send_message(parts, request_options={"timeout": 180})
        text = getattr(response, "text", None) or ""
        debug(f"[Chat/ConceptMap] Response snippet: {text[:200].replace('\n',' ')}...")
        _append_session_log(self._log_path, "conceptmap", parts, text, False)
        s = _strip_code_fences(text)
        try:
            data = json.loads(s)
        except Exception:
            obj = _extract_json_object_string(s)
            try:
                data = json.loads(obj)
            except Exception:
                return {"concepts": []}
        return data if isinstance(data, dict) else {"concepts": []}

    def generate_more_cards(self, limit: int) -> Dict[str, Any]:
        prompt = (
            f"Generate up to {int(limit)} high-quality, atomic Anki notes continuing from our prior turns.\n"
            "- Avoid duplicates; complement existing coverage.\n"
            "- Prefer cloze when natural; otherwise Basic Front/Back.\n"
            "- For each note, include a \"tags\" array with 1-2 concise topical tags that categorize the content (lowercase kebab-case, ASCII, hyphens only; avoid generic terms; do not include \"lectern\" or deck/model names).\n"
            "- Use consistent tag names across related notes to cluster them.\n"
            "- Return ONLY JSON: either an array of note objects or {\"cards\": [...], \"done\": bool}. No prose.\n"
            "- If no more high-quality cards remain, return an empty array or {\"cards\": [], \"done\": true}.\n"
        )
        parts: List[Dict[str, Any]] = [{"text": prompt}]
        response = self._chat.send_message(parts, request_options={"timeout": 180})
        text = getattr(response, "text", None) or ""
        debug(f"[Chat/Gen] Response snippet: {text[:200].replace('\n',' ')}...")
        _append_session_log(self._log_path, "generation", parts, text, False)
        s = _strip_code_fences(text)
        try:
            data = json.loads(s)
        except Exception:
            arr = _extract_json_array_string(s)
            try:
                cards = json.loads(arr)
                if isinstance(cards, list):
                    normalized = [_normalize_card_object(c) for c in cards if isinstance(c, dict)]
                    normalized = [c for c in normalized if c]
                    done = len(normalized) == 0
                    return {"cards": normalized, "done": done}
            except Exception:
                return {"cards": [], "done": True}
        if isinstance(data, list):
            normalized = [_normalize_card_object(c) for c in data if isinstance(c, dict)]
            normalized = [c for c in normalized if c]
            done = len(normalized) == 0
            return {"cards": normalized, "done": done}
        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            normalized = [_normalize_card_object(c) for c in cards]
            normalized = [c for c in normalized if c]
            done = bool(data.get("done", len(normalized) == 0))
            return {"cards": normalized, "done": done}
        return {"cards": [], "done": True}

    def reflect(self, limit: int, reflection_prompt: str | None = None) -> Dict[str, Any]:
        base = (
            "You are a reflective and critical learner tasked with creating high-quality Anki flashcards from lecture materials. "
            "Review your last set of cards with a deep and analytical mindset. Goals: coverage, gaps, inaccuracies, depth, clarity/atomicity, and cross-concept connections.\n"
            "First, write a concise reflection (≤1200 chars). Then provide improved or additional cards.\n"
            "Include a \"tags\" array per note with 1-2 concise topical tags (lowercase kebab-case, ASCII, hyphens only; avoid generic terms and \"lectern\"). Use consistent tags across related notes.\n"
            f"Return ONLY JSON: {{\"reflection\": str, \"cards\": [...], \"done\": bool}}. Limit to at most {int(limit)} cards.\n"
        )
        prompt = (reflection_prompt or base)
        parts: List[Dict[str, Any]] = [{"text": prompt}]
        response = self._chat.send_message(parts, request_options={"timeout": 180})
        text = getattr(response, "text", None) or ""
        debug(f"[Chat/Reflect] Response snippet: {text[:200].replace('\n',' ')}...")
        _append_session_log(self._log_path, "reflection", parts, text, False)
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


