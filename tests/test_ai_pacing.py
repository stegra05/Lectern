import pytest
from lectern.ai_pacing import PacingState

class TestPacing:
    def test_startup_grace_period(self):
        """Should return empty string when card count is very low (< 5)."""
        state = PacingState(
            current_cards=3, 
            covered_slides=[1], 
            total_pages=20, 
            focus_prompt="", 
            target_density=1.0
        )
        assert state.hint == ""

    def test_no_slides_covered(self):
        """Should return empty string if no slides are covered."""
        state = PacingState(
            current_cards=15, 
            covered_slides=[], 
            total_pages=20, 
            focus_prompt="", 
            target_density=1.0
        )
        assert state.hint == ""

    def test_perfect_pacing(self):
        """Should provide status and instruction when density is provided."""
        # 20 cards / 20 slides = 1.0 density (Target 1.0)
        state = PacingState(
            current_cards=20, 
            covered_slides=[20], 
            total_pages=40, 
            focus_prompt="", 
            target_density=1.0
        )
        hint = state.hint
        assert "Slide 20 of 40" in hint
        assert "20 cards" in hint
        assert "~1.0 per slide" in hint
        assert "TARGET GOAL: ~1.0" in hint

    def test_high_density_warning(self):
        """Should provide adjustment instruction when density is high."""
        # 30 cards / 10 slides = 3.0 density. Target 1.0. 
        state = PacingState(
            current_cards=30, 
            covered_slides=[10], 
            total_pages=20, 
            focus_prompt="", 
            target_density=1.0
        )
        hint = state.hint
        assert "GENERATION DENSITY: 30 cards" in hint
        assert "adjust your selectivity" in hint

    def test_low_density_warning(self):
        """Should provide adjustment instruction when density is low."""
        # 10 cards / 20 slides = 0.5 density. Target 1.0.
        state = PacingState(
            current_cards=10, 
            covered_slides=[20], 
            total_pages=40, 
            focus_prompt="", 
            target_density=1.0
        )
        hint = state.hint
        assert "GENERATION DENSITY: 10 cards" in hint
        assert "adjust your selectivity" in hint

    def test_mixed_slide_order(self):
        """Should use max covered slide, not last in list."""
        state = PacingState(
            current_cards=20, 
            covered_slides=[5, 10, 2], # Max is 10
            total_pages=20, 
            focus_prompt="", 
            target_density=2.0
        )
        # 20 cards / 10 slides = 2.0 density. Target 2.0.
        assert "Slide 10 of 20" in state.hint
        assert "GENERATION DENSITY: 20 cards" in state.hint

    def test_zero_division_protection(self):
        """Should handle case where max slide is 0 (e.g. title page only?)."""
        state = PacingState(
            current_cards=15, 
            covered_slides=[0], 
            total_pages=10, 
            focus_prompt="", 
            target_density=1.0
        )
        assert state.hint == ""

    def test_formatting_precision(self):
        """Check float formatting."""
        # 10 cards / 3 slides = 3.3333 density
        state = PacingState(
            current_cards=10, 
            covered_slides=[3], 
            total_pages=10, 
            focus_prompt="", 
            target_density=1.0
        )
        assert "~3.3 per slide" in state.hint

