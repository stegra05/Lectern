import pytest
from ai_pacing import PacingState

def test_pacing_hint_empty():
    state = PacingState(current_cards=5, covered_slides=[1, 2], total_pages=10, exam_mode=False, target_density=1.5)
    assert state.hint == ""  # Not enough cards to give feedback

def test_pacing_hint_normal_mode_balanced():
    state = PacingState(current_cards=15, covered_slides=[10], total_pages=20, exam_mode=False, target_density=1.5)
    hint = state.hint
    assert "Slide 10 of 20" in hint
    assert "1.5 per slide" in hint
    assert "ADVICE" not in hint  # 1.5 is exactly target

def test_pacing_hint_normal_too_dense():
    state = PacingState(current_cards=30, covered_slides=[10], total_pages=20, exam_mode=False, target_density=1.5)
    hint = state.hint
    assert "3.0 per slide" in hint
    assert "ADVICE: Density is too high" in hint

def test_pacing_hint_exam_mode_strict():
    state = PacingState(current_cards=20, covered_slides=[10], total_pages=20, exam_mode=True, target_density=0.9)
    hint = state.hint
    # 2.0 density vs 0.9 target
    assert "ADVICE: Density is too high" in hint
    assert "Target: 0.9" in hint
