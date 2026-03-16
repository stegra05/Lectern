import pytest
from lectern.ai_pacing import PacingState


class TestPacing:
    def test_startup_grace_period(self):
        state = PacingState(
            current_cards=3,
            covered_slides=[1],
            total_pages=20,
            focus_prompt="",
            target_density=1.0,
        )
        assert state.hint == ""

    def test_no_slides_covered(self):
        state = PacingState(
            current_cards=15,
            covered_slides=[],
            total_pages=20,
            focus_prompt="",
            target_density=1.0,
        )
        assert state.hint == ""

    def test_perfect_pacing(self):
        state = PacingState(
            current_cards=20,
            covered_slides=list(range(1, 21)),
            total_pages=40,
            focus_prompt="",
            target_density=1.0,
        )
        hint = state.hint
        assert "20 covered slides out of 40" in hint
        assert "20 cards" in hint
        assert "~1.0 per covered slide" in hint

    def test_high_density_warning(self):
        state = PacingState(
            current_cards=30,
            covered_slides=list(range(1, 11)),
            total_pages=20,
            focus_prompt="",
            target_density=1.0,
        )
        hint = state.hint
        assert "30 cards for 10 covered slides" in hint

    def test_low_density_warning(self):
        state = PacingState(
            current_cards=10,
            covered_slides=list(range(1, 21)),
            total_pages=40,
            focus_prompt="",
            target_density=1.0,
        )
        hint = state.hint
        assert "10 cards for 20 covered slides (~0.5 per covered slide)" in hint

    def test_mixed_slide_order(self):
        state = PacingState(
            current_cards=20,
            covered_slides=[5, 10, 2, 1, 3, 4, 6, 7, 8, 9],
            total_pages=20,
            focus_prompt="",
            target_density=2.0,
        )
        assert "10 covered slides out of 20" in state.hint
        assert "20 cards for 10 covered slides (~2.0 per covered slide)" in state.hint

    def test_formatting_precision(self):
        state = PacingState(
            current_cards=10,
            covered_slides=[1, 2, 3],
            total_pages=10,
            focus_prompt="",
            target_density=1.0,
        )
        assert "~3.3 per covered slide" in state.hint
