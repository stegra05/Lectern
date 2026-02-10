import pytest
from cost_estimator import derive_effective_target, estimate_card_cap, compute_suggested_card_count
import config

def test_compute_suggested_card_count_slides():
    # 10 pages, slides mode -> 1 card per slide = 10 cards
    count = compute_suggested_card_count(page_count=10, text_chars=2000, source_type="slides")
    assert count == 10

def test_compute_suggested_card_count_script():
    # 5000 chars, script mode -> (5000/1000) * 3.0 = 15 cards
    count = compute_suggested_card_count(page_count=2, text_chars=5000, source_type="script")
    assert count == 15

def test_derive_effective_target_slides():
    # 10 pages, target 20 -> density 2.0
    density, is_script = derive_effective_target(
        page_count=10, 
        estimated_text_chars=2000, 
        source_type="slides", 
        target_card_count=20, 
        density_target=None
    )
    assert density == 2.0
    assert is_script is False

def test_derive_effective_target_script():
    # 5000 chars, target 10 -> density 10 / (5000/1000) = 2.0
    density, is_script = derive_effective_target(
        page_count=2, 
        estimated_text_chars=5000, 
        source_type="script", 
        target_card_count=10, 
        density_target=None
    )
    assert density == 2.0
    assert is_script is True

def test_estimate_card_cap_respects_target():
    cap, is_script = estimate_card_cap(
        page_count=10, 
        estimated_text_chars=2000, 
        image_count=0, 
        source_type="slides", 
        density_target=None,
        target_card_count=42
    )
    assert cap == 42
    assert is_script is False

def test_estimate_card_cap_fallback():
    # 10 pages, no target -> fallback to config default (usually 1.5)
    cap, _ = estimate_card_cap(
        page_count=10, 
        estimated_text_chars=2000, 
        image_count=0, 
        source_type="slides", 
        density_target=None,
        target_card_count=None
    )
    # Default 1.2 * 10 = 12
    assert cap == 12
