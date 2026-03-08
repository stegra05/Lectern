from lectern.coverage import compute_coverage_data, build_generation_gap_text


def test_compute_coverage_data_tracks_explicit_and_inferred_coverage():
    concept_map = {
        "concepts": [
            {"id": "c1", "name": "Fixed Costs", "importance": "high", "page_references": [1]},
            {"id": "c2", "name": "Variable Costs", "importance": "medium", "page_references": [2]},
        ],
        "relations": [
            {"source": "c1", "type": "contrasts_with", "target": "c2", "page_references": [2]},
        ],
    }
    cards = [
        {
            "fields": {"Front": "What are fixed costs?", "Back": "Costs that stay constant."},
            "source_pages": [1],
            "concept_ids": ["c1"],
        },
        {
            "fields": {"Front": "Contrast fixed and variable costs.", "Back": "They behave differently with activity."},
            "source_pages": [2],
            "relation_keys": ["c1|contrasts_with|c2"],
        },
    ]

    coverage = compute_coverage_data(cards=cards, concept_map=concept_map, total_pages=3)

    assert coverage["explicit_concept_ids"] == ["c1"]
    assert coverage["covered_concept_ids"] == ["c1", "c2"]
    assert coverage["inferred_concept_ids"] == ["c2"]
    assert coverage["explicit_relation_keys"] == ["c1|contrasts_with|c2"]
    assert coverage["covered_relation_count"] == 1
    assert coverage["saturated_pages"] == []


def test_generation_gap_text_mentions_relations_and_saturated_pages():
    concept_map = {
        "concepts": [
            {"id": "c1", "name": "Fixed Costs", "importance": "high", "page_references": [1]},
        ],
        "relations": [
            {"source": "c1", "type": "causes", "target": "c2", "page_references": [2]},
        ],
    }
    cards = [
        {"fields": {"Front": "Q1"}, "source_pages": [1]},
        {"fields": {"Front": "Q2"}, "source_pages": [1]},
        {"fields": {"Front": "Q3"}, "source_pages": [1]},
    ]

    coverage = compute_coverage_data(cards=cards, concept_map=concept_map, total_pages=2)
    gap_text = build_generation_gap_text(coverage)

    assert "Missing relations" in gap_text
    assert "Over-covered pages" in gap_text
