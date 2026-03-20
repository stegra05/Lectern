from __future__ import annotations

from gui.backend import dependencies
from lectern.infrastructure.extractors.pdf_extractor import PdfExtractorAdapter
from lectern.infrastructure.gateways.anki_gateway import AnkiGateway
from lectern.infrastructure.persistence.history_repository_sqlite import HistoryRepositorySqlite
from lectern.infrastructure.providers.gemini_adapter import GeminiAdapter
from lectern.infrastructure.runtime.session_runtime_store import SessionRuntimeStore


def test_get_generation_app_service_v2_is_cached_singleton() -> None:
    dependencies.get_generation_app_service_v2.cache_clear()

    first = dependencies.get_generation_app_service_v2()
    second = dependencies.get_generation_app_service_v2()

    assert first is second


def test_get_generation_app_service_v2_wires_concrete_adapters() -> None:
    dependencies.get_generation_app_service_v2.cache_clear()
    service = dependencies.get_generation_app_service_v2()

    assert isinstance(service._history, HistoryRepositorySqlite)
    assert isinstance(service._runtime_store, SessionRuntimeStore)
    assert service._translator.__class__.__name__ == "EventTranslator"
    assert isinstance(service._pdf_extractor, PdfExtractorAdapter)
    assert isinstance(service._ai_provider, GeminiAdapter)
    assert isinstance(service._anki_gateway, AnkiGateway)
