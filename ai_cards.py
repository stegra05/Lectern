from __future__ import annotations

from typing import Any, Dict, List


def _normalize_card_object(card: Dict[str, Any]) -> Dict[str, Any] | None:
    """Normalize a model-returned card into { model_name, fields, tags?, media? }.

    Accepts variants like {front, back}, {question, answer}, {Text}, or already 'fields'.
    Infers model_name based on presence of cloze markup or 'Text'. Returns None if invalid.
    """

    if not isinstance(card, dict):
        return None

    # If already canonical fields present
    fields_obj = card.get("fields")
    model_name = str(card.get("model_name")) if card.get("model_name") else None
    if isinstance(fields_obj, dict):
        # Ensure strings
        fields: Dict[str, str] = {str(k): str(v) for k, v in fields_obj.items() if v is not None}
        text_val = fields.get("Text", "")
        front_val = fields.get("Front", "")
        back_val = fields.get("Back", "")
        content = f"{text_val} {front_val} {back_val}".lower()
        if model_name is None:
            model_name = "Cloze" if "{{c" in content else "Basic"
        return {
            "model_name": model_name,
            "fields": {k: v for k, v in fields.items() if k in ("Text", "Front", "Back") and v},
            "tags": [str(t) for t in (card.get("tags") or []) if isinstance(t, (str, int))],
            "media": [m for m in (card.get("media") or []) if isinstance(m, dict)],
        }

    # Case-insensitive key accessors
    def _get_ci(keys: List[str]) -> str:
        for k in keys:
            if k in card and isinstance(card[k], (str, int)):
                return str(card[k])
        # lowercase variants
        lower_map = {str(k).lower(): k for k in card.keys()}
        for k in keys:
            lk = k.lower()
            if lk in lower_map and isinstance(card[lower_map[lk]], (str, int)):
                return str(card[lower_map[lk]])
        return ""

    text = _get_ci(["Text", "text", "cloze"])  # cloze-like
    front = _get_ci(["Front", "front", "question", "q"])  # basic
    back = _get_ci(["Back", "back", "answer", "a"])  # basic

    # Map common generic field labels (e.g., exported JSON uses Field 1/Field 2)
    field1 = ""
    field2 = ""
    for k, v in card.items():
        if isinstance(k, str) and isinstance(v, (str, int)):
            lk = k.strip().lower()
            if lk in ("field 1", "field1", "f1"):
                field1 = str(v)
            elif lk in ("field 2", "field2", "f2"):
                field2 = str(v)

    if not text and not front and not back and (field1 or field2):
        if "{{c" in field1.lower():
            text = field1
        else:
            front = field1
            back = field2

    # Determine model
    is_cloze = False
    content_all = f"{text} {front} {back}".lower()
    if "{{c" in content_all:
        is_cloze = True
    if text.strip():
        is_cloze = True

    if is_cloze:
        val = text.strip() if text.strip() else (front if "{{c" in front.lower() else "")
        if not val:
            return None
        return {
            "model_name": model_name or "Cloze",
            "fields": {"Text": val},
            "tags": [str(t) for t in (card.get("tags") or []) if isinstance(t, (str, int))],
            "media": [m for m in (card.get("media") or []) if isinstance(m, dict)],
        }

    # Basic card
    if not front.strip() and not back.strip():
        return None
    return {
        "model_name": model_name or "Basic",
        "fields": {"Front": front.strip(), "Back": back.strip()},
        "tags": [str(t) for t in (card.get("tags") or []) if isinstance(t, (str, int))],
        "media": [m for m in (card.get("media") or []) if isinstance(m, dict)],
    }


