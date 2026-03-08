"""Centralized prompt templates for Lectern AI.

Refactored from ai_common.py and ai_client.py to reduce redundancy
and enforce language consistency.
"""

from dataclasses import dataclass
from typing import List, Dict, Any, Optional

import json

# --- Constants ---
FORMATTING_RULES = (
    "- Use LaTeX/MathJax for math: inline \\( ... \\), display \\[ ... \\].\n"
    "- Use HTML for non-math emphasis: <b>...</b> or <strong>...</strong>; italics with <i>...</i> or <em>...</em>.\n"
    "- For math bold: \\textbf{...} (text), \\mathbf{...} or \\boldsymbol{...} (symbols). Do not use HTML inside math.\n"
    "- Never use Markdown (no **bold**, headers, or code fences).\n"
    "- JSON must escape backslashes (e.g., \\\\frac, \\\\alpha).\n"
)

def _make_example_str(examples_data: List[Dict[str, Any]], title: str) -> str:
    """Build example string for prompts. Uses 'fields' as native object."""
    lines = [title]
    for ex in examples_data:
        json_str = json.dumps(ex)
        lines.append(f"  {ex.get('model_name', 'Card')}: {json_str}")
    return "\n".join(lines) + "\n"

# Unified Card Examples (Definitions, Comparisons, Applications)
_CARD_DATA = [
    {
        "model_name": "Basic",
        "fields": [
            {"name": "Front", "value": "State the quadratic formula."},
            {"name": "Back", "value": r"Key idea: <b>roots</b>. Formula: \(x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}\)."},
        ],
        "slide_topic": "Quadratic Equations",
    },
    {
        "model_name": "Cloze",
        "fields": [
            {"name": "Text", "value": r"The derivative of \(x^n\) is {{c1::\(n x^{n-1}\)}}."},
        ],
        "slide_topic": "Differentiation Rules",
    },
    {
        "model_name": "Basic",
        "fields": [
            {"name": "Front", "value": "Loss oscillates wildly during training. What is the most likely cause?"},
            {"name": "Back", "value": "<b>Learning rate is too high</b>. The steps overshoot the minimum."},
        ],
        "slide_topic": "Optimization Dynamics",
    },
    {
        "model_name": "Basic",
        "fields": [
            {"name": "Front", "value": "Compare <b>L1</b> and <b>L2</b> regularization effects."},
            {"name": "Back", "value": "<b>L1</b>: Yields sparse weights (feature selection).\n<b>L2</b>: Shrinks all weights uniformly (prevents overfitting)."},
        ],
        "slide_topic": "Regularization",
    }
]
CARD_EXAMPLES = _make_example_str(_CARD_DATA, "Examples:")

@dataclass
class PromptConfig:
    language: str = "en"
    focus_prompt: Optional[str] = None

class PromptBuilder:
    def __init__(self, config: PromptConfig):
        self.cfg = config

    @property
    def system(self) -> str:
        """Build the system instruction."""
        lang_instruction = f"Output language: {self.cfg.language}"
        
        focus_context = ""
        if self.cfg.focus_prompt:
            focus_context = (
                f"USER FOCUS: \"{self.cfg.focus_prompt}\"\n"
                "Instruction: Prioritize concepts related to this focus. "
                "Adjust card styles (e.g. more definitions vs. comparisons) to match the user's intent.\n"
            )
        
        context = (
            "Goal: Create a comprehensive spaced repetition deck.\n"
            "Principles: Atomicity, Minimum Information Principle, Variety (Definitions, Comparisons, Applications)."
        )
        
        return (
            f"You are an expert educator creating Anki flashcards.\n"
            f"{lang_instruction}\n"
            f"{focus_context}"
            f"{context}\n"
            f"Formatting:\n{FORMATTING_RULES}\n"
            f"{CARD_EXAMPLES}"
        )

    def concept_map(self) -> str:
        """Build the concept map prompt."""
        focus_context = ""
        if self.cfg.focus_prompt:
            focus_context = (
                f"- Focus: USER REQUESTED \"{self.cfg.focus_prompt}\". "
                "Ensure concepts relevant to this focus are prioritized and detailed.\n"
            )

        return (
            "You are an expert educator and knowledge architect. Analyze the following lecture slides to construct a comprehensive global concept map.\n"
            f"{focus_context}"
            "- Objectives: Extract explicit learning goals and implicit competency targets.\n"
            "- Concepts: Identify the core entities, theories, and definitions. Prioritize *fundamental* concepts. Assign stable, short, unique IDs.\n"
            "- For each concept add:\n"
            "    - `importance`: one of `high`, `medium`, `low` based on lecture objectives.\n"
            "    - `difficulty`: one of `foundational`, `intermediate`, `advanced` based on cognitive load.\n"
            "    - `page_references`: integer slide/page numbers where the concept is taught or illustrated.\n"
            "- Relations: Map the *semantic structure* (e.g., `is_a`, `part_of`, `causes`, `contrasts_with`). Note page references using `page_references`.\n"
            "- Language: Detect the primary language of the slides (e.g. 'en', 'de', 'fr'). Return the ISO 639-1 code.\n"
            "- Slide Set Name: Generate a semantic name for this slide set (e.g., 'Lecture 2 Introduction To Machine Learning'). "
            "Use Title Case, max 8 words. Include lecture/week number if present.\n"
            "- Metadata: Estimate `page_count` (integer) and `estimated_text_chars` (integer) for pacing calculations.\n"
            "- Metadata: Return `document_type` as one of `slides`, `script`, or `mixed`.\n"
            "- Formatting: STRICTLY AVOID Markdown in text fields. Use HTML.\n"
            "Return ONLY a JSON object with keys: objectives, concepts, relations, language, slide_set_name, page_count, estimated_text_chars, document_type. No prose.\n"
        )

    def generation(
        self,
        limit: int,
        pacing_hint: str = "",
        avoid_text: str = "",
        slide_coverage: str = "",
        coverage_summary: str = "",
        examples_text: str = "",
    ) -> str:
        """Build the card generation prompt."""
        
        focus_instruction = ""
        if self.cfg.focus_prompt:
            focus_instruction = (
                f"- User Focus: \"{self.cfg.focus_prompt}\". "
                "Ensure generated cards align with this goal (e.g. if asking for definitions, prefer Cloze/Basic defs)."
            )

        return (
            f"Generate up to {int(limit)} high-quality, atomic Anki notes continuing from our prior turns.\n"
            "CRITICAL: Consult the Global Concept Map. Cover the 'Relations' identified there.\n"
            f"Language: Ensure all content is in {self.cfg.language}.\n"
            f"{pacing_hint}"
            f"{examples_text}"
            "- Principles:\n"
            "    - Atomicity: One idea per card.\n"
            "    - Variety: Mix Definitions, Comparisons, Applications.\n"
            "    - Breadth-first coverage: cover every HIGH importance concept before deepening already-covered clusters.\n"
            "    - Anti-clustering: do not spend more than 2 cards on one slide/topic while higher-priority gaps remain elsewhere.\n"
            "- Important: Continue generating cards to close coverage gaps. Do NOT set 'done' to true until the important concepts and pages are exhausted.\n"
            f"{focus_instruction}\n"
            "- Format:\n"
            "    - Prefer Cloze for definitions/lists. Basic for open-ended questions.\n"
            "    - STRICTLY AVOID Markdown. Use HTML for formatting.\n"
            "    - Output shape is strict:\n"
            "      * Each card must include `model_name` and `fields`.\n"
            "      * Basic cards use fields named `Front` and `Back`.\n"
            "      * Cloze cards use a field named `Text`.\n"
            "    - Return ONLY a JSON object with keys `cards` and `done`.\n"
            "    - `cards` must be an array of card objects only.\n"
            "    - `done` must be a boolean.\n"
            f"{avoid_text}"
            f"{slide_coverage}"
            f"{coverage_summary}"
            "    - Include `slide_topic` (short section/topic label, Title Case).\n"
            "    - Include `slide_number` when confident (integer page number).\n"
            "    - Include `source_pages` as an array of grounded page numbers for the card.\n"
            "    - Include `concept_ids` as an array of concept IDs from the concept map that this card covers.\n"
            "    - Include `relation_keys` as an array of `<source>|<type>|<target>` relation signatures when the card teaches a relation from the concept map.\n"
            "    - Include a concise `rationale` (max 140 chars) explaining why the card matters.\n"
            "    - Include a concise `source_excerpt` (max 220 chars) grounded in the slide wording or diagram content.\n"
            "    - Keep `slide_topic` concise (ideally <= 8 words).\n"
            "    - If grounding is weak, emit fewer cards rather than inventing unsupported details.\n"
        )

    def reflection(self, limit: int, cards_to_refine: str = "", coverage_gaps: str = "") -> str:
        """Build the reflection prompt."""
        focus_context = ""
        if self.cfg.focus_prompt:
            focus_context = f"- Check alignment with user focus: \"{self.cfg.focus_prompt}\"\n"

        cards_context = ""
        if cards_to_refine:
            cards_context = f"\nCards to Refine:\n{cards_to_refine}\n"

        return (
            "You are a Quality Assurance Specialist. Review the provided cards and refine them.\n"
            "Critique Criteria:\n"
            "    - Redundancy: Duplicate/overlapping? Merge them.\n"
            "    - Vagueness: Ambiguous? Clarify them.\n"
            "    - Complexity: Too long? Split them.\n"
            "    - Distribution: If coverage is clustered, replace low-value cards with missing high-priority coverage.\n"
            "    - Grounding: Preserve or improve `source_pages`, `slide_number`, and `concept_ids`.\n"
            "    - Provenance: Preserve or improve `rationale`, `source_excerpt`, and `relation_keys`.\n"
            "    - Scoring: Assign each kept or rewritten card a `quality_score` from 0-100 and `quality_flags` for notable weaknesses.\n"
            f"{focus_context}"
            f"{coverage_gaps}\n"
            "Action:\n"
            "    - Write a concise `reflection` on the quality of these cards.\n"
            "    - Rewrite the cards applying your critique. Add gap-filling cards if necessary.\n"
            "    - Keep strong cards when they already meet the criteria; do not rewrite purely for style.\n"
            "    - Return the best refined set of cards for this batch, with improved metadata and quality scores.\n"
            f"Language: Ensure all content is in {self.cfg.language}.\n"
            f"{cards_context}"
            f"Return ONLY JSON: {{reflection, cards, done}}. Limit {limit} cards."
        )
