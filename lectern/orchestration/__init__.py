"""Orchestration module for managing generation sessions."""

from lectern.orchestration.session_orchestrator import (
    SessionOrchestrator,
    SessionState,
    GenerationConfig,
    GenerationConfig as OrchestratorGenerationConfig,
    ReflectionConfig,
    GenerationSetupConfig,
    GenerationSetupResult,
)
from lectern.orchestration.pipeline_context import (
    SessionContext,
    SessionConfig,
    PDFMetadata,
    GenerationTargets,
    PipelinePhase,
)
from lectern.orchestration.phases import (
    InitializationPhase,
    ConceptMappingPhase,
    GenerationPhase,
    ExportPhase,
    PhaseExecutionHalt,
)

__all__ = [
    "SessionOrchestrator",
    "SessionState",
    "GenerationConfig",
    "OrchestratorGenerationConfig",
    "ReflectionConfig",
    "GenerationSetupConfig",
    "GenerationSetupResult",
    # New exports
    "SessionContext",
    "SessionConfig",
    "PDFMetadata",
    "GenerationTargets",
    "PipelinePhase",
    "InitializationPhase",
    "ConceptMappingPhase",
    "GenerationPhase",
    "ExportPhase",
    "PhaseExecutionHalt",
]
