from __future__ import annotations

import base64
import json
import os
from datetime import datetime, UTC
from typing import Any, Dict, Iterable, List


LATEX_STYLE_GUIDE = (
    "Formatting policy:\n"
    "- Use LaTeX/MathJax for math: inline with \\( ... \\), display with \\[ ... \\].\n"
    "- Use HTML for non-math emphasis: <b>...</b> or <strong>...</strong>; italics with <i>...</i> or <em>...</em>.\n"
    "- For math bold: \\textbf{...} (text), \\mathbf{...} or \\boldsymbol{...} (symbols). Do not use HTML inside math.\n"
    "- Never use Markdown (no **bold**, headers, or code fences).\n"
    "- JSON must escape backslashes (e.g., \\\\frac, \\\\alpha).\n"
)

BASIC_EXAMPLES = (
    "Examples:\n"
    '  Basic: {"model_name":"Basic","fields":{"Front":"State the quadratic formula.", '
    '"Back":"Key idea: <b>roots</b>. Formula: \\(x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}\\)."},"tags":["algebra"]}\n'
    '  Cloze: {"model_name":"Cloze","fields":{"Text":"The derivative of \\(x^n\\) is '
    '{{c1::\\(n x^{n-1}\\)}}."},"tags":["calculus"]}\n'
)

EXAM_EXAMPLES = (
    "Examples (Exam Mode):\n"
    '  Scenario: {"model_name":"Basic","fields":{"Front":"Loss oscillates wildly during training. What is the most likely cause?", '
    '"Back":"<b>Learning rate is too high</b>. The steps overshoot the minimum."}, "tags":["optimization"]}\n'
    '  Comparison: {"model_name":"Basic","fields":{"Front":"Compare <b>L1</b> and <b>L2</b> regularization effects.", '
    '"Back":"<b>L1</b>: Yields sparse weights (feature selection).\\n<b>L2</b>: Shrinks all weights uniformly (prevents overfitting)."}, "tags":["regularization"]}\n'
)

# NOTE(Exam-Prep): Optional context for exam-focused card generation.
# Prioritizes understanding and application over rote memorization.
# Activate by setting EXAM_MODE=true in environment.
EXAM_PREP_CONTEXT = (
    "EXAM CRAM MODE (HIGH YIELD ONLY):\n"
    "You are generating flashcards for a high-stakes university exam in 8 days. Time is limited.\n"
    "IGNORE basic definitions, trivial facts, and simple lists. Focus ONLY on what distinguishes concepts.\n"
    "\n"
    "CARD TYPE PRIORITIES (Strict Ratio):\n"
    "1. SCENARIO / APPLICATION (50%): 'Given [situation], what is the problem/solution?'\n"
    "   - Real-world diagnosis (e.g., 'Loss is oscillating. Why? -> Learning rate too high.')\n"
    "   - Design choices (e.g., 'Small dataset, high dims. Which model? -> Linear/Ridge, not Neural Net.')\n"
    "2. COMPARISON / CONTRAST (40%): 'Compare X vs Y'.\n"
    "   - Nuance is key. (e.g., 'L1 vs L2 regularization: L1 yields sparsity/feature selection; L2 shrinks all weights.')\n"
    "3. DEEP INTUITION (10%): 'Why does this mechanism work?'\n"
    "   - (e.g., 'Why does adding noise to inputs act as regularization? -> Smooths the decision boundary.')\n"
    "\n"
    "CRITICAL FILTERING RULES (DENSITY HEURISTIC):\n"
    "- TIERED GENERATION LOGIC (Strictly Follow):\n"
    "   * SPARSE SLIDES (Titles, Transitions, Image-only): Generate 0-1 card maximum.\n"
    "   * STANDARD SLIDES (Bullet points, basic definitions): Generate Max 2 cards.\n"
    "   * DENSE SLIDES (Walls of text, complex diagrams, multi-step proofs): Generate Max 3 cards.\n"
    "- GLOBAL TARGET: Average ~0.9 cards per slide. Quality > Quantity.\n"
    "- SYNTHESIZE: Combine related bullet points into one robust card. Do NOT make 1 card per bullet.\n"
    "- REJECT: 'What is X?' (Unless X is a highly complex, non-obvious concept).\n"
    "- REJECT: Formulas without context. (Instead: 'How does term X in the formula affect the output?')\n"
    "- REJECT: Slide headers or table of contents items.\n"
    "- REJECT: Anything obvious to a attentive student (e.g., 'Supervised learning uses labels').\n"
    "\n"
)

# NOTE(Exam-Prep): Specialized reflection prompt for exam mode.
# Ensures reflection phase doesn't degrade application/comparison cards into simple definitions.
EXAM_REFLECTION_CONTEXT = (
    "EXAM CRAM REFLECTION:\n"
    "You are a ruthless tutor preparing a student for a hard exam in 8 days.\n"
    "Review the generated cards. DELETE/REWRITE any that are 'fluff' or low-yield.\n"
    "\n"
    "QUALITY CHECKS:\n"
    "1. IS IT TRIVIAL? -> Delete it. (e.g. 'ML stands for Machine Learning')\n"
    "2. IS IT ISOLATED? -> Connect it. (Don't just define 'Stride'; ask 'How does Stride=2 affect output size vs Stride=1?')\n"
    "3. IS IT A FORMULA? -> converting to Intuition. (Don't ask to type the Softmax formula; ask why it's used over standard normalization for probabilities.)\n"
    "\n"
    "ACTION:\n"
    "- If the batch is too simple, rewrite the cards to be scenario-based.\n"
    "- Consolidate multiple simple cards into one robust comparison card.\n"
    "- Ensure the 50% Application / 40% Comparison ratio is met.\n"
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
        home_dir = os.path.expanduser("~")
        logs_dir = os.path.join(home_dir, "Library", "Application Support", "Lectern", "logs")
        os.makedirs(logs_dir, exist_ok=True)
        ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
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




