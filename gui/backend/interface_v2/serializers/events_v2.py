from __future__ import annotations

import json

from lectern.application.dto import ApiEventV2


def serialize_api_event_v2(event: ApiEventV2) -> str:
    return json.dumps(
        {
            "event_version": event.event_version,
            "session_id": event.session_id,
            "sequence_no": event.sequence_no,
            "type": event.type,
            "message": event.message,
            "timestamp": event.timestamp,
            "data": event.data,
        }
    )

