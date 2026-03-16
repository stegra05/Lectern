"""Tests for the generation_loop module configuration."""

import pytest
from lectern.generation_loop import (
    GenerationLoopConfig,
    ReflectionLoopConfig,
    DEFAULT_RECENT_CARD_WINDOW,
    DEFAULT_REFLECTION_HARD_CAP_MULTIPLIER,
    DEFAULT_REFLECTION_HARD_CAP_PADDING,
    get_card_key,
    collect_card_fronts,
)


class TestGenerationLoopConfig:
    """Tests for GenerationLoopConfig dataclass."""

    def test_default_recent_card_window(self):
        """Test that recent_card_window defaults to the correct value."""
        config = GenerationLoopConfig(
            total_cards_cap=100,
            actual_batch_size=20,
            focus_prompt=None,
            effective_target=1.2,
            stop_check=None,
        )
        assert config.recent_card_window == DEFAULT_RECENT_CARD_WINDOW
        assert config.recent_card_window == 100

    def test_custom_recent_card_window(self):
        """Test that recent_card_window can be customized."""
        config = GenerationLoopConfig(
            total_cards_cap=100,
            actual_batch_size=20,
            focus_prompt=None,
            effective_target=1.2,
            stop_check=None,
            recent_card_window=50,
        )
        assert config.recent_card_window == 50


class TestReflectionLoopConfig:
    """Tests for ReflectionLoopConfig dataclass."""

    def test_default_values(self):
        """Test that all defaults match expected values."""
        config = ReflectionLoopConfig(
            total_cards_cap=100,
            actual_batch_size=20,
            rounds=2,
            stop_check=None,
        )
        assert config.recent_card_window == DEFAULT_RECENT_CARD_WINDOW
        assert config.hard_cap_multiplier == DEFAULT_REFLECTION_HARD_CAP_MULTIPLIER
        assert config.hard_cap_padding == DEFAULT_REFLECTION_HARD_CAP_PADDING
        assert config.recent_card_window == 100
        assert config.hard_cap_multiplier == 1.2
        assert config.hard_cap_padding == 5

    def test_custom_hard_cap_multiplier(self):
        """Test that hard_cap_multiplier can be customized."""
        config = ReflectionLoopConfig(
            total_cards_cap=100,
            actual_batch_size=20,
            rounds=2,
            stop_check=None,
            hard_cap_multiplier=1.5,
        )
        assert config.hard_cap_multiplier == 1.5

    def test_custom_hard_cap_padding(self):
        """Test that hard_cap_padding can be customized."""
        config = ReflectionLoopConfig(
            total_cards_cap=100,
            actual_batch_size=20,
            rounds=2,
            stop_check=None,
            hard_cap_padding=10,
        )
        assert config.hard_cap_padding == 10

    def test_frozen_dataclass(self):
        """Test that config is immutable (frozen)."""
        config = ReflectionLoopConfig(
            total_cards_cap=100,
            actual_batch_size=20,
            rounds=2,
            stop_check=None,
        )
        # FrozenInstanceError is a subclass of AttributeError in dataclasses
        with pytest.raises(AttributeError, match="cannot assign to field"):
            config.hard_cap_multiplier = 2.0  # type: ignore


class TestGetCardKey:
    """Tests for get_card_key function."""

    def test_text_field(self):
        """Test extracting key from text field."""
        card = {"text": "What is photosynthesis?"}
        assert get_card_key(card) == "what is photosynthesis"

    def test_front_field(self):
        """Test extracting key from front field."""
        card = {"front": "  Multiple   Spaces  "}
        assert get_card_key(card) == "multiple spaces"

    def test_fields_dict_text(self):
        """Test extracting key from fields.Text."""
        card = {"fields": {"Text": "Cloze deletion"}}
        assert get_card_key(card) == "cloze deletion"

    def test_fields_dict_front(self):
        """Test extracting key from fields.Front."""
        card = {"fields": {"Front": "Basic card"}}
        assert get_card_key(card) == "basic card"

    def test_empty_card(self):
        """Test handling empty card."""
        card = {}
        assert get_card_key(card) == ""

    def test_priority_text_over_front(self):
        """Test that text has priority over front."""
        card = {"text": "from text", "front": "from front"}
        assert get_card_key(card) == "from text"


class TestCollectCardFronts:
    """Tests for collect_card_fronts function."""

    def test_empty_list(self):
        """Test handling empty list."""
        assert collect_card_fronts([]) == []

    def test_multiple_cards(self):
        """Test collecting fronts from multiple cards."""
        cards = [
            {"front": "Question 1"},
            {"front": "Question 2"},
            {"front": "Question 3"},
        ]
        result = collect_card_fronts(cards)
        assert len(result) == 3
        assert result[0] == "question 1"
        assert result[1] == "question 2"
        assert result[2] == "question 3"

    def test_truncation_to_120_chars(self):
        """Test that long fronts are truncated to 120 characters."""
        long_text = "x" * 200
        cards = [{"front": long_text}]
        result = collect_card_fronts(cards)
        assert len(result[0]) == 120
