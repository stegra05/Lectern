
import json
import time
import os
import tempfile
import random
import string
import sys
from pathlib import Path

# Add project root to sys.path to allow imports if needed
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

def generate_large_state(num_cards=10000):
    """Generates a large dummy state dictionary with num_cards."""
    state = {
        "pdf_path": "/path/to/dummy.pdf",
        "deck_name": "Dummy Deck",
        "cards": [],
        "concept_map": {"concepts": []},
        "history": [],
        "log_path": "/path/to/log.txt",
        "slide_set_name": "Dummy Slide Set",
    }

    chars = string.ascii_letters + string.digits
    for i in range(num_cards):
        card = {
            "front": "".join(random.choices(chars, k=200)), # Simulate content
            "back": "".join(random.choices(chars, k=300)),
            "tags": ["tag1", "tag2", "tag3", f"slide-{i}"],
            "id": i,
            "slide_number": i % 100,
            "image": None # Could add dummy base64 here if needed
        }
        state["cards"].append(card)
        state["history"].append({"action": "add_card", "card_id": card["id"], "timestamp": time.time()})

    return state

def benchmark_save(state, indent=None):
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
        start_time = time.time()
        json.dump(state, tmp, ensure_ascii=False, indent=indent)
        tmp_path = tmp.name

    end_time = time.time()
    file_size = os.path.getsize(tmp_path)
    os.remove(tmp_path)
    return end_time - start_time, file_size

if __name__ == "__main__":
    print("Generating large state object (approx 50k cards)...")
    # 50000 cards to make it noticeable
    state = generate_large_state(num_cards=50000)

    # Measure initial size in memory (rough estimate)
    import sys
    print(f"State object generated.")

    print(f"Benchmarking with indent=2 (Current Implementation)...")
    time_indent, size_indent = benchmark_save(state, indent=2)
    print(f"Time with indent=2: {time_indent:.4f}s")
    print(f"Size with indent=2: {size_indent / 1024 / 1024:.2f} MB")

    print(f"Benchmarking with indent=None (Proposed Optimization)...")
    time_no_indent, size_no_indent = benchmark_save(state, indent=None)
    print(f"Time with indent=None: {time_no_indent:.4f}s")
    print(f"Size with indent=None: {size_no_indent / 1024 / 1024:.2f} MB")

    if time_indent > 0:
        improvement = (time_indent - time_no_indent) / time_indent * 100
        print(f"\nTime Improvement: {improvement:.2f}%")

    if size_indent > 0:
        size_reduction = (size_indent - size_no_indent) / size_indent * 100
        print(f"Size Reduction: {size_reduction:.2f}%")
