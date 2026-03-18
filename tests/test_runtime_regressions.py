import ast
import re
from pathlib import Path


def _read_project_file(relative_path: str) -> str:
    project_root = Path(__file__).resolve().parents[1]
    return (project_root / relative_path).read_text(encoding="utf-8")


def test_stream_to_logger_implements_isatty():
    """Guard against uvicorn formatter crashes requiring isatty()."""
    source = _read_project_file("gui/backend/main.py")
    module = ast.parse(source)
    stream_cls = next(
        (
            node
            for node in module.body
            if isinstance(node, ast.ClassDef) and node.name == "StreamToLogger"
        ),
        None,
    )
    assert stream_cls is not None
    method_names = {
        node.name for node in stream_cls.body if isinstance(node, ast.FunctionDef)
    }
    assert "isatty" in method_names


def test_service_delegates_generation_to_generation_phase():
    """Guard against reintroducing generation heuristics in the service layer."""
    service_source = _read_project_file("lectern/lectern_service.py")
    orchestrator_source = _read_project_file("lectern/orchestration/session_orchestrator.py")
    phases_source = _read_project_file("lectern/orchestration/phases.py")

    assert "run_orchestration_entry(" in service_source
    assert "build_orchestration_phases()" in orchestrator_source
    assert "GenerationPhase()" in phases_source
    assert "derive_effective_target(" not in service_source
    assert "estimate_card_cap(" not in service_source


def test_service_delegates_export_to_export_phase():
    """Guard against reintroducing export internals in the service layer."""
    service_source = _read_project_file("lectern/lectern_service.py")
    phases_source = _read_project_file("lectern/orchestration/phases.py")

    assert "ExportPhase()" in phases_source
    assert "export_card_to_anki(" not in service_source


def _extract_quoted_literals(block: str) -> set[str]:
    return set(re.findall(r"""['"]([^'"]+)['"]""", block))


def test_backend_event_types_are_supported_by_frontend_sse_schema():
    """Guard backend/frontend event contract drift."""
    backend_source = _read_project_file("lectern/events/service_events.py")
    frontend_sse_source = _read_project_file("gui/frontend/src/schemas/sse.ts")

    backend_match = re.search(r"EventType\s*=\s*Literal\[(.*?)\]", backend_source, re.S)
    frontend_match = re.search(
        r"ProgressEventTypeSchema\s*=\s*z\.enum\(\[(.*?)\]\)",
        frontend_sse_source,
        re.S,
    )

    assert backend_match is not None
    assert frontend_match is not None

    backend_event_types = _extract_quoted_literals(backend_match.group(1))
    frontend_event_types = _extract_quoted_literals(frontend_match.group(1))

    missing_in_frontend = backend_event_types - frontend_event_types
    assert not missing_in_frontend, (
        "Frontend SSE schema is missing backend event types: "
        f"{sorted(missing_in_frontend)}"
    )
