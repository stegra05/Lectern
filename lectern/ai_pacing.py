"""Pacing feedback logic for AI generation."""

from dataclasses import dataclass
from typing import List

@dataclass
class PacingState:
    current_cards: int
    covered_slides: List[int]
    total_pages: int
    focus_prompt: str  # Optional user focus
    target_density: float

    @property
    def hint(self) -> str:
        """Generate a pacing hint string for the AI."""
        if not self.covered_slides or self.current_cards < 5:
            return ""

        covered_count = len(set(self.covered_slides))
        if covered_count == 0:
            return ""

        actual_density = self.current_cards / covered_count
        uncovered_count = max(self.total_pages - covered_count, 0)

        return (
            f"\n- CURRENT PROGRESS: {covered_count} covered slides out of {self.total_pages}.\n"
            f"- UNTOUCHED SLIDES: {uncovered_count}.\n"
            f"- GENERATION DENSITY: {self.current_cards} cards for {covered_count} covered slides (~{actual_density:.1f} per covered slide).\n"
            f"- TARGET GOAL: ~{self.target_density:.1f} cards per slide while spreading coverage across the deck.\n"
        )
