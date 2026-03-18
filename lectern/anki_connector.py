"""
AnkiConnect communication helpers.

This module provides a thin, typed wrapper around the AnkiConnect HTTP API to
add notes to Anki. It never manipulates the collection directly.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import random
from typing import Any, Callable, Dict, List, Literal, Optional, TypeVar, TypedDict

import httpx

from lectern import config as _config

logger = logging.getLogger(__name__)


# --- Exception Hierarchy ---


class AnkiConnectError(RuntimeError):
    """Base exception for all AnkiConnect errors."""

    def __init__(self, message: str, *, retriable: bool = False) -> None:
        super().__init__(message)
        self.retriable = retriable


class AnkiTransportError(AnkiConnectError):
    """Error occurred at the transport level (connection, network, timeout).

    These errors are retriable - AnkiConnect may be temporarily unavailable.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, retriable=True)


class AnkiApiError(AnkiConnectError):
    """Error returned by AnkiConnect API (e.g., invalid action, deck not found).

    These errors are not retriable - the request itself is invalid.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, retriable=False)


class SyncFailureDetails(TypedDict):
    failure_kind: Literal["transport", "api", "card_validation"]
    severity: Literal["error", "warning"]
    detail: str
    hint: str


_SYNC_FAILURE_HINTS: Dict[Literal["transport", "api", "card_validation"], str] = {
    "transport": "Check that Anki is running with AnkiConnect enabled, then retry sync.",
    "api": "Check deck and note type settings in Anki, then retry sync.",
    "card_validation": "Review the card payload fields before syncing again.",
}


def _classify_sync_failure_kind(
    error: Exception | str | None, detail: str
) -> Literal["transport", "api", "card_validation"]:
    if isinstance(error, AnkiTransportError):
        return "transport"
    if isinstance(error, AnkiApiError):
        return "api"
    if isinstance(error, (ValueError, TypeError, KeyError)):
        return "card_validation"

    lowered = detail.lower()
    transport_markers = (
        "failed to reach ankiconnect",
        "connection refused",
        "connect timeout",
        "read timeout",
        "timed out",
        "non-json response",
        "http error",
    )
    card_validation_markers = (
        "invalid literal for int",
        "missing field",
        "missing required",
        "payload",
        "field",
    )
    api_markers = (
        "ankiconnect error for",
        "deck not found",
        "model",
        "unexpected addnote result",
    )

    if any(marker in lowered for marker in transport_markers):
        return "transport"
    if any(marker in lowered for marker in card_validation_markers):
        return "card_validation"
    if any(marker in lowered for marker in api_markers):
        return "api"
    return "api"


def classify_sync_failure(error: Exception | str | None) -> SyncFailureDetails:
    detail = str(error or "").strip() or "Unknown sync failure"
    failure_kind = _classify_sync_failure_kind(error, detail)
    severity: Literal["error", "warning"] = (
        "warning" if failure_kind == "card_validation" else "error"
    )
    return {
        "failure_kind": failure_kind,
        "severity": severity,
        "detail": detail,
        "hint": _SYNC_FAILURE_HINTS[failure_kind],
    }


# Caches for model field detection (lifecycle of the app)
_MODEL_FIELD_CACHE: Dict[str, List[str]] = {}
_MODEL_DETECTION_CACHE: Optional[Dict[str, str]] = None


def clear_model_caches() -> None:
    """Clear model field and detection caches.

    Call this when Anki's model configuration may have changed (e.g., after
    user modifies note types in Anki).
    """
    global _MODEL_DETECTION_CACHE
    _MODEL_FIELD_CACHE.clear()
    _MODEL_DETECTION_CACHE = None


# Retry configuration
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 0.5  # seconds
MAX_RETRY_DELAY = 4.0  # seconds

F = TypeVar("F", bound=Callable[..., Any])


def _with_retry(
    max_retries: int = MAX_RETRIES, initial_delay: float = INITIAL_RETRY_DELAY
) -> Callable[[F], F]:
    """Decorator that adds exponential backoff retry logic for transport errors.

    Only retries on AnkiTransportError (connection-level errors).
    AnkiApiError and other exceptions fail immediately.
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Optional[AnkiTransportError] = None
            delay = initial_delay
            retried_attempts = 0

            for attempt in range(max_retries + 1):
                try:
                    result = await func(*args, **kwargs)
                    if retried_attempts > 0:
                        logger.info(
                            "AnkiConnect recovered after %d retr%s.",
                            retried_attempts,
                            "y" if retried_attempts == 1 else "ies",
                        )
                    return result
                except AnkiTransportError as e:
                    # Transport errors are retriable
                    last_exception = e
                    if attempt < max_retries:
                        retried_attempts += 1
                        if attempt == 0:
                            logger.warning(
                                "AnkiConnect connection failed, retrying up to %d time%s (initial backoff %.1fs): %s",
                                max_retries,
                                "" if max_retries == 1 else "s",
                                delay,
                                e,
                            )
                        else:
                            logger.debug(
                                "AnkiConnect retry %d/%d in %.1fs.",
                                attempt + 1,
                                max_retries,
                                delay,
                            )
                        await asyncio.sleep(delay)
                        delay = min(delay * 2, MAX_RETRY_DELAY)
                        continue
                    # Final attempt exhausted - re-raise
                    raise
                except AnkiApiError:
                    # API-level errors are not retriable - raise immediately
                    raise

            # All retries exhausted
            if last_exception:
                raise last_exception
            raise RuntimeError("Exhausted retries without an error.")  # fallback

        return wrapper  # type: ignore

    return decorator


async def _invoke_once(
    action: str, params: Optional[Dict[str, Any]] = None, timeout: int = 15
) -> Any:
    """Invoke an AnkiConnect action with the given parameters.

    Raises:
        AnkiTransportError: If the connection fails (retried with exponential backoff).
        AnkiApiError: If AnkiConnect returns an API-level error.
    """
    payload = {"action": action, "version": 6}
    if params is not None:
        payload["params"] = params

    url = _config.ANKI_CONNECT_URL
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=timeout)
            response.raise_for_status()
    except httpx.RequestError as exc:
        raise AnkiTransportError(
            f"Failed to reach AnkiConnect at {url}: {exc}"
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise AnkiTransportError(
            f"AnkiConnect returned HTTP error {exc.response.status_code}: {exc}"
        ) from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise AnkiTransportError(
            f"AnkiConnect returned non-JSON response: {exc}"
        ) from exc

    if data.get("error") is not None:
        raise AnkiApiError(f"AnkiConnect error for {action}: {data['error']}")

    return data.get("result")


@_with_retry()
async def _invoke(
    action: str, params: Optional[Dict[str, Any]] = None, timeout: int = 15
) -> Any:
    """Invoke AnkiConnect action with retry behavior for transport failures."""
    return await _invoke_once(action=action, params=params, timeout=timeout)


# Minimum supported AnkiConnect version
MIN_ANKICONNECT_VERSION = 6


async def check_connection() -> bool:
    """Return True if AnkiConnect is reachable and responding.

    NOTE(HealthProbe): This is used by high-frequency health polling and CI
    readiness checks. It intentionally performs a single probe (no retry
    backoff) so `/health` remains responsive when Anki is offline.
    """

    try:
        await _invoke_once("version", None, timeout=1)
        return True
    except Exception:
        return False


async def get_connection_info() -> Dict[str, Any]:
    """Get detailed AnkiConnect connection information.

    Returns a dict with:
        - connected: bool
        - version: int or None
        - version_ok: bool (True if version >= MIN_ANKICONNECT_VERSION)
        - collection_available: bool (True if deckNames succeeds)
        - error_kind: str or None ('transport', 'api', 'unknown')
        - error: str or None
    """
    result: Dict[str, Any] = {
        "connected": False,
        "version": None,
        "version_ok": False,
        "collection_available": False,
        "error_kind": None,
        "error": None,
    }

    try:
        version = await _invoke_once("version", None, timeout=3)
        result["version"] = version
        result["version_ok"] = (
            isinstance(version, int) and version >= MIN_ANKICONNECT_VERSION
        )
        result["connected"] = True

        if not result["version_ok"]:
            result["error"] = (
                f"AnkiConnect version {version} is too old. Minimum required: {MIN_ANKICONNECT_VERSION}"
            )
            result["error_kind"] = "api"
            return result

        # Check collection readiness separately; this catches states like
        # "collection is not available" even when version endpoint works.
        await _invoke_once("deckNames", None, timeout=3)
        result["collection_available"] = True

    except AnkiTransportError as e:
        result["error"] = str(e)
        result["error_kind"] = "transport"
    except AnkiApiError as e:
        result["error"] = str(e)
        result["error_kind"] = "api"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"
        result["error_kind"] = "unknown"

    return result


async def add_note(
    deck_name: str, model_name: str, fields: Dict[str, str], tags: List[str]
) -> int:
    """Add a single note to Anki via AnkiConnect."""

    note = {
        "deckName": deck_name,
        "modelName": model_name,
        "fields": fields,
        "options": {"allowDuplicate": False},
        "tags": tags,
    }

    result = await _invoke("addNote", {"note": note})
    if not isinstance(result, int):
        raise AnkiApiError(f"Unexpected addNote result: {result}")
    return result


async def update_note_fields(note_id: int, fields: Dict[str, str]) -> None:
    """Update fields of an existing Anki note via AnkiConnect."""
    await _invoke("updateNoteFields", {"note": {"id": note_id, "fields": fields}})


async def delete_notes(note_ids: List[int]) -> None:
    """Delete notes from Anki by their IDs via AnkiConnect."""
    await _invoke("deleteNotes", {"notes": note_ids})


def _escape_query_value(value: str) -> str:
    """Escape a value for inclusion in an AnkiConnect search query string."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


async def find_notes(query: str) -> List[int]:
    """Find note IDs matching an Anki search query string."""

    result = await _invoke("findNotes", {"query": query})
    if not isinstance(result, list):
        return []
    return [
        int(nid)
        for nid in result
        if isinstance(nid, int) or (isinstance(nid, str) and str(nid).isdigit())
    ]


async def notes_info(note_ids: List[int]) -> List[Dict[str, Any]]:
    """Return notesInfo for the given note IDs."""

    if not note_ids:
        return []
    result = await _invoke("notesInfo", {"notes": note_ids})
    if not isinstance(result, list):
        return []
    return [ri for ri in result if isinstance(ri, dict)]


async def get_all_tags() -> List[str]:
    """Fetch all tags from Anki via AnkiConnect."""
    try:
        result = await _invoke("getTags")
        if isinstance(result, list):
            return [str(t) for t in result]
        return []
    except Exception as exc:
        logger.warning("Failed to fetch Anki tags: %s", exc)
        return []


async def get_deck_names() -> List[str]:
    """Fetch all deck names from Anki via AnkiConnect."""
    try:
        result = await _invoke("deckNames")
        if isinstance(result, list):
            return [str(name) for name in result]
        return []
    except Exception as exc:
        logger.warning("Failed to fetch Anki deck names: %s", exc)
        return []


async def get_model_names() -> List[str]:
    """Fetch all note-type (model) names from Anki via AnkiConnect."""
    try:
        result = await _invoke("modelNames")
        if isinstance(result, list):
            return [str(name) for name in result]
        return []
    except Exception as exc:
        logger.warning("Failed to fetch Anki model names: %s", exc)
        return []


async def get_model_field_names(model_name: str) -> List[str]:
    """Fetch field names for a specific Anki note type/model (cached)."""
    if model_name in _MODEL_FIELD_CACHE:
        return _MODEL_FIELD_CACHE[model_name]
    try:
        result = await _invoke("modelFieldNames", {"modelName": model_name})
        if isinstance(result, list):
            fields = [str(name) for name in result]
            _MODEL_FIELD_CACHE[model_name] = fields
            return fields
        return []
    except Exception as exc:
        logger.warning("Failed to fetch fields for model '%s': %s", model_name, exc)
        return []


async def detect_builtin_models() -> Dict[str, str]:
    """Auto-detect localized names for Anki's built-in 'Basic' and 'Cloze' models."""
    global _MODEL_DETECTION_CACHE
    if _MODEL_DETECTION_CACHE is not None:
        return _MODEL_DETECTION_CACHE

    detected = {"basic": "Basic", "cloze": "Cloze"}
    found_canonical_basic = False
    found_canonical_cloze = False

    models = await get_model_names()
    if not models:
        _MODEL_DETECTION_CACHE = detected
        return detected

    for name in models:
        fields = await get_model_field_names(name)
        field_set = {f.strip() for f in fields}

        # Basic signature: contains Front and Back
        if "Front" in field_set and "Back" in field_set:
            if name == "Basic":
                detected["basic"] = name
                found_canonical_basic = True
            elif not found_canonical_basic:
                detected["basic"] = name

        # Cloze signature: contains Text (and usually no Front/Back)
        if "Text" in field_set and "Front" not in field_set:
            if name == "Cloze":
                detected["cloze"] = name
                found_canonical_cloze = True
            elif not found_canonical_cloze:
                detected["cloze"] = name

    _MODEL_DETECTION_CACHE = detected
    return detected


async def create_deck(deck_name: str) -> bool:
    """Create a new deck in Anki via AnkiConnect."""
    try:
        result = await _invoke("createDeck", {"deck": deck_name})
        return isinstance(result, int)
    except Exception as exc:
        logger.warning("Failed to create deck '%s': %s", deck_name, exc)
        return False


async def sample_examples_from_deck(deck_name: str, sample_size: int = 5) -> str:
    """Sample a few notes' fields from a deck via AnkiConnect and format as examples."""

    try:
        deck = _escape_query_value(deck_name)
        query = f'deck:"{deck}"'
        ids = await find_notes(query)
        if not ids:
            return ""
        if len(ids) > sample_size:
            ids = random.sample(ids, sample_size)
        else:
            ids = ids[:sample_size]
        infos = await notes_info(ids)
        if not infos:
            return ""

        lines: List[str] = []
        for idx, info in enumerate(infos, start=1):
            fields_obj = info.get("fields", {})
            model_name = str(info.get("modelName") or "Card").strip()
            field_lines: List[str] = []
            for field_name, field in fields_obj.items():
                if not isinstance(field, dict):
                    continue
                value = str(field.get("value", "") or "").strip()
                if not value:
                    continue
                compact_value = " ".join(value.split())
                field_lines.append(f"  {field_name}: {compact_value[:180]}")
            if not field_lines:
                continue
            lines.append(f"Example {idx} ({model_name}):")
            lines.extend(field_lines[:4])
            lines.append("")
        return "\n".join(lines).strip()
    except Exception as exc:
        logger.warning("Failed to sample examples from deck '%s': %s", deck_name, exc)
        return ""
