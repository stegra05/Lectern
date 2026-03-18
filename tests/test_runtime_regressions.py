import ast
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
    source = _read_project_file("lectern/lectern_service.py")
    assert "await GenerationPhase().execute(context, emitter, ai)" in source
    assert "derive_effective_target(" not in source
    assert "estimate_card_cap(" not in source
