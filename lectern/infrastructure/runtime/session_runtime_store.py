from __future__ import annotations

import asyncio
import inspect
from typing import Any

from lectern.application.ports import RuntimeSessionStorePort


class SessionRuntimeStore(RuntimeSessionStorePort):
    """In-memory runtime session registry with single active handle semantics."""

    def __init__(self) -> None:
        self._active_session_id: str | None = None
        self._active_handle: Any | None = None
        self._lock = asyncio.Lock()

    async def start(self, session_id: str, handle: Any) -> None:
        async with self._lock:
            if self._active_handle is not None:
                raise RuntimeError("An active session handle already exists")
            self._active_session_id = session_id
            self._active_handle = handle

    async def stop(self, session_id: str) -> bool:
        handle: Any | None = None
        async with self._lock:
            if self._active_session_id != session_id or self._active_handle is None:
                return False
            handle = self._active_handle
            self._active_session_id = None
            self._active_handle = None

        await self._stop_handle(handle)
        return True

    async def get(self, session_id: str) -> Any | None:
        async with self._lock:
            if self._active_session_id != session_id:
                return None
            return self._active_handle

    async def is_running(self, session_id: str) -> bool:
        return (await self.get(session_id)) is not None

    async def _stop_handle(self, handle: Any) -> None:
        if handle is None:
            return

        if hasattr(handle, "stop"):
            result = handle.stop()
            if inspect.isawaitable(result):
                await result
            return

        if hasattr(handle, "cancel"):
            result = handle.cancel()
            if inspect.isawaitable(result):
                await result
