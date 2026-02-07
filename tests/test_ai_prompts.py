import pytest
from ai_prompts import PromptBuilder, PromptConfig

def test_prompt_builder_defaults():
    cfg = PromptConfig()
    builder = PromptBuilder(cfg)
    
    system = builder.system
    assert "Output language: en" in system
    assert "Atomicity" in system
    assert "EXAM CRAM REFLECTION" not in builder.reflection(10)

def test_prompt_builder_focus_prompt():
    cfg = PromptConfig(focus_prompt="Focus on definitions")
    builder = PromptBuilder(cfg)
    
    system = builder.system
    assert 'USER FOCUS: "Focus on definitions"' in system

def test_prompt_builder_language():
    cfg = PromptConfig(language="de")
    builder = PromptBuilder(cfg)
    
    system = builder.system
    assert "Output language: de" in system
    
    gen = builder.generation(10)
    assert "Ensure all content is in de" in gen
    
    reflect = builder.reflection(10)
    assert "Ensure all content is in de" in reflect

def test_concept_map_prompt():
    cfg = PromptConfig()
    builder = PromptBuilder(cfg)
    
    prompt = builder.concept_map()
    assert "construct a comprehensive global concept map" in prompt
    assert "ISO 639-1 code" in prompt
    assert "language (string)" in prompt

import json
from ai_prompts import CARD_EXAMPLES

def _parse_examples_helper(example_str):
    """
    Extract JSON objects from the example string.
    The format is '  Type: {...}'
    """
    examples = []
    lines = example_str.split('\n')
    for line in lines:
        if ':' in line:
            # Find first {
            start = line.find('{')
            if start != -1:
                json_str = line[start:]
                try:
                    obj = json.loads(json_str)
                    examples.append(obj)
                except json.JSONDecodeError:
                    pass
    return examples

def test_card_examples_are_valid_json():
    examples = _parse_examples_helper(CARD_EXAMPLES)
    assert len(examples) >= 2
    for ex in examples:
        assert "model_name" in ex
        assert "fields_json" in ex, "Examples must use fields_json (string) not fields (dict)"
        # Verify fields_json is a string that parses to a dict
        assert isinstance(ex["fields_json"], str)
        fields = json.loads(ex["fields_json"])
        assert isinstance(fields, dict)
        if "Front" in fields:
            assert isinstance(fields["Front"], str)
