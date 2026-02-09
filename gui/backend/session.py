import os
import time
import threading
from dataclasses import dataclass, field
from typing import Dict, Optional

from fastapi import HTTPException

from service import GenerationService, DraftStore

SESSION_TTL_SECONDS = 60 * 60 * 4


@dataclass
class SessionState:
    session_id: str
    pdf_path: str
    created_at: float = field(default_factory=time.time)
    last_accessed: float = field(default_factory=time.time)
    status: str = "active"
    completed_at: Optional[float] = None

    def touch(self) -> None:
        self.last_accessed = time.time()

@dataclass
class SessionRuntime:
    generation_service: GenerationService
    draft_store: DraftStore


class SessionManager:
    """Thread-safe in-memory session registry for generation runs."""

    def __init__(self):
        self._sessions: Dict[str, SessionState] = {}
        self._runtime: Dict[str, SessionRuntime] = {}
        self._lock = threading.Lock()
        self._latest_session_id: Optional[str] = None

    def create_session(
        self,
        pdf_path: str,
        generation_service: GenerationService,
        draft_store: DraftStore,
    ) -> SessionState:
        from uuid import uuid4

        session_id = uuid4().hex
        session = SessionState(
            session_id=session_id,
            pdf_path=pdf_path,
        )
        runtime = SessionRuntime(
            generation_service=generation_service,
            draft_store=draft_store,
        )
        draft_store.set_session_id(session_id)
        with self._lock:
            self._sessions[session_id] = session
            self._runtime[session_id] = runtime
            self._latest_session_id = session_id
            self._prune_locked()
        return session

    def get_session(self, session_id: str) -> Optional[SessionState]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.touch()
            self._prune_locked()
            return session

    def get_runtime(self, session_id: str) -> Optional[SessionRuntime]:
        with self._lock:
            return self._runtime.get(session_id)

    def get_latest_session(self) -> Optional[SessionState]:
        if not self._latest_session_id:
            return None
        return self.get_session(self._latest_session_id)

    def mark_status(self, session_id: str, status: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            session.status = status
            if status in {"completed", "cancelled", "error"}:
                session.completed_at = time.time()

    def stop_session(self, session_id: str) -> None:
        session = self.get_session(session_id)
        runtime = self.get_runtime(session_id)
        if not session:
            return
        if runtime:
            runtime.generation_service.stop()
        self.mark_status(session_id, "cancelled")
        self._cleanup_session_files(session)
        with self._lock:
            self._sessions.pop(session_id, None)
            self._runtime.pop(session_id, None)

    def cleanup_session(self, session_id: str) -> None:
        session = self.get_session(session_id)
        if not session:
            return
        self._cleanup_session_files(session)
        with self._lock:
            self._sessions.pop(session_id, None)
            self._runtime.pop(session_id, None)

    def prune(self) -> None:
        with self._lock:
            self._prune_locked()

    def _cleanup_session_files(self, session: SessionState) -> None:
        if session.pdf_path and os.path.exists(session.pdf_path):
            try:
                os.remove(session.pdf_path)
            except Exception as e:  # pragma: no cover - best-effort cleanup
                print(f"Warning: Failed to cleanup PDF: {e}")

    def _prune_locked(self) -> None:
        now = time.time()
        to_remove = []
        for session_id, session in self._sessions.items():
            if session.status == "active":
                continue
            completed_at = session.completed_at or session.last_accessed
            if now - completed_at > SESSION_TTL_SECONDS:
                to_remove.append(session_id)
        for session_id in to_remove:
            session = self._sessions.get(session_id)
            if session:
                self._cleanup_session_files(session)
            self._sessions.pop(session_id, None)
            self._runtime.pop(session_id, None)


session_manager = SessionManager()


def _get_session_or_404(session_id: Optional[str], *, require_session_id: bool = False) -> SessionState:
    if require_session_id and not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    session = session_manager.get_session(session_id) if session_id else session_manager.get_latest_session()
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    return session

def _get_runtime_or_404(session_id: str, session: Optional[SessionState] = None) -> SessionRuntime:
    runtime = session_manager.get_runtime(session_id)
    if not runtime:
        raise HTTPException(status_code=404, detail="No active session")
    return runtime

