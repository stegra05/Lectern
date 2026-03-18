from __future__ import annotations

import json
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Dict, Iterable, List

from google.genai import types  # type: ignore

from lectern import config


def _infer_mime_type(image_bytes: bytes) -> str:
    """Best-effort inference of image MIME type from raw bytes.

    Falls back to application/octet-stream when type is unknown.
    """
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "image/gif"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


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
            parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime))
    return parts


def _compose_native_file_content(
    file_uri: str, prompt: str, mime_type: str = "application/pdf"
) -> List[Any]:
    """Compose Gemini content parts from an uploaded file URI."""
    return [
        prompt,
        types.Part.from_uri(file_uri=file_uri, mime_type=mime_type),
    ]


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
        elif hasattr(part, "file_data") and part.file_data:
            file_data = part.file_data
            snapshot.append(
                {
                    "file_data": {
                        "mime_type": file_data.mime_type,
                        "file_uri": file_data.file_uri,
                    }
                }
            )
        elif isinstance(part, dict):
            # Fallback for dicts if any remain
            if "text" in part:
                snapshot.append({"text": part["text"][:20000]})
            elif "inline_data" in part:
                inline = part["inline_data"]
                snapshot.append(
                    {
                        "inline_data": {
                            "mime_type": inline.get("mime_type"),
                            "data_len": len(inline.get("data", "")),
                        }
                    }
                )
    return snapshot


def _start_session_log() -> str:
    if not getattr(config, "LOG_SESSION_CONTENT", True):
        return ""
    try:
        from lectern.utils.path_utils import get_app_data_dir

        logs_dir = get_app_data_dir() / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        _cleanup_stale_empty_session_logs(logs_dir)
        ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
        # Delay file creation until first append to avoid persistent empty logs.
        return str(logs_dir / f"session-{ts}.json")
    except Exception:
        return ""


def _cleanup_stale_empty_session_logs(
    logs_dir: Path, max_age_seconds: int = 24 * 60 * 60
) -> None:
    """Best-effort cleanup for stale empty session logs."""
    now_ts = datetime.now(UTC).timestamp()
    for path in logs_dir.glob("session-*.json"):
        try:
            stat = path.stat()
            if now_ts - stat.st_mtime < max_age_seconds:
                continue
            # Empty exchange files are small; skip larger logs quickly.
            if stat.st_size > 1024:
                continue
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            exchanges = payload.get("exchanges", [])
            if isinstance(exchanges, list) and not exchanges:
                path.unlink(missing_ok=True)
        except Exception:
            continue


def _append_session_log(
    log_path: str,
    stage: str,
    parts: List[Dict[str, Any]],
    response_text: str,
    schema_used: bool,
) -> None:
    if not log_path:
        return
    if not getattr(config, "LOG_SESSION_CONTENT", True):
        return
    # NOTE(Thread-Safety): Safe because each session creates a unique log file via
    # _start_session_log(). If concurrent sessions ever share a log path, add a
    # filelock here to prevent read-modify-write corruption.
    try:
        max_response_chars = getattr(config, "LOG_MAX_RESPONSE_CHARS", 20000)
        truncated_response = response_text[:max_response_chars] if response_text else ""
        with open(log_path, "a+", encoding="utf-8") as f:
            f.seek(0)
            existing = f.read().strip()
            if existing:
                payload = json.loads(existing)
            else:
                payload = {
                    "timestamp_utc": datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f"),
                    "exchanges": [],
                }
            exchanges = payload.get("exchanges", [])
            exchanges.append(
                {
                    "timestamp_utc": datetime.now(UTC).isoformat(),
                    "stage": stage,
                    "schema_used": schema_used,
                    "request": {"role": "user", "parts": _build_loggable_parts(parts)},
                    "response_text": truncated_response,
                }
            )
            payload["exchanges"] = exchanges
            f.seek(0)
            json.dump(payload, f, ensure_ascii=False)
            f.truncate()
    except Exception:
        pass
