from __future__ import annotations

from lectern.domain.generation.types import (
    ConceptMapResult,
    DomainEventRecordMetadata,
    DomainEventSummary,
)


def test_concept_map_result_exposes_expected_fields() -> None:
    payload: ConceptMapResult = {
        "objectives": ["Understand async pipelines"],
        "concepts": [{"id": "c1", "name": "Coroutine"}],
        "relations": [{"source": "c1", "target": "c2", "type": "depends_on"}],
        "language": "en",
        "slide_set_name": "Lecture 1",
        "page_count": 12,
        "estimated_text_chars": 5400,
        "document_type": "slides",
    }

    assert payload["slide_set_name"] == "Lecture 1"
    assert payload["page_count"] == 12
    assert payload["concepts"][0]["id"] == "c1"


def test_domain_event_summary_supports_counts_and_duration() -> None:
    summary: DomainEventSummary = {
        "cards_exported": 18,
        "cards_generated": 24,
        "duration_ms": 4200,
        "warnings_count": 1,
    }

    assert summary["cards_exported"] == 18
    assert summary["duration_ms"] == 4200


def test_domain_event_record_metadata_supports_trace_fields() -> None:
    metadata: DomainEventRecordMetadata = {
        "event_id": "evt-123",
        "correlation_id": "corr-7",
        "causation_id": "evt-122",
        "persisted_at_ms": 1710000000000,
        "producer": "generation_app_service",
    }

    assert metadata["event_id"] == "evt-123"
    assert metadata["persisted_at_ms"] == 1710000000000
