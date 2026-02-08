import pytest
import asyncio
import json
from unittest.mock import MagicMock, AsyncMock, patch
from gui.backend.service import DraftStore, GenerationService, ProgressEvent, ServiceEvent

# --- DraftStore Tests ---

def test_draft_store_crud():
    store = DraftStore()
    
    # Initial state
    assert store.cards == []
    assert store.deck_name == ""
    
    # Set drafts
    cards = [{"front": "Q1", "back": "A1"}]
    store.set_drafts(
        cards=cards,
        deck_name="Test Deck",
        model_name="Basic",
        tags=["t1"],
        entry_id="e1",
        slide_set_name="L1 Intro"
    )
    
    assert len(store.get_drafts()) == 1
    assert store.deck_name == "Test Deck"
    assert store.slide_set_name == "L1 Intro"
    assert store.entry_id == "e1"
    
    # Update draft
    new_card = {"front": "Q1-Mod", "back": "A1"}
    success = store.update_draft(0, new_card)
    assert success is True
    assert store.get_drafts()[0]["front"] == "Q1-Mod"
    
    # Update invalid index
    assert store.update_draft(99, {}) is False
    
    # Delete draft
    success = store.delete_draft(0)
    assert success is True
    assert len(store.get_drafts()) == 0
    
    # Clear
    store.set_drafts([{}], "D", "M", [])
    store.clear()
    assert store.cards == []
    assert store.deck_name == ""

# --- GenerationService Tests ---

@pytest.fixture
def mock_core_service():
    with patch("gui.backend.service.LecternGenerationService") as MockService:
        instance = MockService.return_value
        yield instance

@pytest.mark.asyncio
async def test_generation_service_run_flow(mock_core_service):
    draft_store = DraftStore()
    service = GenerationService(draft_store)
    
    # Mock the generator to yield a sequence of events
    # The real service returns a generator logic, but run_generation wraps it in asyncio.to_thread(next)
    # The `service.core.run` returns an iterator.
    
    mock_iterator = iter([
        ServiceEvent("progress_start", "Starting..."),
        ServiceEvent("step_start", "Analyzing PDF"),
        ServiceEvent("info", "PDF loaded"),
        ServiceEvent("step_end", "Analysis complete", data={"success": True}),
        ServiceEvent("done", "Finished", data={"cards": [{"q": "1"}], "slide_set_name": "L1"})
    ])
    mock_core_service.run.return_value = mock_iterator
    
    # Run the generator
    events = []
    async for event_json in service.run_generation(
        pdf_path="test.pdf",
        deck_name="Deck",
        model_name="Basic",
        tags=["tag"],
    ):
        events.append(json.loads(event_json))
        
    # Validation
    assert len(events) > 0
    assert events[0]["type"] == "progress_start"
    
    # Check if done event updated the draft store
    assert draft_store.deck_name == "Deck"
    assert len(draft_store.cards) == 1
    assert draft_store.slide_set_name == "L1"

@pytest.mark.asyncio
async def test_generation_service_cancellation(mock_core_service):
    draft_store = DraftStore()
    service = GenerationService(draft_store)
    
    # Mock iterator that never ends, to test manual stop
    def infinite_gen():
        while True:
            yield ServiceEvent("status", "working...")
            
    mock_core_service.run.return_value = infinite_gen()
    
    # Create a task to run generation
    gen_task = asyncio.create_task(
        _consume_generator(service.run_generation("p", "d", "m", []))
    )
    
    # Let it run a bit
    await asyncio.sleep(0.1)
    
    # Stop it
    service.stop()
    
    # Await result
    events = await gen_task
    
    # Should have a cancelled event
    assert events[-1]["type"] == "cancelled"
    assert service.stop_requested is True

async def _consume_generator(gen):
    events = []
    async for item in gen:
        events.append(json.loads(item))
    return events
