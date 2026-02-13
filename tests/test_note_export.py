import pytest
from unittest.mock import MagicMock, patch
from lectern.utils.note_export import resolve_model_name, build_card_tags, export_card_to_anki
from lectern import config

# Test resolve_model_name
@patch("lectern.utils.note_export.get_model_names", return_value=[])
def test_resolve_model_name_basic(_mock_models):
    """Test resolution of 'Basic' model variants (no Anki connection)."""
    import lectern.utils.note_export as _ne
    _ne._anki_models_cache = None
    assert resolve_model_name("Basic", "fallback") == config.DEFAULT_BASIC_MODEL
    _ne._anki_models_cache = None
    assert resolve_model_name("basic", "fallback") == config.DEFAULT_BASIC_MODEL
    _ne._anki_models_cache = None
    assert resolve_model_name(config.DEFAULT_BASIC_MODEL, "fallback") == config.DEFAULT_BASIC_MODEL

@patch("lectern.utils.note_export.get_model_names", return_value=[])
def test_resolve_model_name_cloze(_mock_models):
    """Test resolution of 'Cloze' model variants (no Anki connection)."""
    import lectern.utils.note_export as _ne
    _ne._anki_models_cache = None
    assert resolve_model_name("Cloze", "fallback") == config.DEFAULT_CLOZE_MODEL
    _ne._anki_models_cache = None
    assert resolve_model_name("cloze", "fallback") == config.DEFAULT_CLOZE_MODEL
    _ne._anki_models_cache = None
    assert resolve_model_name(config.DEFAULT_CLOZE_MODEL, "fallback") == config.DEFAULT_CLOZE_MODEL

@patch("lectern.utils.note_export.get_model_names", return_value=[])
def test_resolve_model_name_fallback(_mock_models):
    """Test fallback when model is empty or None (no Anki connection)."""
    # Clear cache so the mock is used
    import lectern.utils.note_export as _ne
    _ne._anki_models_cache = None
    assert resolve_model_name("", "MyFallback") == "MyFallback"
    _ne._anki_models_cache = None
    assert resolve_model_name(None, "MyFallback") == "MyFallback"
    _ne._anki_models_cache = None
    assert resolve_model_name("   ", "MyFallback") == "MyFallback"

@patch("lectern.utils.note_export.get_model_names", return_value=[])
def test_resolve_model_name_custom(_mock_models):
    """Test that unknown models are passed through (no Anki connection)."""
    import lectern.utils.note_export as _ne
    _ne._anki_models_cache = None
    assert resolve_model_name("CustomModel", "fallback") == "CustomModel"

@patch("lectern.utils.note_export.get_model_names", return_value=["Basic", "Cloze", "MyCustom"])
def test_resolve_model_name_anki_validation(_mock_models):
    """Test that configured model names are validated against Anki."""
    import lectern.utils.note_export as _ne
    _ne._anki_models_cache = None
    # A model that exists in Anki passes through
    assert resolve_model_name("MyCustom", "fallback") == "MyCustom"
    # A model that does NOT exist falls back to "Basic"
    _ne._anki_models_cache = None
    assert resolve_model_name("NonExistent", "fallback") == "Basic"

# Test build_card_tags
@patch("lectern.utils.note_export.build_hierarchical_tags")
def test_build_card_tags(mock_build_hierarchical):
    """Test building tags with user tags and defaults (3-level hierarchy)."""
    # Mock return value
    mock_build_hierarchical.return_value = ["Deck::Set::Topic"]
    
    card = {
        "slide_topic": "MyTopic"
    }
    deck_name = "MyDeck"
    slide_set = "MySlideSet"
    additional_tags = ["user_tag"]
    
    result = build_card_tags(card, deck_name, slide_set, additional_tags)
    
    # Expected: additional_tags + default tag as flat tags
    expected_extra = ["user_tag"]
    if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG:
        expected_extra.append(config.DEFAULT_TAG)
        
    mock_build_hierarchical.assert_called_once_with(
        deck_name=deck_name,
        slide_set_name=slide_set,
        topic="MyTopic",
        additional_tags=expected_extra
    )
    assert result == ["Deck::Set::Topic"]

@patch("lectern.utils.note_export.build_hierarchical_tags")
def test_build_card_tags_dedup(mock_build_hierarchical):
    """Test that additional tags are deduplicated."""
    mock_build_hierarchical.return_value = []
    card = {"slide_topic": "Topic"}
    additional_tags = ["tag1", "tag1", "tag2"]
    
    build_card_tags(card, "Deck", "Set", additional_tags)
    
    call_args = mock_build_hierarchical.call_args[1]
    extra_arg = call_args["additional_tags"]
    
    # "tag1" should appear only once. "tag2" should be present.
    assert extra_arg.count("tag1") == 1
    assert "tag2" in extra_arg
    
    if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG:
         assert config.DEFAULT_TAG in extra_arg

# Test export_card_to_anki
@patch("lectern.utils.note_export.add_note")
@patch("lectern.utils.note_export.build_hierarchical_tags")
def test_export_card_to_anki_success(mock_build_tags, mock_add_note):
    """Test successful card export."""
    mock_add_note.return_value = 12345
    mock_build_tags.return_value = ["Tag1"]

    card = {
        "model_name": "Basic",
        "front": "Q",
        "back": "A",
        "tags": ["tag1"],
    }
    
    result = export_card_to_anki(
        card=card,
        deck_name="Deck",
        slide_set_name="Set",
        fallback_model="Basic",
        additional_tags=[]
    )
    
    assert result.success is True
    assert result.note_id == 12345
    assert result.error is None
    
    # Verify interactions
    # Check if add_note was called with correct model resolution
    mock_add_note.assert_called_once()
    args, _ = mock_add_note.call_args
    # add_note(deck_name, model_name, fields, tags)
    assert args[1] == config.DEFAULT_BASIC_MODEL

@patch("lectern.utils.note_export.add_note")
@patch("lectern.utils.note_export.build_hierarchical_tags")
def test_export_card_to_anki_no_media(mock_build_tags, mock_add_note):
    """Test export without optional fields."""
    mock_add_note.return_value = 12345
    
    card = {
        "model_name": "Basic",
        "front": "Q",
        "back": "A",
    }
    
    result = export_card_to_anki(
        card=card,
        deck_name="Deck",
        slide_set_name="Set",
        fallback_model="Basic",
        additional_tags=[]
    )
    
    assert result.success is True

@patch("lectern.utils.note_export.add_note")
def test_export_card_to_anki_failure(mock_add_note):
    """Test handling of AnkiConnect errors."""
    mock_add_note.side_effect = RuntimeError("Anki Error")
    
    card = {"model_name": "Basic", "front": "", "back": ""}
    result = export_card_to_anki(
        card=card,
        deck_name="Deck",
        slide_set_name="Set",
        fallback_model="Basic",
        additional_tags=[]
    )
    
    assert result.success is False
    assert "Anki Error" in result.error
    assert result.note_id is None
