from dataclasses import fields

from lectern.generation_loop import (
    RepairResult,
    evaluate_grounding_gate,
    partition_by_gate,
)


def test_evaluate_grounding_gate_fails_on_missing_provenance_flags():
    card = {
        "front": "Q",
        "back": "A",
        "quality_score": 95.0,
        "quality_flags": ["missing_source_excerpt", "missing_rationale"],
    }

    passed, reasons = evaluate_grounding_gate(card, min_quality=60.0)

    assert passed is False
    assert reasons == ["missing_source_excerpt", "missing_rationale"]


def test_partition_by_gate_splits_promotable_and_needs_repair_by_threshold():
    promotable_card = {"front": "Strong", "back": "A", "quality_score": 80.0, "quality_flags": []}
    low_quality_card = {"front": "Low", "back": "B", "quality_score": 45.0, "quality_flags": []}
    missing_provenance_card = {
        "front": "Ungrounded",
        "back": "C",
        "quality_score": 90.0,
        "quality_flags": ["missing_source_pages"],
    }

    promotable, needs_repair = partition_by_gate(
        [promotable_card, low_quality_card, missing_provenance_card],
        min_quality=50.0,
    )

    assert promotable == [promotable_card]
    assert needs_repair == [low_quality_card, missing_provenance_card]


def test_repair_result_dataclass_fields_and_status_values_are_usable():
    field_names = [field.name for field in fields(RepairResult)]
    assert field_names == ["input_card_key", "status", "card"]

    for status in ("ok", "invalid_payload", "missing_output"):
        result = RepairResult(input_card_key="card-key", status=status)
        assert result.input_card_key == "card-key"
        assert result.status == status
        assert result.card is None

    with_card = RepairResult(
        input_card_key="card-key",
        status="ok",
        card={"front": "Q", "back": "A"},
    )
    assert with_card.card == {"front": "Q", "back": "A"}
