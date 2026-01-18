from __future__ import annotations

import base64
import json
import os
from datetime import datetime
from typing import Any, Dict, Iterable, List


LATEX_STYLE_GUIDE = (
    "Formatting policy:\n"
    "- Use LaTeX/MathJax for math: inline with \\( ... \\), display with \\[ ... \\].\n"
    "- Use HTML for non-math emphasis: <b>...</b> or <strong>...</strong>; italics with <i>...</i> or <em>...</em>.\n"
    "- For math bold: \\textbf{...} (text), \\mathbf{...} or \\boldsymbol{...} (symbols). Do not use HTML inside math.\n"
    "- Never use Markdown (no **bold**, headers, or code fences).\n"
    "- JSON must escape backslashes (e.g., \\\\frac, \\\\alpha).\n"
    "Examples:\n"
    '  Basic: {"model_name":"Basic","fields":{"Front":"State the quadratic formula.", '
    '"Back":"Key idea: <b>roots</b>. Formula: \\(x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}\\)."},"tags":["algebra"]}\n'
    '  Cloze: {"model_name":"Cloze","fields":{"Text":"The derivative of \\(x^n\\) is '
    '{{c1::\\(n x^{n-1}\\)}}."},"tags":["calculus"]}\n'
)

# NOTE(Exam-Prep): Optional context for exam-focused card generation.
# Prioritizes understanding and application over rote memorization.
# Activate by setting EXAM_MODE=true in environment.
EXAM_PREP_CONTEXT = (
    "EXAM PREPARATION MODE:\n"
    "You are generating flashcards for a university exam that tests UNDERSTANDING, not memorization.\n"
    "The exam format is 40% MCQ + 60% written conceptual questions.\n"
    "\n"
    "CARD TYPE PRIORITIES (generate in this ratio):\n"
    "1. COMPARISON cards (30%): 'Compare A vs B in terms of [property]' or 'What is the difference between X and Y?'\n"
    "   Example: Front='Compare K-Means vs DBSCAN', Back='K-Means: requires K, spherical clusters. DBSCAN: no K, arbitrary shapes, handles outliers.'\n"
    "2. APPLICATION cards (25%): 'Given [scenario], which method would you use and why?' or 'Your model shows [symptom], what is the issue?'\n"
    "   Example: Front='Training loss decreasing but validation loss increasing. Diagnosis?', Back='Overfitting. Solutions: regularization, more data, simpler model.'\n"
    "3. INTUITION cards (25%): 'Explain [concept] in your own words' or 'Why does [thing] work?'\n"
    "   Example: Front='Why do Random Forests outperform single Decision Trees?', Back='Bagging + feature randomness reduce variance. Diverse trees make different errors that cancel out.'\n"
    "4. DEFINITION cards (20%): Only for core terminology that must be precisely understood.\n"
    "\n"
    "CRITICAL RULES:\n"
    "- NEVER create cards that ask to recite formulas verbatim (e.g., 'What is the MSE formula?')\n"
    "- NEVER create cards with single-word answers\n"
    "- ALWAYS test transferable understanding, not surface recall\n"
    "- Focus on the 'why' and 'when to use', not the 'what'\n"
    "\n"
)

# NOTE(Exam-Prep): Specialized reflection prompt for exam mode.
# Ensures reflection phase doesn't degrade application/comparison cards into simple definitions.
EXAM_REFLECTION_CONTEXT = (
    "EXAM MODE REFLECTION:\n"
    "You are reviewing cards for university exam preparation. The exam tests UNDERSTANDING, not memorization.\n"
    "\n"
    "REFLECTION PRIORITIES:\n"
    "1. PRESERVE card type distribution: Aim for 30% comparison, 25% application, 25% intuition, 20% definition.\n"
    "2. DO NOT simplify application/comparison cards into definitions. If a card asks 'Compare X vs Y', keep it that way.\n"
    "3. ENHANCE scenario-based cards: Make 'Given [situation]...' cards more realistic and multi-step.\n"
    "4. ADD missing comparisons: If the material contrasts two methods/concepts, there should be a comparison card.\n"
    "5. CHECK for conceptual gaps: Identify 'why does this work?' intuition cards that are missing.\n"
    "\n"
    "RED FLAGS TO FIX:\n"
    "- Cards that ask to recite a formula verbatim\n"
    "- Single-word or trivial answers\n"
    "- Duplicate cards covering the same comparison from different angles (consolidate them)\n"
    "- Definition cards for concepts that would be better tested via application\n"
    "\n"
)

def _infer_mime_type(image_bytes: bytes) -> str:
    """Best-effort inference of image MIME type from raw bytes.

    Falls back to application/octet-stream when type is unknown.
    """
    if image_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
        return "image/png"
    if image_bytes.startswith(b'\xff\xd8\xff'):
        return "image/jpeg"
    if image_bytes.startswith(b'GIF87a') or image_bytes.startswith(b'GIF89a'):
        return "image/gif"
    if image_bytes.startswith(b'RIFF') and image_bytes[8:12] == b'WEBP':
        return "image/webp"
    return "application/octet-stream"





from google.genai import types # type: ignore

def _compose_multimodal_content(
    pdf_content: Iterable[Dict[str, Any]], prompt: str
) -> List[Any]:
    """Compose the list of content parts for Gemini from parsed pages.

    Expects each page item to expose 'text' and 'images' (list of bytes).
    """

    parts: List[Any] = [prompt]
    for page in pdf_content:
        page_text = str(page.get("text", ""))
        if page_text.strip():
            parts.append(f"Slide text:\n{page_text}")
        for image_bytes in page.get("images", []) or []:
            mime = _infer_mime_type(image_bytes)
            # Use Part.from_bytes for google-genai
            parts.append(
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime
                )
            )
    return parts


def _build_loggable_parts(parts: List[Any]) -> List[Dict[str, Any]]:
    snapshot: List[Dict[str, Any]] = []
    for part in parts:
        if isinstance(part, str):
            snapshot.append({"text": part[:20000]})
        elif hasattr(part, "text") and part.text:
            snapshot.append({"text": part.text[:20000]})
        elif hasattr(part, "inline_data") and part.inline_data:
            inline = part.inline_data
            snapshot.append(
                {
                    "inline_data": {
                        "mime_type": inline.mime_type,
                        "data_len": len(inline.data) if inline.data else 0,
                    }
                }
            )
        elif isinstance(part, dict):
            # Fallback for dicts if any remain
            if "text" in part:
                snapshot.append({"text": part["text"][:20000]})
            elif "inline_data" in part:
                inline = part["inline_data"]
                snapshot.append({"inline_data": {"mime_type": inline.get("mime_type"), "data_len": len(inline.get("data", ""))}})
    return snapshot


def _start_session_log() -> str:
    try:
        logs_dir = os.path.join(os.getcwd(), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
        log_path = os.path.join(logs_dir, f"session-{ts}.json")
        header = {
            "timestamp_utc": ts,
            "exchanges": [],
        }
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(header, f, ensure_ascii=False)
        return log_path
    except Exception:
        return ""


def _append_session_log(
    log_path: str, stage: str, parts: List[Dict[str, Any]], response_text: str, schema_used: bool
) -> None:
    if not log_path:
        return
    try:
        with open(log_path, "r+", encoding="utf-8") as f:
            payload = json.load(f)
            exchanges = payload.get("exchanges", [])
            exchanges.append(
                {
                    "stage": stage,
                    "schema_used": schema_used,
                    "request": {"role": "user", "parts": _build_loggable_parts(parts)},
                    "response_text": response_text,
                }
            )
            payload["exchanges"] = exchanges
            f.seek(0)
            json.dump(payload, f, ensure_ascii=False)
            f.truncate()
    except Exception:
        pass




