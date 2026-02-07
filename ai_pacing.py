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
        if not self.covered_slides or self.current_cards < 10:
            return ""

        last_slide = max(self.covered_slides)
        # Avoid division by zero
        if last_slide == 0:
            return ""
            
        actual_density = self.current_cards / last_slide
        
        lines = [
            f"Progress: Slide {last_slide} of {self.total_pages}.",
            f"Status: You have generated {self.current_cards} cards so far (~{actual_density:.1f} per slide)."
        ]

        target = self.target_density
        if actual_density > target * 1.25:
            lines.append(f"ADVICE: Density is too high (Target: ~{target:.1f}). Raise your bar for importance. Focus on more substantial concepts.")
        elif actual_density < target * 0.75:
            lines.append(f"ADVICE: Density is low (Target: ~{target:.1f}). Look closer at the slides for missed details or defined terms.")
        
        return "\n".join(lines) + "\n"
