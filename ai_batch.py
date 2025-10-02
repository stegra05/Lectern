from __future__ import annotations

import json
from typing import Any, Dict, List

import google.generativeai as genai  # type: ignore

import config
from ai_common import _compose_multimodal_content, _strip_code_fences, _log_exchange


DEFAULT_MODEL_NAME = config.DEFAULT_GEMINI_MODEL


# JSON Schemas for structured outputs
CONCEPT_MAP_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "objectives": {"type": "array", "items": {"type": "string"}},
        "concepts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "kind": {"type": "string"},
                    "definition": {"type": "string"},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "pages": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["id", "name", "definition"],
            },
        },
        "relations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "relation": {"type": "string"},
                    "explanation": {"type": "string"},
                    "pages": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["from", "to", "relation"],
            },
        },
    },
    "required": ["concepts"],
}


CARD_OBJECT_PROPERTIES: Dict[str, Any] = {
    "model_name": {"type": "string"},
    "fields": {
        "type": "object",
        "properties": {
            "Front": {"type": "string"},
            "Back": {"type": "string"},
            "Text": {"type": "string"},
        },
    },
    "tags": {"type": "array", "items": {"type": "string"}},
    "media": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "filename": {"type": "string"},
                "data": {"type": "string"},
            },
            "required": ["filename", "data"],
        },
    },
}


CARD_BATCH_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": CARD_OBJECT_PROPERTIES,
                "required": ["model_name", "fields"],
            },
        },
        "cursor": {
            "type": "object",
            "properties": {
                "page_start": {"type": "integer"},
                "page_end": {"type": "integer"},
            },
        },
    },
    "required": ["cards"],
}


REFLECTION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "reflection": {"type": "string"},
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": CARD_OBJECT_PROPERTIES,
                "required": ["model_name", "fields"],
            },
        },
        "done": {"type": "boolean"},
    },
    "required": ["cards"],
}


def _make_model(response_schema: Dict[str, Any] | None = None) -> tuple[Any, bool]:
    generation_config: Dict[str, Any] = {
        "response_mime_type": "application/json",
        "temperature": 0.2,
        "max_output_tokens": 8192,
    }
    if response_schema is not None:
        generation_config["response_schema"] = response_schema
    try:
        print(f"[AI] Initializing model {DEFAULT_MODEL_NAME} with schema={'yes' if response_schema else 'no'}")
        return genai.GenerativeModel(DEFAULT_MODEL_NAME, generation_config=generation_config), True
    except Exception as exc:
        print(f"[AI][WARN] Schema rejected when initializing model: {exc}. Falling back to instructions-only JSON.")
        generation_config.pop("response_schema", None)
        return genai.GenerativeModel(DEFAULT_MODEL_NAME, generation_config=generation_config), False


def generate_concept_map(pdf_content: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not config.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")

    genai.configure(api_key=config.GEMINI_API_KEY)
    model, schema_used = _make_model(CONCEPT_MAP_SCHEMA)

    prompt = (
        "You are an expert educator. From the following slides, extract a compact global concept map for learning.\n"
        "- Identify learning objectives (explicit or inferred).\n"
        "- List key concepts (entities, definitions, categories), assign stable short IDs.\n"
        "- Extract relations between concepts (is-a, part-of, causes, contrasts-with, depends-on), noting page references.\n"
        "Return ONLY JSON matching the provided schema. No prose.\n\n"
        "Constraints:\n- Be concise; avoid redundancy and paraphrase.\n- Use 3–8 word names; definitions ≤ 40 words.\n"
    )

    parts = _compose_multimodal_content(pdf_content, prompt)
    print(f"[ConceptMap] Parts: {len(parts)}; prompt_len={len(prompt)}")
    response = model.generate_content(parts, request_options={"timeout": 180})
    text = getattr(response, "text", None) or ""
    print(f"[ConceptMap] Response snippet: {text[:200].replace('\n',' ')}...")
    _log_exchange("conceptmap", parts, text, DEFAULT_MODEL_NAME)
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
    except Exception:
        return {"concepts": []}
    if isinstance(data, dict):
        return data
    return {"concepts": []}


def generate_cards_for_page_window(
    pdf_window: List[Dict[str, Any]],
    concept_map: Dict[str, Any] | None,
    examples: str,
    page_start: int,
    page_end: int,
    limit: int | None = None,
) -> Dict[str, Any]:
    if not config.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")

    genai.configure(api_key=config.GEMINI_API_KEY)
    model, schema_used = _make_model(CARD_BATCH_SCHEMA)

    limit_n = int(limit or config.MAX_NOTES_PER_BATCH)
    concept_map_json = json.dumps(concept_map or {}, ensure_ascii=False)

    example_prefix = (
        f"Examples from user's deck (style guide):\n{examples}\n\n" if examples.strip() else ""
    )

    prompt = (
        example_prefix
        + "Goal: Create high-quality, atomic Anki cards from these slides, guided by the global concept map.\n\n"
        "Use principles:\n- Minimum information, active recall, unambiguous phrasing; prefer cloze when natural.\n"
        "- Prioritize foundational definitions before details; avoid enumerations unless split.\n"
        "- Connect concepts using the concept map (comparisons, contrasts, dependencies), but keep each card atomic.\n\n"
        f"Instructions:\n- Generate up to {limit_n} cards for pages {page_start}–{page_end}.\n"
        "- Include image-based cards if images are present (provide base64 media).\n- Tag cards appropriately if a theme is obvious; otherwise omit.\n"
        "- If information is ambiguous, choose safest, widely accepted phrasing.\n\n"
        "Return ONLY JSON matching the schema (cards, cursor). No prose.\n\n"
        f"Global concept map (JSON):\n{concept_map_json}\n"
        f"Window: pages {page_start}–{page_end}.\n"
    )

    parts = _compose_multimodal_content(pdf_window, prompt)
    print(f"[GenWindow] pages={page_start}-{page_end} parts={len(parts)} prompt_len={len(prompt)} limit={limit_n}")
    response = model.generate_content(parts, request_options={"timeout": 180})

    text = getattr(response, "text", None) or ""
    print(f"[GenWindow] Response snippet: {text[:200].replace('\n',' ')}...")
    _log_exchange("generation-window", parts, text, DEFAULT_MODEL_NAME)
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
    except Exception:
        return {"cards": [], "cursor": {"page_start": page_start, "page_end": page_end}}

    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
        print(f"[GenWindow] Parsed cards: {len(cards)}")
        return {
            "cards": cards,
            "cursor": data.get("cursor", {"page_start": page_start, "page_end": page_end}),
        }
    if isinstance(data, list):
        cards = [c for c in data if isinstance(c, dict)]
        print(f"[GenWindow] Parsed cards (array): {len(cards)}")
        return {"cards": cards, "cursor": {"page_start": page_start, "page_end": page_end}}
    print(f"[GenWindow][WARN] Unrecognized data type: {type(data)}")
    return {"cards": [], "cursor": {"page_start": page_start, "page_end": page_end}}


def reflect_and_improve(
    deck_summary: List[str],
    concept_map: Dict[str, Any] | None,
    objectives: List[str] | None,
    limit: int | None = None,
    reflection_prompt: str | None = None,
) -> Dict[str, Any]:
    if not config.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")

    genai.configure(api_key=config.GEMINI_API_KEY)
    model, schema_used = _make_model(REFLECTION_SCHEMA)

    limit_n = int(limit or config.MAX_NOTES_PER_BATCH)
    concept_map_json = json.dumps(concept_map or {}, ensure_ascii=False)
    objectives_json = json.dumps(objectives or [], ensure_ascii=False)
    deck_summary_json = json.dumps(deck_summary or [], ensure_ascii=False)

    default_reflection = (
        "You are a reflective and critical learner tasked with creating high-quality Anki flashcards from lecture materials. "
        "Review your last set of cards with a deep and analytical mindset. Your goals are to:\n"
        "- Check if all stated learning objectives are fully covered.\n"
        "- Identify missing concepts, overlaps, or inaccuracies.\n"
        "- Evaluate whether each card promotes active recall at the right level of depth.\n"
        "- Question the clarity, atomicity, and wording of each card.\n"
        "- Consider whether the cards connect concepts, highlight underlying principles, or reveal common misconceptions.\n\n"
        "First, write a concise reflection (≤1200 chars). Then, provide an improved or expanded set of cards."
    )

    prompt = (
        (reflection_prompt or default_reflection)
        + "\nRules:\n- Only add cards that clearly improve coverage or quality.\n- Do not duplicate existing cards; prefer complementary variants.\n"
        + f"- Return ONLY JSON matching the schema (reflection, cards, done). No prose. Limit to at most {limit_n} new or improved cards.\n\n"
        + f"Inputs:\n- Global concept map (JSON): {concept_map_json}\n- Learning objectives: {objectives_json}\n- Deck summary (Front or Cloze Text only, deduped): {deck_summary_json}\n"
    )

    parts: List[Dict[str, Any]] = [{"text": prompt}]
    print(f"[Reflect] deck_summary_len={len(deck_summary_json)} limit={limit_n}")
    response = model.generate_content(parts, request_options={"timeout": 180})

    text = getattr(response, "text", None) or ""
    print(f"[Reflect] Response snippet: {text[:200].replace('\n',' ')}...")
    _log_exchange("reflection", parts, text, DEFAULT_MODEL_NAME)
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
    except Exception:
        return {"reflection": "", "cards": [], "done": True}

    if isinstance(data, dict):
        cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
        done = bool(data.get("done", False)) or (len(cards) == 0)
        print(f"[Reflect] Cards suggested: {len(cards)} done={done}")
        return {"reflection": str(data.get("reflection", "")), "cards": cards, "done": done}

    return {"reflection": "", "cards": [], "done": True}


