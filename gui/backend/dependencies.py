from lectern.utils.history import HistoryManager
from lectern.lectern_service import LecternGenerationService
from gui.backend.session import session_manager, SessionManager


def get_session_manager() -> SessionManager:
    """Dependency provider for the global session manager."""
    return session_manager


def get_history_manager() -> HistoryManager:
    """Dependency provider for the HistoryManager."""
    return HistoryManager()


def get_generation_service() -> LecternGenerationService:
    """Dependency provider for the LecternGenerationService."""
    return LecternGenerationService()
