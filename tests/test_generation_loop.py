from lectern.ai_pacing import PacingState


def test_pacing_hint_applies_negative_feedback_density_reduction():
    pacing = PacingState(
        current_cards=12,
        covered_slides=[1, 2, 3, 4],
        total_pages=10,
        focus_prompt="",
        target_density=2.0,
        feedback_summary={
            "positive_count": 1,
            "negative_count": 6,
            "total_signals": 7,
            "negative_reasons": ["too vague"],
        },
    )

    hint = pacing.hint
    assert "ADAPTIVE FEEDBACK" in hint
    assert "TARGET GOAL: ~1.7 cards per slide" in hint
    assert "too vague" in hint


def test_pacing_hint_applies_positive_feedback_density_increase():
    pacing = PacingState(
        current_cards=12,
        covered_slides=[1, 2, 3, 4],
        total_pages=10,
        focus_prompt="",
        target_density=2.0,
        feedback_summary={
            "positive_count": 8,
            "negative_count": 1,
            "total_signals": 9,
            "negative_reasons": [],
        },
    )

    hint = pacing.hint
    assert "ADAPTIVE FEEDBACK" in hint
    assert "TARGET GOAL: ~2.2 cards per slide" in hint
