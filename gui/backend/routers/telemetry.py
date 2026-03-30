from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated

from gui.backend.dependencies import get_perf_metrics_repository
from lectern.infrastructure.persistence.perf_metrics_repository_sqlite import (
    PerfMetricsRepositorySqlite,
)

router = APIRouter()


class ClientMetricComplexityPayload(BaseModel):
    card_count: Annotated[int | None, Field(ge=0)] = None
    total_pages: Annotated[int | None, Field(ge=0)] = None
    text_chars: Annotated[int | None, Field(ge=0)] = None
    chars_per_page: Annotated[float | None, Field(ge=0, allow_inf_nan=False)] = None
    model: str | None = None
    build_version: str | None = None
    build_channel: str | None = None
    document_type: str | None = None
    image_count: Annotated[int | None, Field(ge=0)] = None
    target_card_count: Annotated[int | None, Field(ge=0)] = None


class ClientMetricEntryPayload(BaseModel):
    metric_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    duration_ms: float
    complexity: ClientMetricComplexityPayload


class ClientMetricsIngestRequest(BaseModel):
    client_ts_ms: Annotated[int, Field(ge=0)]
    session_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    entries: Annotated[list[ClientMetricEntryPayload], Field(min_length=1, max_length=500)]


class ClientMetricsIngestResponse(BaseModel):
    status: str
    ingested_count: int


@router.post("/metrics/client", response_model=ClientMetricsIngestResponse)
async def ingest_client_metrics(
    payload: ClientMetricsIngestRequest,
    repo: PerfMetricsRepositorySqlite = Depends(get_perf_metrics_repository),
) -> dict[str, int | str]:
    for index, entry in enumerate(payload.entries):
        duration_ms = entry.duration_ms
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
