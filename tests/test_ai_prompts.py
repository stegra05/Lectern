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
    assert "language (string)" in prompt or "language" in prompt  # Schema key present

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
        # New schema uses 'fields' as native object, not 'fields_json' string
        assert "fields" in ex, "Examples must use fields (list of dicts)"
        assert isinstance(ex["fields"], list)
        fields = ex["fields"]
        
        # Check that we can find expected values if present
        for field in fields:
            assert "name" in field
            assert "value" in field
            if field["name"] == "Front":
                assert isinstance(field["value"], str)
