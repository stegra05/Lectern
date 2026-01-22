
import pytest
from unittest.mock import patch, MagicMock
from anki_connector import get_deck_slide_set_patterns

class TestAnkiConnectorPatterns:
    @patch('anki_connector.get_all_tags')
    def test_no_tags(self, mock_get_all_tags):
        mock_get_all_tags.return_value = []
        result = get_deck_slide_set_patterns("MyDeck")
        assert result['slide_sets'] == []
        assert result['pattern'] is None
        assert result['next_number'] is None

    @patch('anki_connector.get_all_tags')
    def test_no_matching_deck(self, mock_get_all_tags):
        mock_get_all_tags.return_value = ["OtherDeck::Lecture-1::Topic"]
        result = get_deck_slide_set_patterns("MyDeck")
        assert result['slide_sets'] == []

    @patch('anki_connector.get_all_tags')
    def test_matching_deck_no_pattern(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Topic1",
            "MyDeck::Topic2::Subtopic"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        # Assuming Topic1 is treated as slide set name
        assert "Topic1" in result['slide_sets']
        assert "Topic2" in result['slide_sets']
        assert result['pattern'] is None

    @patch('anki_connector.get_all_tags')
    def test_lecture_pattern(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Lecture-1::Intro",
            "MyDeck::Lecture-2::Details",
            "MyDeck::Lecture-3::Summary"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        assert set(result['slide_sets']) == {"Lecture-1", "Lecture-2", "Lecture-3"}
        assert result['pattern'] == "lecture"
        assert result['next_number'] == 4
        assert result['example'] is not None
        assert result['example'].startswith("Lecture")

    @patch('anki_connector.get_all_tags')
    def test_week_pattern(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Week_01::Intro",
            "MyDeck::Week_02::Details"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        assert set(result['slide_sets']) == {"Week_01", "Week_02"}
        assert result['pattern'] == "week"
        assert result['next_number'] == 3

    @patch('anki_connector.get_all_tags')
    def test_nested_deck_name(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "University::CS101::Lecture-1::Intro",
            "University::CS101::Lecture-2::Details"
        ]
        result = get_deck_slide_set_patterns("University::CS101")
        assert set(result['slide_sets']) == {"Lecture-1", "Lecture-2"}
        assert result['pattern'] == "lecture"
        assert result['next_number'] == 3

    @patch('anki_connector.get_all_tags')
    def test_mixed_patterns_dominant_wins(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Lecture-1",
            "MyDeck::Lecture-2",
            "MyDeck::Week-1"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        assert "Lecture-1" in result['slide_sets']
        assert "Week-1" in result['slide_sets']
        assert result['pattern'] == "lecture"
        assert result['next_number'] == 3

    @patch('anki_connector.get_all_tags')
    def test_abbreviation_patterns(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Lec-1",
            "MyDeck::Lec-2"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        assert result['pattern'] == 'lecture'
        assert result['next_number'] == 3

    @patch('anki_connector.get_all_tags')
    def test_mixed_abbreviations(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Ch-1",
            "MyDeck::Chapter-2",
            "MyDeck::Chap-3"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        assert result['pattern'] == 'chapter'
        assert result['next_number'] == 4

    @patch('anki_connector.get_all_tags')
    def test_session_abbreviation(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Sess 1",
            "MyDeck::Session 2"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        assert result['pattern'] == 'session'
        assert result['next_number'] == 3

    @patch('anki_connector.get_all_tags')
    def test_module_abbreviation(self, mock_get_all_tags):
        mock_get_all_tags.return_value = [
            "MyDeck::Mod-1",
            "MyDeck::Mod-2"
        ]
        result = get_deck_slide_set_patterns("MyDeck")
        assert result['pattern'] == 'module'
        assert result['next_number'] == 3
