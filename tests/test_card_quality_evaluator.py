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
    CardQualityContext,
)


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


def test_quality_engine_card_quality_context_alignment():
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
        context = CardQualityContext.from_card(card, high_priority_ids)
        # Sanity-check that expected context extraction behavior is preserved.
        assert isinstance(context.source_pages, list)
        assert isinstance(context.concept_ids, list)
        assert isinstance(context.relation_keys, list)
        assert isinstance(context.front, str)
        assert isinstance(context.answer_text, str)
        assert 0.0 <= new_score <= 100.0
        assert isinstance(new_flags, list)
