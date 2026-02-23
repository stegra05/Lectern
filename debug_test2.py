import pytest
from unittest.mock import MagicMock
import asyncio

async def run_test():
    async def mock_run_generation(*args, **kwargs):
        from lectern.lectern_service import ServiceEvent
        yield ServiceEvent("info", "starting", {})
        yield ServiceEvent("done", "completed", {})

    mock_service = MagicMock()
    mock_service.run_generation = mock_run_generation

    # Simulate what main.py does
    async for event in mock_service.run_generation():
        print("Type:", type(event), "Value:", event)

asyncio.run(run_test())
