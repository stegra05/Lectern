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
# NOTE: Using 'fields' as native object, matching the updated schema
_CARD_DATA = [
    {
        "model_name": "Basic", 
        "fields": [
            {"name": "Front", "value": "State the quadratic formula."}, 
            {"name": "Back", "value": r"Key idea: <b>roots</b>. Formula: \(x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}\)."}
        ],
        "tags": ["algebra"]
    },
    {
        "model_name": "Cloze",
        "fields": [
            {"name": "Text", "value": r"The derivative of \(x^n\) is {{c1::\(n x^{n-1}\)}}."}
        ],
        "tags": ["calculus"]
    },
    {
        "model_name": "Basic",
        "fields": [
            {"name": "Front", "value": "Loss oscillates wildly during training. What is the most likely cause?"}, 
            {"name": "Back", "value": "<b>Learning rate is too high</b>. The steps overshoot the minimum."}
        ], 
        "tags": ["optimization"]
    },
    {
        "model_name": "Basic",
        "fields": [
            {"name": "Front", "value": "Compare <b>L1</b> and <b>L2</b> regularization effects."}, 
            {"name": "Back", "value": "<b>L1</b>: Yields sparse weights (feature selection).\n<b>L2</b>: Shrinks all weights uniformly (prevents overfitting)."}
        ],
        "tags": ["regularization"]
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
            "- Relations: Map the *semantic structure* (e.g., `is_a`, `part_of`, `causes`, `contrasts_with`). Note page references.\n"
            "- Language: Detect the primary language of the slides (e.g. 'en', 'de', 'fr'). Return the ISO 639-1 code.\n"
            "- Slide Set Name: Generate a semantic name for this slide set (e.g., 'Lecture 2 Introduction To Machine Learning'). "
            "Use Title Case, max 8 words. Include lecture/week number if present.\n"
            "- Formatting: STRICTLY AVOID Markdown in text fields. Use HTML.\n"
            "Return ONLY a JSON object with keys: objectives, concepts, relations, language, slide_set_name. No prose.\n"
        )

    def generation(
        self,
        limit: int,
        pacing_hint: str = "",
        avoid_text: str = "",
        tag_context: str = "",
        slide_coverage: str = "",
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
            "- Principles:\n"
            "    - Atomicity: One idea per card.\n"
            "    - Variety: Mix Definitions, Comparisons, Applications.\n"
            "- Important: Continue generating cards to cover ALL concepts. Do NOT set 'done' to true until exhausted.\n"
            f"{focus_instruction}\n"
            "- Format:\n"
            "    - Prefer Cloze for definitions/lists. Basic for open-ended questions.\n"
            "    - STRICTLY AVOID Markdown. Use HTML for formatting.\n"
            f"{tag_context}"
            f"{avoid_text}"
            f"{slide_coverage}"
            "    - `slide_topic`: Specific section/topic (Title Case).\n"
            "    - `slide_number`: Integer page number.\n"
            "    - `rationale`: Brief (1 sentence) value proposition.\n"
        )

    def reflection(self, limit: int) -> str:
        """Build the reflection prompt."""
        focus_context = ""
        if self.cfg.focus_prompt:
            focus_context = f"- Check alignment with user focus: \"{self.cfg.focus_prompt}\"\n"

        return (
            "You are a Quality Assurance Specialist. Review the last batch.\n"
            "Critique Criteria:\n"
            "    - Redundancy: Duplicate/overlapping?\n"
            "    - Vagueness: Ambiguous?\n"
            "    - Complexity: Too long? (Split it!)\n"
            f"{focus_context}"
            "Action:\n"
            "    - Write a concise `reflection`.\n"
            "    - Generate improved replacements or gap-filling cards.\n"
            f"Language: Ensure all content is in {self.cfg.language}.\n"
            f"Return ONLY JSON: {{reflection, cards, done}}. Limit {limit} cards."
        )
