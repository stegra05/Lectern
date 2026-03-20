from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from lectern.anki_connector import check_connection
from lectern.application.ports import AnkiGatewayPort
from lectern.utils.note_export import ExportResult, export_card_to_anki


class AnkiGateway(AnkiGatewayPort):
    """Adapter wrapping Anki connection and card export helpers."""

    def __init__(
        self,
        *,
        check_ready_fn: Callable[[], Awaitable[bool]] = check_connection,
        export_card_fn: Callable[..., Awaitable[ExportResult]] = export_card_to_anki,
    ) -> None:
        self._check_ready_fn = check_ready_fn
        self._export_card_fn = export_card_fn

    async def check_ready(self) -> dict[str, bool]:
        connected = await self._check_ready_fn()
        return {"connected": bool(connected)}

    async def export_cards(self, request: Any) -> dict[str, Any]:
        payload = request if isinstance(request, dict) else {}
        card = payload.get("card") or {}
        result = await self._export_card_fn(
            card=card,
            deck_name=str(payload.get("deck_name") or ""),
            slide_set_name=str(payload.get("slide_set_name") or ""),
            fallback_model=str(payload.get("model_name") or "Basic"),
            additional_tags=list(payload.get("tags") or []),
        )
        return {
            "success": result.success,
            "note_id": result.note_id,
            "error": result.error,
        }
