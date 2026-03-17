"""Orchestration module for managing generation sessions."""

from lectern.orchestration.session_orchestrator import (
    SessionOrchestrator,
    SessionState,
    GenerationConfig,
    GenerationConfig as OrchestratorGenerationConfig,
    ReflectionConfig,
)
from lectern.orchestration.pipeline_context import (
    SessionContext,
    SessionConfig,
    PDFMetadata,
    GenerationTargets,
    PipelinePhase,
)

__all__ = [
    "SessionOrchestrator",
    "SessionState",
    "GenerationConfig",
    "OrchestratorGenerationConfig",
    "ReflectionConfig",
    # New exports
    "SessionContext",
    "SessionConfig",
    "PDFMetadata",
    "GenerationTargets",
    "PipelinePhase",
]
