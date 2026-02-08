
import json
import os
import tempfile
from typing import Dict, Any, List, Optional

STATE_FILENAME = "lectern_state.json"
LEGACY_STATE_FILE = ".lectern_state.json"

from utils.path_utils import get_app_data_dir

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
) -> None:
    """Save the current session state to a JSON file."""
    state = {
        "pdf_path": pdf_path,
        "deck_name": deck_name,
        "cards": cards,
        "concept_map": concept_map,
        "history": history,
        "log_path": log_path,
        "slide_set_name": slide_set_name,
    }
    try:
        state_path = _get_state_path(session_id)
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", dir=os.path.dirname(state_path)) as tmp:
            json.dump(state, tmp, ensure_ascii=False)
            temp_path = tmp.name
        os.replace(temp_path, state_path)
    except Exception as e:
        print(f"Warning: Failed to save state: {e}")

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
