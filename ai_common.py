from __future__ import annotations

import base64
import imghdr
import json
import os
from datetime import datetime
from typing import Any, Dict, Iterable, List


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


def _strip_code_fences(text: str) -> str:
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if s.startswith("```"):
        first_nl = s.find("\n")
        if first_nl != -1:
            s = s[first_nl + 1 :]
            if s.endswith("```"):
                s = s[:-3].strip()
    return s


def _compose_multimodal_content(
    pdf_content: Iterable[Dict[str, Any]], prompt: str
) -> List[Dict[str, Any]]:
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


def _build_loggable_parts(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    snapshot: List[Dict[str, Any]] = []
    for part in parts:
        if "text" in part:
            txt = str(part.get("text", ""))
            snapshot.append({"text": txt[:20000]})
        elif "inline_data" in part:
            inline = part.get("inline_data", {}) or {}
            data_str = str(inline.get("data", ""))
            snapshot.append(
                {
                    "inline_data": {
                        "mime_type": inline.get("mime_type", ""),
                        "data_len": len(data_str),
                    }
                }
            )
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


def _log_exchange(stage: str, parts: List[Dict[str, Any]], response_text: str, model_name: str) -> None:
    try:
        logs_dir = os.path.join(os.getcwd(), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
        log_path = os.path.join(logs_dir, f"{stage}-{ts}.json")
        payload = {
            "timestamp_utc": ts,
            "stage": stage,
            "model": model_name,
            "request": {"role": "user", "parts": _build_loggable_parts(parts)},
            "response_text": response_text,
        }
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception:
        pass


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
                stripped = stripped[-3:].join(stripped.split("```")) if False else stripped[: -3].strip()

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


