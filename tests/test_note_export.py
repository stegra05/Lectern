import pytest
from unittest.mock import MagicMock, patch
import base64
from utils.note_export import resolve_model_name, build_card_tags, export_card_to_anki, ExportResult
import config

# Test resolve_model_name
def test_resolve_model_name_basic():
    """Test resolution of 'Basic' model variants."""
    assert resolve_model_name("Basic", "fallback") == config.DEFAULT_BASIC_MODEL
    assert resolve_model_name("basic", "fallback") == config.DEFAULT_BASIC_MODEL
    assert resolve_model_name(config.DEFAULT_BASIC_MODEL, "fallback") == config.DEFAULT_BASIC_MODEL

def test_resolve_model_name_cloze():
    """Test resolution of 'Cloze' model variants."""
    assert resolve_model_name("Cloze", "fallback") == config.DEFAULT_CLOZE_MODEL
    assert resolve_model_name("cloze", "fallback") == config.DEFAULT_CLOZE_MODEL
    assert resolve_model_name(config.DEFAULT_CLOZE_MODEL, "fallback") == config.DEFAULT_CLOZE_MODEL

def test_resolve_model_name_fallback():
    """Test fallback when model is empty or None."""
    assert resolve_model_name("", "MyFallback") == "MyFallback"
    assert resolve_model_name(None, "MyFallback") == "MyFallback"
    assert resolve_model_name("   ", "MyFallback") == "MyFallback"

def test_resolve_model_name_custom():
    """Test that unknown models are passed through."""
    assert resolve_model_name("CustomModel", "fallback") == "CustomModel"

# Test build_card_tags
@patch("utils.note_export.build_hierarchical_tags")
def test_build_card_tags(mock_build_hierarchical):
    """Test building tags with AI tags, user tags, and defaults."""
    # Mock return value
    mock_build_hierarchical.return_value = ["Deck::Set::Topic::Tag"]
    
    card = {
        "tags": ["ai_tag1", "ai_tag2"],
        "slide_topic": "MyTopic"
    }
    deck_name = "MyDeck"
    slide_set = "MySlideSet"
    additional_tags = ["user_tag"]
    
    result = build_card_tags(card, deck_name, slide_set, additional_tags)
    
    # Expected: ai_tags + additional_tags + default tag
    expected_tags = ["ai_tag1", "ai_tag2", "user_tag"]
    if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG:
        expected_tags.append(config.DEFAULT_TAG)
        
    mock_build_hierarchical.assert_called_once_with(
        deck_name=deck_name,
        slide_set_name=slide_set,
        topic="MyTopic",
        tags=expected_tags
    )
    assert result == ["Deck::Set::Topic::Tag"]

@patch("utils.note_export.build_hierarchical_tags")
def test_build_card_tags_dedup(mock_build_hierarchical):
    """Test that tags are deduplicated."""
    mock_build_hierarchical.return_value = []
    card = {"tags": ["tag1"]}
    additional_tags = ["tag1", "tag2"]
    
    build_card_tags(card, "Deck", "Set", additional_tags)
    
    call_args = mock_build_hierarchical.call_args[1]
    tags_arg = call_args["tags"]
    
    # "tag1" should appear only once. "tag2" should be present.
    # We verify the list content ignoring order for robustness, although function preserves order
    assert tags_arg.count("tag1") == 1
    assert "tag2" in tags_arg
    
    if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG:
         assert config.DEFAULT_TAG in tags_arg

# Test export_card_to_anki
@patch("utils.note_export.add_note")
@patch("utils.note_export.store_media_file")
@patch("utils.note_export.build_hierarchical_tags")
def test_export_card_to_anki_success(mock_build_tags, mock_store_media, mock_add_note):
    """Test successful card export including media."""
    mock_add_note.return_value = 12345
    mock_store_media.return_value = "lectern-1.png"
    mock_build_tags.return_value = ["Tag1"]
    
    # Create valid base64 data for the test
    fake_b64 = base64.b64encode(b"fake_image_data").decode("utf-8")
    
    card = {
        "model_name": "Basic",
        "fields": {"Front": "Q", "Back": "A"},
        "tags": ["tag1"],
        "media": [{"filename": "img.png", "data": fake_b64}]
    }
    
    result = export_card_to_anki(
        card=card,
        card_index=1,
        deck_name="Deck",
        slide_set_name="Set",
        fallback_model="Basic",
        additional_tags=[]
    )
    
    assert result.success is True
    assert result.note_id == 12345
    assert result.media_uploaded == ["img.png"]
    assert result.error is None
    
    # Verify interactions
    # Check if store_media_file was called with filename "img.png"
    mock_store_media.assert_called_with("img.png", b"fake_image_data")
    
    # Check if add_note was called with correct model resolution
    mock_add_note.assert_called_once()
    args, _ = mock_add_note.call_args
    # add_note(deck_name, model_name, fields, tags)
    assert args[1] == config.DEFAULT_BASIC_MODEL

@patch("utils.note_export.add_note")
@patch("utils.note_export.store_media_file")
@patch("utils.note_export.build_hierarchical_tags")
def test_export_card_to_anki_no_media(mock_build_tags, mock_store_media, mock_add_note):
    """Test export without media."""
    mock_add_note.return_value = 12345
    
    card = {
        "model_name": "Basic",
        "fields": {"Front": "Q", "Back": "A"},
    }
    
    result = export_card_to_anki(
        card=card,
        card_index=1,
        deck_name="Deck",
        slide_set_name="Set",
        fallback_model="Basic",
        additional_tags=[]
    )
    
    assert result.success is True
    mock_store_media.assert_not_called()
    assert result.media_uploaded == []

@patch("utils.note_export.add_note")
def test_export_card_to_anki_failure(mock_add_note):
    """Test handling of AnkiConnect errors."""
    mock_add_note.side_effect = RuntimeError("Anki Error")
    
    card = {"fields": {}}
    result = export_card_to_anki(
        card=card,
        card_index=1,
        deck_name="Deck",
        slide_set_name="Set",
        fallback_model="Basic",
        additional_tags=[]
    )
    
    assert result.success is False
    assert "Anki Error" in result.error
    assert result.note_id is None
