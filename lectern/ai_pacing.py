"""Pacing feedback logic for AI generation."""

from dataclasses import dataclass
from typing import Any, List


@dataclass
class PacingState:
    current_cards: int
    covered_slides: List[int]
    total_pages: int
    focus_prompt: str  # Optional user focus
    target_density: float
    feedback_summary: dict[str, Any] | None = None

    def _adaptive_target_density(self) -> float:
        summary = self.feedback_summary or {}
        total_signals = int(summary.get("total_signals") or 0)
        if total_signals <= 0:
            return self.target_density

        positive = int(summary.get("positive_count") or 0)
        negative = int(summary.get("negative_count") or 0)

        positive_ratio = positive / total_signals
        negative_ratio = negative / total_signals

        adjusted = self.target_density
        if negative_ratio >= 0.6:
            adjusted = max(0.5, self.target_density - 0.3)
        elif positive_ratio >= 0.7:
            adjusted = min(6.0, self.target_density + 0.2)

        return adjusted

    @property
    def hint(self) -> str:
        """Generate a pacing hint string for the AI."""
        summary = self.feedback_summary or {}
        total_signals = int(summary.get("total_signals") or 0)
        positive = int(summary.get("positive_count") or 0)
        negative = int(summary.get("negative_count") or 0)
        reasons = [
            str(reason).strip()
            for reason in (summary.get("negative_reasons") or [])
            if str(reason).strip()
        ]

        if not self.covered_slides and total_signals <= 0:
            return ""
        if self.current_cards < 5 and total_signals <= 0:
            return ""

        covered_count = len(set(self.covered_slides))
        actual_density = (
            self.current_cards / covered_count if covered_count > 0 else 0.0
        )
        uncovered_count = max(self.total_pages - covered_count, 0)
        adaptive_target = self._adaptive_target_density()

        feedback_block = ""
        if total_signals > 0:
            feedback_block = (
                f"- ADAPTIVE FEEDBACK: {total_signals} review signals "
                f"(helpful={positive}, needs_work={negative}).\n"
            )
            if reasons:
                feedback_block += (
                    "- COMMON ISSUES TO AVOID: "
                    f"{', '.join(reasons[:3])}.\n"
                )

        return (
            f"\n- CURRENT PROGRESS: {covered_count} covered slides out of {self.total_pages}.\n"
            f"- UNTOUCHED SLIDES: {uncovered_count}.\n"
            f"- GENERATION DENSITY: {self.current_cards} cards for {covered_count} covered slides (~{actual_density:.1f} per covered slide).\n"
            f"- TARGET GOAL: ~{adaptive_target:.1f} cards per slide while spreading coverage across the deck.\n"
            f"{feedback_block}"
        )
