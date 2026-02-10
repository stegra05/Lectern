import pytest
from lectern.ai_prompts import PromptBuilder, PromptConfig, FORMATTING_RULES

class TestPromptStructure:
    def test_system_instruction_basic(self):
        config = PromptConfig(language="en")
        builder = PromptBuilder(config)
        sys_prompt = builder.system
        
        assert "expert educator" in sys_prompt
        assert "language" in sys_prompt.lower()
        assert "en" in sys_prompt
        assert FORMATTING_RULES in sys_prompt
        assert "USER FOCUS" not in sys_prompt

    def test_system_instruction_with_focus(self):
        config = PromptConfig(language="fr", focus_prompt="calculus")
        builder = PromptBuilder(config)
        sys_prompt = builder.system
        
        assert "fr" in sys_prompt
        assert "USER FOCUS" in sys_prompt
        assert "calculus" in sys_prompt

    def test_concept_map_structure(self):
        config = PromptConfig()
        builder = PromptBuilder(config)
        prompt = builder.concept_map()
        
        assert "expert educator" in prompt
        assert "JSON" in prompt
        assert "objectives, concepts, relations" in prompt

    def test_concept_map_with_focus(self):
        config = PromptConfig(focus_prompt="Deep Learning")
        builder = PromptBuilder(config)
        prompt = builder.concept_map()
        
        assert "USER REQUESTED \"Deep Learning\"" in prompt

    def test_generation_prompt_args(self):
        config = PromptConfig(language="de")
        builder = PromptBuilder(config)
        prompt = builder.generation(
            limit=5,
            pacing_hint="Slide 5 of 10",
            slide_coverage="Covered: 1, 2"
        )
        
        assert "Generate" in prompt
        assert "5" in prompt
        assert "Slide 5 of 10" in prompt
        assert "Covered: 1, 2" in prompt
        assert "Language" in prompt
        assert "de" in prompt
        assert "Global Concept Map" in prompt

    def test_reflection_prompt(self):
        config = PromptConfig()
        builder = PromptBuilder(config)
        prompt = builder.reflection(limit=3)
        
        assert "Quality Assurance Specialist" in prompt
        assert "Critique Criteria" in prompt
        assert "Limit 3 cards" in prompt

    def test_card_examples_formatting(self):
        """Ensure examples are valid JSON-like structures in the prompt."""
        config = PromptConfig()
        builder = PromptBuilder(config)
        sys_prompt = builder.system
        
        # Should contain the quadratic formula example
        assert "quadratic formula" in sys_prompt
        assert "x =" in sys_prompt
