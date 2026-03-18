import asyncio
from typing import Any, AsyncGenerator, Dict, Optional
import logging

from lectern.events.service_events import ServiceEvent
from lectern.snapshot import SnapshotTracker

logger = logging.getLogger(__name__)


class PipelineEmitter:
    """
    Encapsulates event emission and state tracking during the generation pipeline.
    Replaces the nested async generator boilerplate in the service layer.
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.tracker = SnapshotTracker(session_id)
        # Limit queue size to 256 events to prevent memory leaks if consumer is slow
        self.queue: asyncio.Queue[Optional[ServiceEvent]] = asyncio.Queue(maxsize=256)
        self._closed = False

    async def stream(self) -> AsyncGenerator[ServiceEvent, None]:
        """Yields events from the internal queue until close() is called."""
        while True:
            event = await self.queue.get()
            if event is None:  # Sentinel value for stream end
                self.queue.task_done()
                break
            yield event
            self.queue.task_done()

    async def close(self):
        """Signals the end of the event stream. Idempotent and non-blocking."""
        if not self._closed:
            self._closed = True
            try:
                self.queue.put_nowait(None)
            except asyncio.QueueFull:
                # If the queue is full, we can't put the sentinel,
                # but the consumer is likely already gone or stuck.
                pass

    def is_closed(self) -> bool:
        return self._closed

    async def emit(
        self, event_type: str, message: str, data: Optional[Dict[str, Any]] = None
    ):
        """Base emission method. Routes through SnapshotTracker before queueing."""
        if self._closed:
            return

        event_data = data or {}
        event = ServiceEvent(event_type, message, event_data)

        try:
            snapshot = self.tracker.process_event(
                event_type=event.type,
                event_data=event.data,
                event_message=event.message,
            )
            if snapshot:
                snap_event = ServiceEvent(
                    "control_snapshot",
                    "State snapshot update",
                    snapshot.to_dict(),
                )
                await self._queue_event(snap_event)
        except Exception as e:
            logger.error(
                f"Snapshot tracking failed for event {event_type}: {e}", exc_info=True
            )

        await self._queue_event(event)

    async def _queue_event(self, event: ServiceEvent):
        """Internal helper to queue events with backpressure, but non-blocking for terminal events."""
        if self._closed and event.type != "cancelled":
            return

        # Terminal/Critical events should not block even if the queue is full
        if event.type in ("cancelled", "error", "done"):
            try:
                self.queue.put_nowait(event)
            except asyncio.QueueFull:
                # If full, we replace the oldest item with this critical one to ensure delivery
                try:
                    self.queue.get_nowait()
                    self.queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
            return

        await self.queue.put(event)

    async def emit_event(self, event: ServiceEvent):
        """Emits an already constructed ServiceEvent."""
        if self._closed:
            return

        try:
            snapshot = self.tracker.process_event(
                event_type=event.type,
                event_data=event.data,
                event_message=event.message,
            )
            if snapshot:
                snap_event = ServiceEvent(
                    "control_snapshot",
                    "State snapshot update",
                    snapshot.to_dict(),
                )
                await self._queue_event(snap_event)
        except Exception as e:
            logger.error(
                f"Snapshot tracking failed for event {event.type}: {e}", exc_info=True
            )

        await self._queue_event(event)

    # --- Semantic helpers ---

    async def step_start(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("step_start", message, data)

    async def step_end(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("step_end", message, data)

    async def progress_start(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("progress_start", message, data)

    async def progress_update(
        self, message: str, data: Optional[Dict[str, Any]] = None
    ):
        await self.emit("progress_update", message, data)

    async def info(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("info", message, data)

    async def warning(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("warning", message, data)

    async def error(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("error", message, data)

    async def done(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("done", message, data)

    async def note(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("note", message, data)

    async def cancelled(self, message: str, data: Optional[Dict[str, Any]] = None):
        await self.emit("cancelled", message, data)
