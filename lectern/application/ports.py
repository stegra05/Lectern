from __future__ import annotations

from typing import Any, AsyncIterator, Protocol

from lectern.application.dto import (
    ApiEventV2,
    CancelGenerationRequest,
    ReplayStreamRequest,
    ResumeGenerationRequest,
    StartGenerationRequest,
)

PDFMetadata = Any
UploadedDocument = Any
ConceptMapResult = Any
GenerationAIContext = Any
GenerateResult = Any
ReflectionAIContext = Any
ReflectResult = Any
SessionInit = Any
DomainEventRecord = Any
SessionSnapshot = Any
RuntimeHandle = Any
AnkiStatus = Any
ExportRequest = Any
ExportResult = Any
CancelResult = Any


class PdfExtractorPort(Protocol):
    async def extract_metadata(self, pdf_path: str) -> PDFMetadata: ...


class AIProviderPort(Protocol):
    async def upload_document(self, pdf_path: str) -> UploadedDocument: ...

    async def build_concept_map(self, file_uri: str, mime_type: str) -> ConceptMapResult: ...

    async def generate_cards(
        self,
        *,
        limit: int,
        context: GenerationAIContext,
    ) -> GenerateResult: ...

    async def reflect_cards(
        self,
        *,
        limit: int,
        context: ReflectionAIContext,
    ) -> ReflectResult: ...

    def drain_warnings(self) -> list[str]: ...


class HistoryRepositoryPort(Protocol):
    async def create_session(self, init: SessionInit) -> None: ...

    async def update_phase(self, session_id: str, phase: str) -> None: ...

    async def append_events(self, session_id: str, events: list[DomainEventRecord]) -> None: ...

    async def sync_state(self, snapshot: SessionSnapshot) -> None: ...

    async def mark_terminal(self, session_id: str, status: str) -> None: ...

    async def get_session(self, session_id: str) -> SessionSnapshot | None: ...

    async def get_events_after(
        self,
        session_id: str,
        *,
        after_sequence_no: int,
        limit: int = 1000,
    ) -> list[DomainEventRecord]: ...


class RuntimeSessionStorePort(Protocol):
    async def start(self, session_id: str, handle: RuntimeHandle) -> None: ...

    async def stop(self, session_id: str) -> bool: ...

    async def get(self, session_id: str) -> RuntimeHandle | None: ...

    async def is_running(self, session_id: str) -> bool: ...


class AnkiGatewayPort(Protocol):
    async def check_ready(self) -> AnkiStatus: ...

    async def export_cards(self, request: ExportRequest) -> ExportResult: ...


class GenerationAppService(Protocol):
    async def run_generation_stream(
        self,
        req: StartGenerationRequest,
    ) -> AsyncIterator[ApiEventV2]: ...

    async def run_resume_stream(self, req: ResumeGenerationRequest) -> AsyncIterator[ApiEventV2]: ...

    async def replay_stream(self, req: ReplayStreamRequest) -> AsyncIterator[ApiEventV2]: ...

    async def cancel(self, req: CancelGenerationRequest) -> CancelResult: ...
