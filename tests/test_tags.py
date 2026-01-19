
import pytest
from utils.tags import build_hierarchical_tags, infer_slide_set_name, _normalize_segment

class TestTags:
    def test_normalize_segment(self):
        assert _normalize_segment("  Test   String  ") == "Test String"
        assert _normalize_segment("Test_String") == "Test_String"
        assert _normalize_segment("Test-String") == "Test-String"
        assert _normalize_segment("Test@#$String") == "Test-String"
        assert _normalize_segment("multiple   spaces") == "multiple spaces"
        assert _normalize_segment("multiple---dashes") == "multiple-dashes"

    def test_build_hierarchical_tags_basic(self):
        tags = build_hierarchical_tags(
            deck_name="Machine Learning",
            slide_set_name="Lecture 1",
            topic="Introduction",
            tags=["basics", "history"]
        )
        assert len(tags) == 2
        assert tags[0] == "Machine-Learning::Lecture-1::Introduction::basics"
        assert tags[1] == "Machine-Learning::Lecture-1::Introduction::history"

    def test_build_hierarchical_tags_empty_topic(self):
        tags = build_hierarchical_tags(
            deck_name="Machine Learning",
            slide_set_name="Lecture 1",
            topic="",
            tags=["basics"]
        )
        assert tags[0] == "Machine-Learning::Lecture-1::basics"

    def test_build_hierarchical_tags_nested_deck(self):
        tags = build_hierarchical_tags(
            deck_name="CS::Machine Learning",
            slide_set_name="Lecture 1",
            topic="Intro",
            tags=["basics"]
        )
        assert tags[0] == "CS::Machine-Learning::Lecture-1::Intro::basics"

    def test_build_hierarchical_tags_special_chars(self):
        tags = build_hierarchical_tags(
            deck_name="C++ Programming",
            slide_set_name="Lecture #1",
            topic="I/O Streams",
            tags=["std::cout"]
        )
        # Special chars should be normalized
        # "C++ Programming" -> "C-Programming" (since + is not allowed in _NON_ALLOWED unless added, let's check implementation)
        # Wait, _NON_ALLOWED = re.compile(r"[^a-zA-Z0-9_\-\s]+") 
        # So "C++" becomes "C-".
        # "Lecture #1" -> "Lecture-1"
        # "I/O Streams" -> "I-O-Streams"
        # "std::cout" -> "std-cout" (slug_segment)
        
        # Actually checking the implementation:
        # deck_name: _tag_segment -> _normalize_segment -> s.replace(" ", "-")
        # slide_set_name: _tag_segment(title_case=True)
        # topic: _tag_segment(title_case=True)
        # tag: _slug_segment -> _normalize_segment(preserve_case=False) -> replace " " with "-"
        
        # C++ -> C- (multiple dashes collapsed to one)
        
        assert tags[0] == "C-Programming::Lecture-1::I-O-Streams::std-cout"

    def test_infer_slide_set_name_pattern(self):
        pattern_info = {'pattern': 'lecture', 'next_number': 5}
        
        # Test 1: Title matches pattern
        name = infer_slide_set_name(
            pdf_title="Lecture 5: Neural Networks",
            pattern_info=pattern_info
        )
        assert name == "Lecture 5 Neural Networks"
        
        # Test 2: Filename matches pattern
        name = infer_slide_set_name(
            pdf_title="",
            pattern_info=pattern_info,
            pdf_filename="Lecture_05_Slides"
        )
        assert name == "Lecture 05"

    def test_infer_slide_set_name_structured_title(self):
        name = infer_slide_set_name(
            pdf_title="Week 3 - Deep Learning",
            pattern_info={}
        )
        assert name == "Week 3 Deep Learning"

    def test_infer_slide_set_name_simple_title(self):
        name = infer_slide_set_name(
            pdf_title="Introduction to Python",
            pattern_info={}
        )
        assert name == "Introduction To Python"

    def test_infer_slide_set_name_filename_fallback(self):
        name = infer_slide_set_name(
            pdf_title="",
            pattern_info={},
            pdf_filename="2023-10-15_Advanced_Algorithms_v2"
        )
        # "2023-10-15_Advanced_Algorithms_v2" -> clean date -> "Advanced_Algorithms_v2" -> clean version -> "Advanced_Algorithms"
        # -> replace _ with space -> "Advanced Algorithms"
        assert name == "Advanced Algorithms"

    def test_infer_slide_set_name_empty(self):
        name = infer_slide_set_name(
            pdf_title="",
            pattern_info={},
            pdf_filename=""
        )
        assert name == ""
