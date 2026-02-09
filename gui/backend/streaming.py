import json
import time
from typing import Any, Dict


def ndjson_event(event_type: str, message: str = "", data: Dict[str, Any] | None = None) -> str:
    """Compose a single NDJSON event line with a timestamp.

    NOTE(Events): This is the canonical JSON envelope for all streamed events
    sent to the frontend over /generate and sync endpoints.
    """
    return json.dumps(
        {
            "type": event_type,
            "message": message,
            "data": data or {},
            "timestamp": time.time(),
        }
    ) + "\n"

