from __future__ import annotations

from dataclasses import replace
from typing import Any

from lectern.card_quality import (
    AnswerTextRule,
    BroadGroundingRule,
    CardQualityEvaluator,
    CardQualityWeights,
    ConceptIdsRule,
    HighPriorityConceptRule,
    LongAnswerRule,
    LongFrontRule,
    PromptTextRule,
    RationaleRule,
    RelationKeysRule,
    SlideNumberRule,
    SourceExcerptRule,
    SourcePagesRule,
)
from lectern.coverage import (
    get_card_concept_ids,
    get_card_page_references,
    get_card_relation_keys,
)


def _legacy_estimate_card_quality(
    card: dict[str, Any],
    *,
    high_priority_ids: set[str] | None = None,
) -> tuple[float, list[str]]:
    high_priority_ids = high_priority_ids or set()
    flags: list[str] = []
    score = 30.0

    fields = card.get("fields") or {}
    front = str(
        card.get("front")
        or fields.get("Front")
        or card.get("text")
        or fields.get("Text")
        or ""
    ).strip()
    back = str(card.get("back") or fields.get("Back") or "").strip()
    text = str(card.get("text") or fields.get("Text") or "").strip()
    answer_text = text or back
    source_pages = get_card_page_references(card)
    concept_ids = get_card_concept_ids(card)
    relation_keys = get_card_relation_keys(card)
    rationale = str(card.get("rationale") or "").strip()
    source_excerpt = str(card.get("source_excerpt") or "").strip()

    if front or text:
        score += 12
    else:
        flags.append("missing_prompt_text")
        score -= 20

    if answer_text:
        score += 10
    else:
        flags.append("missing_answer_text")
        score -= 15

    if source_pages:
        score += 12
    else:
        flags.append("missing_source_pages")
        score -= 10

    if concept_ids:
        score += 12
    else:
        flags.append("missing_concept_ids")
        score -= 8

    if relation_keys:
        score += 6

    if rationale:
        score += 7
    else:
        flags.append("missing_rationale")
        score -= 4

    if source_excerpt:
        score += 6
    else:
        flags.append("missing_source_excerpt")
        score -= 4

    if card.get("slide_number"):
        score += 3

    if len(front) > 180:
        flags.append("long_front")
        score -= 8
    if len(answer_text) > 420:
        flags.append("long_answer")
        score -= 8
    if len(source_pages) > 3:
        flags.append("broad_grounding")
        score -= 3
    if high_priority_ids.intersection(concept_ids):
        score += 5

    return max(0.0, min(100.0, score)), sorted(set(flags))


def _single_rule_evaluator(rule: Any) -> CardQualityEvaluator:
    return CardQualityEvaluator(
        rules=[rule], weights=replace(CardQualityWeights(), base_score=0.0)
    )


def test_prompt_text_rule():
    score, flags = _single_rule_evaluator(PromptTextRule()).evaluate({"front": "Q"})
    assert score == 12.0
    assert flags == []

    score, flags = _single_rule_evaluator(PromptTextRule()).evaluate({})
    assert score == 0.0
    assert flags == ["missing_prompt_text"]


def test_answer_text_rule():
    score, flags = _single_rule_evaluator(AnswerTextRule()).evaluate({"back": "A"})
    assert score == 10.0
    assert flags == []

    score, flags = _single_rule_evaluator(AnswerTextRule()).evaluate({})
    assert score == 0.0
    assert flags == ["missing_answer_text"]


def test_source_pages_rule():
    score, flags = _single_rule_evaluator(SourcePagesRule()).evaluate(
        {"source_pages": [1]}
    )
    assert score == 12.0
    assert flags == []

    score, flags = _single_rule_evaluator(SourcePagesRule()).evaluate({})
    assert score == 0.0
    assert flags == ["missing_source_pages"]


def test_concept_ids_rule():
    score, flags = _single_rule_evaluator(ConceptIdsRule()).evaluate(
        {"concept_ids": ["c1"]}
    )
    assert score == 12.0
    assert flags == []

    score, flags = _single_rule_evaluator(ConceptIdsRule()).evaluate({})
    assert score == 0.0
    assert flags == ["missing_concept_ids"]


def test_relation_keys_rule():
    score, flags = _single_rule_evaluator(RelationKeysRule()).evaluate(
        {"relation_keys": ["A|causes|B"]}
    )
    assert score == 6.0
    assert flags == []


def test_rationale_rule():
    score, flags = _single_rule_evaluator(RationaleRule()).evaluate(
        {"rationale": "because"}
    )
    assert score == 7.0
    assert flags == []

    score, flags = _single_rule_evaluator(RationaleRule()).evaluate({})
    assert score == 0.0
    assert flags == ["missing_rationale"]


def test_source_excerpt_rule():
    score, flags = _single_rule_evaluator(SourceExcerptRule()).evaluate(
        {"source_excerpt": "quote"}
    )
    assert score == 6.0
    assert flags == []

    score, flags = _single_rule_evaluator(SourceExcerptRule()).evaluate({})
    assert score == 0.0
    assert flags == ["missing_source_excerpt"]


def test_slide_number_rule():
    score, flags = _single_rule_evaluator(SlideNumberRule()).evaluate(
        {"slide_number": 2}
    )
    assert score == 3.0
    assert flags == []


def test_long_front_rule():
    score, flags = _single_rule_evaluator(LongFrontRule()).evaluate(
        {"front": "x" * 181}
    )
    assert score == 0.0
    assert flags == ["long_front"]


def test_long_answer_rule():
    score, flags = _single_rule_evaluator(LongAnswerRule()).evaluate(
        {"back": "y" * 421}
    )
    assert score == 0.0
    assert flags == ["long_answer"]


def test_broad_grounding_rule():
    score, flags = _single_rule_evaluator(BroadGroundingRule()).evaluate(
        {"source_pages": [1, 2, 3, 4]}
    )
    assert score == 0.0
    assert flags == ["broad_grounding"]


def test_high_priority_concept_rule():
    evaluator = _single_rule_evaluator(HighPriorityConceptRule())
    score, flags = evaluator.evaluate(
        {"concept_ids": ["important"]}, high_priority_ids={"important"}
    )
    assert score == 5.0
    assert flags == []


def test_quality_engine_golden_parity():
    evaluator = CardQualityEvaluator()
    high_priority_ids = {"c1", "c3", "c7"}

    cards: list[dict[str, Any]] = []
    for i in range(80):
        card = {
            "front": f"Front {i}" if i % 3 else "",
            "back": f"Back {i}" if i % 5 else "",
            "text": f"Text {i}" if i % 7 else "",
            "source_pages": [1 + (i % 5)] if i % 4 else [1, 2, 3, 4],
            "concept_ids": [f"c{i % 10}"] if i % 6 else [],
            "relation_keys": [f"s{i}|rel|t{i}"] if i % 2 else [],
            "rationale": "Reason" if i % 4 else "",
            "source_excerpt": "Excerpt" if i % 5 else "",
            "slide_number": i if i % 3 else None,
        }
        if i % 9 == 0:
            card["front"] = "z" * 181
        if i % 11 == 0:
            card["back"] = "w" * 421
        cards.append(card)

    for card in cards:
        new_score, new_flags = evaluator.evaluate(
            card, high_priority_ids=high_priority_ids
        )
        old_score, old_flags = _legacy_estimate_card_quality(
            card, high_priority_ids=high_priority_ids
        )
        assert abs(new_score - old_score) < 2.0
        assert new_flags == old_flags
