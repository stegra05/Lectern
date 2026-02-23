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

        last_slide = max(self.covered_slides)
        # Avoid division by zero
        if last_slide == 0:
            return ""
            
        actual_density = self.current_cards / last_slide
        
        # provide factual status and a clean instruction
        # rather than "ADVICE: SCREAMING"
        return (
            f"\n- CURRENT PROGRESS: Slide {last_slide} of {self.total_pages}.\n"
            f"- GENERATION DENSITY: {self.current_cards} cards for {last_slide} slides (~{actual_density:.1f} per slide).\n"
            f"- TARGET GOAL: ~{self.target_density:.1f} cards per slide. Please adjust your selectivity to match this target.\n"
        )
