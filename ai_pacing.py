"""Pacing feedback logic for AI generation."""

from dataclasses import dataclass
from typing import List

@dataclass
class PacingState:
    current_cards: int
    covered_slides: List[int]
    total_pages: int
    exam_mode: bool
    target_density: float  # Normal: ~1.5, Exam: ~0.9

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

        if self.exam_mode:
            # Exam mode targets ~0.9
            target = 0.9
            if actual_density > target * 1.2:
                lines.append(f"ADVICE: Density is too high (Target: {target}). Increase your filtering threshold! Focus ONLY on the most complex, exam-critical nuances.")
            elif actual_density < target * 0.8:
                lines.append(f"ADVICE: Density is low (Target: {target}). You may capture more application-based nuances if they are high-yield.")
        else:
            # Normal mode uses the dynamic target passed in
            target = self.target_density
            if actual_density > target * 1.25:
                lines.append(f"ADVICE: Density is too high (Target: ~{target:.1f}). Raise your bar for importance. Focus on more substantial concepts.")
            elif actual_density < target * 0.75:
                lines.append(f"ADVICE: Density is low (Target: ~{target:.1f}). Look closer at the slides for missed details or defined terms.")
        
        return "\n".join(lines) + "\n"
