"""Centralized prompt templates for Lectern AI.

Refactored from ai_common.py and ai_client.py to reduce redundancy
and enforce language consistency.
"""

from dataclasses import dataclass
from typing import List

# --- Constants ---
FORMATTING_RULES = (
    "- Use LaTeX/MathJax for math: inline \\( ... \\), display \\[ ... \\].\n"
    "- Use HTML for non-math emphasis: <b>...</b> or <strong>...</strong>; italics with <i>...</i> or <em>...</em>.\n"
    "- For math bold: \\textbf{...} (text), \\mathbf{...} or \\boldsymbol{...} (symbols). Do not use HTML inside math.\n"
    "- Never use Markdown (no **bold**, headers, or code fences).\n"
    "- JSON must escape backslashes (e.g., \\\\frac, \\\\alpha).\n"
)

# Base card examples (Normal Mode)
BASIC_EXAMPLES = (
    "Examples:\n"
    '  Basic: {"model_name":"Basic","fields":{"Front":"State the quadratic formula.", '
    '"Back":"Key idea: <b>roots</b>. Formula: \\(x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}\\)."},"tags":["algebra"]}\n'
    '  Cloze: {"model_name":"Cloze","fields":{"Text":"The derivative of \\(x^n\\) is '
    '{{c1::\\(n x^{n-1}\\)}}."},"tags":["calculus"]}\n'
)

# Exam mode examples (Comparison/Scenario focus)
EXAM_EXAMPLES = (
    "Examples (Exam Mode):\n"
    '  Scenario: {"model_name":"Basic","fields":{"Front":"Loss oscillates wildly during training. What is the most likely cause?", '
    '"Back":"<b>Learning rate is too high</b>. The steps overshoot the minimum."}, "tags":["optimization"]}\n'
    '  Comparison: {"model_name":"Basic","fields":{"Front":"Compare <b>L1</b> and <b>L2</b> regularization effects.", '
    '"Back":"<b>L1</b>: Yields sparse weights (feature selection).\\n<b>L2</b>: Shrinks all weights uniformly (prevents overfitting)."}, "tags":["regularization"]}\n'
)

@dataclass
class PromptConfig:
    language: str = "en"
    exam_mode: bool = False

class PromptBuilder:
    def __init__(self, config: PromptConfig):
        self.cfg = config

    @property
    def system(self) -> str:
        """Build the system instruction."""
        lang_instruction = f"Output language: {self.cfg.language}"
        mode_context = self._get_mode_context_system()
        
        examples = EXAM_EXAMPLES if self.cfg.exam_mode else BASIC_EXAMPLES
        
        return (
            f"You are an expert educator creating Anki flashcards.\n"
            f"{lang_instruction}\n"
            f"{mode_context}\n"
            f"Formatting:\n{FORMATTING_RULES}\n"
            f"{examples}"
        )

    def _get_mode_context_system(self) -> str:
        if self.cfg.exam_mode:
            return (
                "EXAM CRAM MODE (HIGH YIELD ONLY):\n"
                "You are generating flashcards for a high-stakes university exam in 8 days. Time is limited.\n"
                "IGNORE basic definitions, trivial facts, and simple lists. Focus ONLY on what distinguishes concepts.\n"
                "Card Types: 50% Scenario/Application, 40% Comparison, 10% Deep Intuition."
            )
        return (
            "Goal: Create a comprehensive spaced repetition deck.\n"
            "Principles: Atomicity, Minimum Information Principle, Variety (Definitions, Comparisons, Applications)."
        )

    def concept_map(self) -> str:
        """Build the concept map prompt."""
        exam_context = ""
        if self.cfg.exam_mode:
            exam_context = (
                "- Focus: EXAM MODE ENABLED. Prioritize concepts that are likely to be tested "
                "(definitions, key distinctions, causal relationships). Ignore trivial background info.\n"
            )

        return (
            "You are an expert educator and knowledge architect. Analyze the following lecture slides to construct a comprehensive global concept map.\n"
            f"{exam_context}"
            "- Objectives: Extract explicit learning goals and implicit competency targets.\n"
            "- Concepts: Identify the core entities, theories, and definitions. Prioritize *fundamental* concepts. Assign stable, short, unique IDs.\n"
            "- Relations: Map the *semantic structure* (e.g., `is_a`, `part_of`, `causes`, `contrasts_with`). Note page references.\n"
            "- Language: Detect the primary language of the slides (e.g. 'en', 'de', 'fr'). Return the ISO 639-1 code.\n"
            "- Formatting: STRICTLY AVOID Markdown in text fields. Use HTML.\n"
            "Return ONLY a JSON object with keys: objectives (array), concepts (array), relations (array), language (string). No prose.\n"
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
        mode_instructions = self._get_mode_instructions_gen()
        
        return (
            f"Generate up to {int(limit)} high-quality, atomic Anki notes continuing from our prior turns.\n"
            "CRITICAL: Consult the Global Concept Map. Cover the 'Relations' identified there.\n"
            f"Language: Ensure all content is in {self.cfg.language}.\n"
            f"{pacing_hint}"
            f"{mode_instructions}\n"
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

    def _get_mode_instructions_gen(self) -> str:
        if self.cfg.exam_mode:
            return (
                "- Principles (CRAM MODE):\n"
                "    - STRICTLY FILTER: If a concept is trivial, DO NOT create a card.\n"
                "    - Focus on 'Scenario' (Application) and 'Comparison' cards.\n"
                "- Important: Only generate cards for concepts that are EXAM-CRITICAL and NON-OBVIOUS.\n"
                "- If high-yield core is covered, set 'done' to true immediately."
            )
        return (
            "- Principles:\n"
            "    - Atomicity: One idea per card.\n"
            "    - Variety: Mix Definitions, Comparisons, Applications.\n"
            "- Important: Continue generating cards to cover ALL concepts. Do NOT set 'done' to true until exhausted."
        )

    def reflection(self, limit: int) -> str:
        """Build the reflection prompt."""
        if self.cfg.exam_mode:
            return (
                "EXAM CRAM REFLECTION:\n"
                "You are a ruthless tutor preparing a student for a hard exam.\n"
                "Review the last batch. DELETE/REWRITE any that are 'fluff' or trivial.\n"
                "Action:\n"
                "- If too simple -> Rewrite as scenario-based.\n"
                "- Consolidate simple cards into robust comparisons.\n"
                "- Ensure 50% Application / 40% Comparison ratio.\n"
                f"Language: Ensure all content is in {self.cfg.language}.\n"
                f"Return ONLY JSON: {{reflection, cards, done}}. Limit {limit} cards."
            )
        return (
            "You are a Quality Assurance Specialist. Review the last batch.\n"
            "Critique Criteria:\n"
            "    - Redundancy: Duplicate/overlapping?\n"
            "    - Vagueness: Ambiguous?\n"
            "    - Complexity: Too long? (Split it!)\n"
            "Action:\n"
            "    - Write a concise `reflection`.\n"
            "    - Generate improved replacements or gap-filling cards.\n"
            f"Language: Ensure all content is in {self.cfg.language}.\n"
            f"Return ONLY JSON: {{reflection, cards, done}}. Limit {limit} cards."
        )
