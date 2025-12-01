
import json
import os
from typing import Dict, Any, List, Optional

STATE_FILE = ".lectern_state.json"

def save_state(
    pdf_path: str,
    deck_name: str,
    cards: List[Dict[str, Any]],
    concept_map: Dict[str, Any],
    history: List[Dict[str, Any]],
    log_path: str
) -> None:
    """Save the current session state to a JSON file."""
    state = {
        "pdf_path": pdf_path,
        "deck_name": deck_name,
        "cards": cards,
        "concept_map": concept_map,
        "history": history,
        "log_path": log_path
    }
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save state: {e}")

def load_state() -> Optional[Dict[str, Any]]:
    """Load the session state from the JSON file if it exists."""
    if not os.path.exists(STATE_FILE):
        return None
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def clear_state() -> None:
    """Remove the state file."""
    if os.path.exists(STATE_FILE):
        try:
            os.remove(STATE_FILE)
        except Exception:
            pass
