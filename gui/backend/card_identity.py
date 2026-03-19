from __future__ import annotations

import uuid
from typing import Any


def ensure_cards_have_uid(cards: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalize cards so each card includes a backend `uid`."""
    normalized: list[dict[str, Any]] = []
    for card in cards or []:
        normalized_card = dict(card)
        existing_uid = normalized_card.get("uid") or normalized_card.get("_uid")
        if isinstance(existing_uid, str) and existing_uid.strip():
            normalized_card["uid"] = existing_uid.strip()
        else:
            normalized_card["uid"] = str(uuid.uuid4())
        normalized.append(normalized_card)
    return normalized
