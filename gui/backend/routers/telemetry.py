from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated

from gui.backend.dependencies import get_perf_metrics_repository
from lectern.infrastructure.persistence.perf_metrics_repository_sqlite import (
    PerfMetricsRepositorySqlite,
)

router = APIRouter()


class ClientMetricComplexityPayload(BaseModel):
    card_count: int | None = None
    total_pages: int | None = None
    text_chars: int | None = None
    chars_per_page: float | None = None
    model: str | None = None
    build_version: str | None = None
    build_channel: str | None = None
    document_type: str | None = None
    image_count: int | None = None
    target_card_count: int | None = None


class ClientMetricEntryPayload(BaseModel):
    metric_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    duration_ms: Annotated[float, Field(ge=0)]
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
    ingested_count = await repo.ingest_client_metrics(payload.model_dump())
    return {"status": "ok", "ingested_count": ingested_count}
