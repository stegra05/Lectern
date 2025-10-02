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

import google.generativeai as genai  # type: ignore

import config


DEFAULT_MODEL_NAME = "gemini-2.5-pro"


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
        "- model_name: string (e.g., 'Basic' or 'Cloze')\n"
        "- fields: object mapping field names to strings (e.g., Front, Back, Text)\n"
        "- tags: array of strings\n"
        "- media: optional array of objects with 'filename' and 'data' (base64-encoded image)\n\n"
        "Do not include Markdown in field values unless present in the slide.\n"
        "If including media, choose short, unique filenames (e.g., 'slide-3-diagram.png').\n"
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

    model = genai.GenerativeModel(DEFAULT_MODEL_NAME)

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
        response = model.generate_content(content_parts)
    except Exception as exc:  # Broad catch to surface a helpful message to the CLI
        raise RuntimeError(f"Gemini generation failed: {exc}")

    text = getattr(response, "text", None)
    if not text:
        # Some SDK responses may keep candidates in a different structure.
        # As a safe default for the initial sketch, return an empty list.
        return []

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # If the model returns non-JSON or pre/post text, attempt to locate the first JSON array
        # For the initial sketch, prefer failing gracefully.
        return []

    if isinstance(data, list):
        return data
    # If the model wrapped the list, try extracting under a common key
    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        return data["cards"]

    return []


