from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing import Annotated

from gui.backend.dependencies import get_perf_metrics_repository
from lectern.infrastructure.persistence.perf_metrics_repository_sqlite import (
    PerfMetricsRepositorySqlite,
)

router = APIRouter()
_MIN_CLIENT_TS_MS = 946684800000  # 2000-01-01T00:00:00Z
_MAX_CLIENT_TS_MS = 4102444800000  # 2100-01-01T00:00:00Z


class ClientMetricComplexityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    card_count: Annotated[int | None, Field(ge=0)] = None
    total_pages: Annotated[int | None, Field(ge=0)] = None
    text_chars: Annotated[int | None, Field(ge=0)] = None
    chars_per_page: Annotated[float | int | None, Field(ge=0, allow_inf_nan=False)] = None
    model: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=128)] = None
    build_version: Annotated[
        str | None, StringConstraints(strip_whitespace=True, max_length=64)
    ] = None
    build_channel: Annotated[
        str | None, StringConstraints(strip_whitespace=True, max_length=32)
    ] = None
    document_type: Annotated[
        str | None, StringConstraints(strip_whitespace=True, max_length=32)
    ] = None
    image_count: Annotated[int | None, Field(ge=0)] = None
    target_card_count: Annotated[int | None, Field(ge=0)] = None


class ClientMetricEntryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    metric_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
    ]
    duration_ms: float | int
    complexity: ClientMetricComplexityPayload


class ClientMetricsIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    client_ts_ms: Annotated[int, Field(ge=_MIN_CLIENT_TS_MS, le=_MAX_CLIENT_TS_MS)]
    session_id: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=128),
    ]
    entries: Annotated[list[ClientMetricEntryPayload], Field(min_length=1, max_length=500)]


class ClientMetricsIngestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: str
    ingested_count: int


@router.post("/metrics/client", response_model=ClientMetricsIngestResponse)
async def ingest_client_metrics(
    payload: ClientMetricsIngestRequest,
    repo: PerfMetricsRepositorySqlite = Depends(get_perf_metrics_repository),
) -> dict[str, int | str]:
    for index, entry in enumerate(payload.entries):
        try:
            duration_ms = float(entry.duration_ms)
        except (OverflowError, TypeError, ValueError):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "invalid_input",
                    "field": f"entries[{index}].duration_ms",
                    "reason": "must_be_finite_non_negative",
                },
            ) from None
        if not math.isfinite(duration_ms) or duration_ms < 0:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "invalid_input",
                    "field": f"entries[{index}].duration_ms",
                    "reason": "must_be_finite_non_negative",
                },
            )

    ingested_count = await repo.ingest_client_metrics(payload.model_dump())
    return {"status": "ok", "ingested_count": ingested_count}
