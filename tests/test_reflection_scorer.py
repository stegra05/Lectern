import pytest

from lectern.generation_loop import CardPriorityScorer, ReflectionScoringWeights


def test_card_priority_scorer_applies_weighted_signals():
    scorer = CardPriorityScorer()
    score = scorer.score(
        card={
            "quality_score": 2.5,
            "source_pages": [5],
            "concept_ids": ["hp-1", "c-2"],
            "relation_keys": ["c-1|depends_on|c-2"],
        },
        selected_pages=set(),
        selected_concepts=set(),
        selected_relations=set(),
        per_page_counts={},
        high_priority_ids={"hp-1"},
    )

    assert score == pytest.approx(23.0)


def test_card_priority_scorer_applies_saturation_penalty():
    scorer = CardPriorityScorer(
        weights=ReflectionScoringWeights(saturation_penalty=7.0)
    )
    score = scorer.score(
        card={
            "quality_score": 1.0,
            "source_pages": [3],
            "concept_ids": [],
            "relation_keys": [],
        },
        selected_pages=set(),
        selected_concepts=set(),
        selected_relations=set(),
        per_page_counts={3: 5},
        high_priority_ids=set(),
    )

    # saturation = ((5 + 1) - 2) = 4; penalty = 4 * 7 = 28
    # new page bonus = 1 * 1.5; total = 1 + 1.5 - 28
    assert score == pytest.approx(-25.5)
