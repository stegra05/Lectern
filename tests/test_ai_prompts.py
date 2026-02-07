import pytest
from ai_prompts import PromptBuilder, PromptConfig

def test_prompt_builder_defaults():
    cfg = PromptConfig()
    builder = PromptBuilder(cfg)
    
    system = builder.system
    assert "Output language: en" in system
    assert "Atomicity" in system
    assert "EXAM CRAM REFLECTION" not in builder.reflection(10)

def test_prompt_builder_exam_mode():
    cfg = PromptConfig(exam_mode=True)
    builder = PromptBuilder(cfg)
    
    system = builder.system
    assert "EXAM CRAM MODE" in system
    assert "HIGH YIELD ONLY" in system
    assert "Scenario/Application" in system
    
    gen = builder.generation(10)
    assert "STRICTLY FILTER" in gen
    assert "EXAM-CRITICAL" in gen

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
