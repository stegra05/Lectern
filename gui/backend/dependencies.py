from functools import lru_cache

from lectern.application.generation_app_service import GenerationAppServiceImpl
from lectern.application.translators.event_translator import EventTranslator
from lectern.infrastructure.extractors.pdf_extractor import PdfExtractorAdapter
from lectern.infrastructure.gateways.anki_gateway import AnkiGateway
from lectern.infrastructure.persistence.history_repository_sqlite import HistoryRepositorySqlite
from lectern.infrastructure.providers.gemini_adapter import GeminiAdapter
from lectern.infrastructure.runtime.session_runtime_store import SessionRuntimeStore
from lectern.lectern_service import LecternGenerationService
from lectern.utils.history import HistoryManager
from lectern.utils.path_utils import get_app_data_dir
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


@lru_cache(maxsize=1)
def get_history_repository_v2() -> HistoryRepositorySqlite:
    """Build and cache the V2 history repository."""
    db_path = get_app_data_dir() / "state" / "history_v2.sqlite3"
    return HistoryRepositorySqlite(db_path=db_path)


@lru_cache(maxsize=1)
def get_generation_app_service_v2() -> GenerationAppServiceImpl:
    """Build and cache the V2 generation app service with concrete adapters."""
    return GenerationAppServiceImpl(
        history=get_history_repository_v2(),
        runtime_store=SessionRuntimeStore(),
        translator=EventTranslator(),
        pdf_extractor=PdfExtractorAdapter(),
        ai_provider=GeminiAdapter(),
        anki_gateway=AnkiGateway(),
    )
