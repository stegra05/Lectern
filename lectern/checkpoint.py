from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Protocol

from lectern.utils.state import save_state


class CheckpointAI(Protocol):
    log_path: str

    def get_history(self) -> List[Dict[str, Any]]:
        ...


def save_checkpoint(
    *,
    pdf_path: str,
    deck_name: str,
    cards: List[Dict[str, Any]],
    concept_map: Dict[str, Any],
    ai: CheckpointAI,
    session_id: Optional[str],
    slide_set_name: str,
    model_name: str,
    tags: List[str],
    history_id: Optional[str],
) -> None:
    save_state(
        pdf_path=os.path.abspath(pdf_path),
        deck_name=deck_name,
        cards=cards,
        concept_map=concept_map,
        history=ai.get_history(),
        log_path=ai.log_path,
        session_id=session_id,
        slide_set_name=slide_set_name,
        model_name=model_name,
        tags=tags,
        entry_id=history_id,
    )
