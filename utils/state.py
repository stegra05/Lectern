
import json
import logging
import os
import tempfile
from typing import Dict, Any, List, Optional

STATE_FILENAME = "lectern_state.json"
STATE_VERSION = 1
LEGACY_STATE_FILE = ".lectern_state.json"

from utils.path_utils import get_app_data_dir

logger = logging.getLogger(__name__)

def _get_state_path(session_id: Optional[str] = None) -> str:
    state_dir = get_app_data_dir() / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    if session_id:
        filename = f"session-{session_id}.json"
    else:
        filename = STATE_FILENAME
    return str(state_dir / filename)

def save_state(
    pdf_path: str,
    deck_name: str,
    cards: List[Dict[str, Any]],
    concept_map: Dict[str, Any],
    history: List[Dict[str, Any]],
    log_path: str,
    session_id: Optional[str] = None,
    slide_set_name: Optional[str] = None,
    model_name: Optional[str] = None,
    tags: Optional[List[str]] = None,
    entry_id: Optional[str] = None,
) -> bool:
    """Save the current session state to a JSON file."""
    state = {
        "version": STATE_VERSION,
        "pdf_path": pdf_path,
        "deck_name": deck_name,
        "cards": cards,
        "concept_map": concept_map,
        "history": history,
        "log_path": log_path,
        "slide_set_name": slide_set_name,
        "model_name": model_name,
        "tags": tags,
        "entry_id": entry_id,
    }
    try:
        state_path = _get_state_path(session_id)
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", dir=os.path.dirname(state_path)) as tmp:
            json.dump(state, tmp, ensure_ascii=False)
            temp_path = tmp.name
        os.replace(temp_path, state_path)
        return True
    except Exception:
        logger.exception("Failed to save state for session %s", session_id)
        return False

def _save_state_dict(state: Dict[str, Any], session_id: Optional[str]) -> bool:
    pdf_path = state.get("pdf_path")
    deck_name = state.get("deck_name")
    cards = state.get("cards")
    concept_map = state.get("concept_map", {})
    history = state.get("history", [])
    log_path = state.get("log_path", "")
    if not pdf_path or not deck_name or cards is None:
        return False
    return save_state(
        pdf_path=pdf_path,
        deck_name=deck_name,
        cards=cards,
        concept_map=concept_map,
        history=history,
        log_path=log_path,
        session_id=session_id,
        slide_set_name=state.get("slide_set_name"),
        model_name=state.get("model_name"),
        tags=state.get("tags"),
        entry_id=state.get("entry_id"),
    )

class StateFile:
    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id

    def load(self) -> Optional[Dict[str, Any]]:
        return load_state(self.session_id)

    def update_cards(self, cards: List[Dict[str, Any]], **overrides: Any) -> bool:
        state = self.load()
        if not state:
            return False
        state.update(overrides)
        state["cards"] = cards
        state["version"] = STATE_VERSION
        return _save_state_dict(state, self.session_id)

    def update_fields(self, **overrides: Any) -> bool:
        state = self.load()
        if not state:
            return False
        state.update(overrides)
        state["version"] = STATE_VERSION
        return _save_state_dict(state, self.session_id)

def resolve_state(
    session_id: Optional[str],
    *,
    fallback: Optional[Dict[str, Any]] = None,
    state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Load state from disk and merge with fallback defaults."""
    if state is None:
        state = StateFile(session_id).load() or {}
    if fallback:
        return {**fallback, **state}
    return dict(state)

def resolve_state_context(
    session_id: Optional[str],
    *,
    fallback: Optional[Dict[str, Any]] = None,
    state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return a safe, normalized snapshot of state fields."""
    merged = resolve_state(session_id, fallback=fallback, state=state)
    return {
        "state": merged,
        "cards": merged.get("cards") or [],
        "deck_name": merged.get("deck_name"),
        "slide_set_name": merged.get("slide_set_name"),
        "model_name": merged.get("model_name"),
        "tags": merged.get("tags") or [],
        "entry_id": merged.get("entry_id"),
    }

def load_state(session_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Load the session state from the JSON file if it exists."""
    state_path = _get_state_path(session_id)
    if not os.path.exists(state_path):
        if session_id is None and os.path.exists(LEGACY_STATE_FILE):
            try:
                with open(LEGACY_STATE_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None
        return None
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def clear_state(session_id: Optional[str] = None) -> None:
    """Remove the state file."""
    state_path = _get_state_path(session_id)
    if os.path.exists(state_path):
        try:
            os.remove(state_path)
        except Exception:
            pass
    if session_id is None and os.path.exists(LEGACY_STATE_FILE):
        try:
            os.remove(LEGACY_STATE_FILE)
        except Exception:
            pass
