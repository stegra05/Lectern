
import pytest
from utils.tags import build_hierarchical_tags, infer_slide_set_name, _clean_tag_part

class TestTags:
    def test_clean_tag_part_basic(self):
        """Test the unified _clean_tag_part function."""
        assert _clean_tag_part("  Test   String  ") == "Test-String"
        assert _clean_tag_part("Test_String") == "Test_String"
        assert _clean_tag_part("Test-String") == "Test-String"
        assert _clean_tag_part("Test@#$String") == "Test-String"
        assert _clean_tag_part("multiple   spaces") == "multiple-spaces"

    def test_clean_tag_part_title_case(self):
        """Test title case normalization."""
        assert _clean_tag_part("hello world", title_case=True) == "Hello-World"
        assert _clean_tag_part("ML basics", title_case=True) == "ML-Basics"  # Preserve acronyms
        assert _clean_tag_part("lecture 1", title_case=True) == "Lecture-1"

    def test_clean_tag_part_slug(self):
        """Test slug (lowercase) normalization."""
        assert _clean_tag_part("HELLO World", slug=True) == "hello-world"
        assert _clean_tag_part("ML Basics", slug=True) == "ml-basics"

    def test_build_hierarchical_tags_basic(self):
        tags = build_hierarchical_tags(
            deck_name="Machine Learning",
            slide_set_name="Lecture 1",
            topic="Introduction",
        )
        assert len(tags) == 1
        assert tags[0] == "Machine-Learning::Lecture-1::Introduction"

    def test_build_hierarchical_tags_empty_topic(self):
        tags = build_hierarchical_tags(
            deck_name="Machine Learning",
            slide_set_name="Lecture 1",
            topic="",
        )
        assert tags[0] == "Machine-Learning::Lecture-1"

    def test_build_hierarchical_tags_nested_deck(self):
        tags = build_hierarchical_tags(
            deck_name="CS::Machine Learning",
            slide_set_name="Lecture 1",
            topic="Intro",
        )
        assert tags[0] == "CS::Machine-Learning::Lecture-1::Intro"

    def test_build_hierarchical_tags_special_chars(self):
        tags = build_hierarchical_tags(
            deck_name="C++ Programming",
            slide_set_name="Lecture #1",
            topic="I/O Streams",
        )
        # Special chars normalized: ++ -> -, # -> -, / -> -
        assert tags[0] == "C-Programming::Lecture-1::I-O-Streams"

    def test_build_hierarchical_tags_with_additional_tags(self):
        tags = build_hierarchical_tags(
            deck_name="Machine Learning",
            slide_set_name="Lecture 1",
            topic="Introduction",
            additional_tags=["my-tag", "study"],
        )
        assert len(tags) == 3
        assert tags[0] == "Machine-Learning::Lecture-1::Introduction"
        assert tags[1] == "my-tag"
        assert tags[2] == "study"

    def test_infer_slide_set_name_simple_title(self):
        """The new simplified version just uses title as-is."""
        name = infer_slide_set_name(pdf_title="Introduction to Python")
        assert name == "Introduction-To-Python"

    def test_infer_slide_set_name_filename_fallback(self):
        name = infer_slide_set_name(
            pdf_title="",
            pdf_filename="Advanced_Algorithms"
        )
        # Underscores replaced with spaces, then title cased
        assert name == "Advanced-Algorithms"

    def test_infer_slide_set_name_empty(self):
        name = infer_slide_set_name(pdf_title="", pdf_filename="")
        assert name == ""
