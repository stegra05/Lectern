"""
AI generator module responsible for turning parsed PDF content into
Anki-ready notes using Google's Gemini API.

The generator composes a multimodal prompt from text and images extracted
from the PDF and (optionally) few-shot examples sampled from an existing deck.
It requests a structured JSON response describing notes to create.
"""

from __future__ import annotations

import base64
import json
import imghdr
from typing import Any, Dict, Iterable, List
import os
from datetime import datetime

import google.generativeai as genai  # type: ignore

import config


DEFAULT_MODEL_NAME = config.DEFAULT_GEMINI_MODEL
MAX_NOTES = 30


def _infer_mime_type(image_bytes: bytes) -> str:
    """Best-effort inference of image MIME type from raw bytes.

    Falls back to application/octet-stream when type is unknown.
    """

    kind = imghdr.what(None, h=image_bytes)
    if kind == "png":
        return "image/png"
    if kind in ("jpeg", "jpg"):
        return "image/jpeg"
    if kind == "gif":
        return "image/gif"
    if kind == "webp":
        return "image/webp"
    return "application/octet-stream"


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
        "Return ONLY a JSON array. No prose. The array contains objects with "
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
        "- Avoid yes/no questions; rephrase to elicit recall.\n"
        "- Reduce interference: differentiate similar concepts with distinguishing context.\n\n"
        "Metadata (optional):\n"
        "- For debatable or changing facts, you may add a brief source or date in plain text at the end of Back/Text, in parentheses, e.g., (as of 2025).\n\n"
        "Output constraints (critical):\n"
        "- Despite these guidelines, you must return ONLY a strict JSON array of note objects as specified above, using model_name values 'prettify-nord-cloze' or 'prettify-nord-basic' (or 'Cloze'/'Basic').\n"
        f"- Limit output to at most {MAX_NOTES} notes. Focus on the most central, atomic facts first.\n"
    )

    return example_prefix + instructions


def _compose_multimodal_content(pdf_content: Iterable[Dict[str, Any]], prompt: str) -> List[Dict[str, Any]]:
    """Compose the list of content parts for Gemini from parsed pages.

    Expects each page item to expose 'text' and 'images' (list of bytes).
    """

    parts: List[Dict[str, Any]] = [{"text": prompt}]
    for page in pdf_content:
        page_text = str(page.get("text", ""))
        if page_text.strip():
            parts.append({"text": f"Slide text:\n{page_text}"})
        for image_bytes in page.get("images", []) or []:
            mime = _infer_mime_type(image_bytes)
            parts.append(
                {
                    "inline_data": {
                        "mime_type": mime,
                        "data": base64.b64encode(image_bytes).decode("utf-8"),
                    }
                }
            )
    return parts


def _extract_json_array_string(text: str) -> str:
    """Extract the first top-level JSON array from text, robust to code fences and quotes.

    - Strips optional ```json ... ``` fences
    - Tracks quotes and escapes so brackets inside strings don't break matching
    Returns the best-effort array substring, or the original text if not found.
    """

    if not isinstance(text, str):
        return ""

    stripped = text.strip()

    # Remove code fences if present
    if stripped.startswith("```"):
        # find the first newline after the opening fence
        first_nl = stripped.find("\n")
        if first_nl != -1:
            # drop the opening fence line (could be ``` or ```json)
            stripped = stripped[first_nl + 1 :]
            # remove closing fence if present
            if stripped.endswith("```"):
                stripped = stripped[: -3].strip()

    # Fast path
    if stripped.startswith("[") and stripped.endswith("]"):
        return stripped

    # Scan for top-level array while respecting strings and escapes
    start = -1
    in_string = False
    escape = False
    depth = 0
    for idx, ch in enumerate(stripped):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        else:
            if ch == '"':
                in_string = True
                continue
            if ch == "[":
                if depth == 0:
                    start = idx
                depth += 1
                continue
            if ch == "]":
                if depth > 0:
                    depth -= 1
                    if depth == 0 and start != -1:
                        return stripped[start : idx + 1]
                continue

    return text


def _salvage_truncated_json_array(candidate: str) -> str:
    """If the JSON array looks truncated, attempt to trim to the last complete object and close the array.

    Returns the salvaged array string or the original candidate if salvage is not possible.
    """

    if not isinstance(candidate, str):
        return candidate
    s = candidate.strip()
    if not s.startswith("["):
        return candidate

    in_string = False
    escape = False
    array_depth = 0
    object_depth = 0
    last_complete_obj_end = -1

    for idx, ch in enumerate(s):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        else:
            if ch == '"':
                in_string = True
                continue
            if ch == "[":
                array_depth += 1
                continue
            if ch == "]":
                array_depth -= 1
                if array_depth == 0:
                    last_complete_obj_end = idx
                    break
                continue
            if ch == "{":
                object_depth += 1
                continue
            if ch == "}":
                if object_depth > 0:
                    object_depth -= 1
                    # If we just closed a top-level object within the top-level array
                    if array_depth == 1 and object_depth == 0:
                        last_complete_obj_end = idx
                continue

    if last_complete_obj_end == -1:
        return candidate

    # Trim to last complete object and close array
    head = s[: last_complete_obj_end + 1]
    # Remove trailing commas/spaces after the object if any
    while len(head) and head[-1] in ", \n\r\t":
        head = head[:-1]
    return head + "]"


def generate_cards(pdf_content: List[Dict[str, Any]], examples: str = "") -> List[Dict[str, Any]]:
    """Generate Anki card specifications from parsed PDF content.

    Parameters:
        pdf_content: List of page dicts or PageContent-like objects with keys
            'text' and 'images' (list of bytes). The `pdf_parser.extract_content_from_pdf`
            function returns dataclasses, which can be converted to dicts using
            `dataclasses.asdict` by the caller if needed. For convenience, this
            function treats objects with attribute access as dict-compatible.
        examples: Optional few-shot examples string sampled from an existing deck.

    Returns:
        A list of card objects suitable for passing to the Anki connector:  
        [{
            'model_name': 'Basic' | 'Cloze',
            'fields': { 'Front': '...', 'Back': '...' } | { 'Text': '...' },
            'tags': ['lectern'],
            'media': [{ 'filename': 'slide-3.png', 'data': '<base64>' }] (optional)
        }]
    """

    if not config.GEMINI_API_KEY:
        # Fail fast with a clear error to help the user configure the app.
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

    # Debug logging of prompt and (later) response
    try:
        logs_dir = os.path.join(os.getcwd(), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
        log_path = os.path.join(logs_dir, f"generation-{ts}.json")
        # Build a redacted/loggable snapshot of parts (avoid dumping base64)
        loggable_parts: List[Dict[str, Any]] = []
        for part in content_parts:
            if "text" in part:
                txt = str(part.get("text", ""))
                loggable_parts.append({"text": txt[:20000]})
            elif "inline_data" in part:
                inline = part.get("inline_data", {}) or {}
                data_str = str(inline.get("data", ""))
                loggable_parts.append(
                    {
                        "inline_data": {
                            "mime_type": inline.get("mime_type", ""),
                            "data_len": len(data_str),
                        }
                    }
                )
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "timestamp_utc": ts,
                    "model": DEFAULT_MODEL_NAME,
                    "generation_config": generation_config,
                    "request": {"role": "user", "parts": loggable_parts},
                },
                f,
                ensure_ascii=False,
            )
    except Exception:
        # Logging is best-effort and should not break generation
        log_path = ""

    try:
        # Pass parts directly; SDK assembles the request for multimodal input
        response = model.generate_content(content_parts, request_options={"timeout": 180})
    except Exception as exc:  # Broad catch to surface a helpful message to the CLI
        raise RuntimeError(f"Gemini generation failed: {exc}")

    text = getattr(response, "text", None)
    if not text:
        # Try extracting from candidates/parts
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

    # Best-effort logging of the response text
    if log_path:
        try:
            with open(log_path, "r+", encoding="utf-8") as f:
                payload = json.load(f)
                payload["response_text"] = text
                f.seek(0)
                json.dump(payload, f, ensure_ascii=False)
                f.truncate()
        except Exception:
            pass

    try:
        extracted = _extract_json_array_string(text)
        try:
            data = json.loads(extracted)
        except json.JSONDecodeError:
            # Try salvage if truncated
            salvaged = _salvage_truncated_json_array(extracted)
            data = json.loads(salvaged)
    except json.JSONDecodeError:
        return []

    # Return the parsed list as-is (no normalization or default tag merging).
    # Normalization is handled by the CLI layer when creating notes.
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    # If the model wrapped the list, try extracting under a common key
    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        return [item for item in data.get("cards", []) if isinstance(item, dict)]

    return []


