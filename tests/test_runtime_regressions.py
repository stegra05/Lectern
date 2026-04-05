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
    """Guard V2 router contract for generation/start-resume streaming."""
    router_source = _read_project_file(
        "gui/backend/interface_v2/routers/generation_v2.py"
    )

    assert "/generate-v2" in router_source
    assert "run_generation_stream(req)" in router_source
    assert "run_resume_stream(req)" in router_source
    assert "replay_stream(" in router_source
    assert "serialize_api_event_v2(" in router_source
    assert "lectern.lectern_service" not in router_source


def test_service_delegates_export_to_export_phase():
    """Guard V2 app service stream-version and translation invariants."""
    app_service_source = _read_project_file(
        "lectern/application/generation_app_service.py"
    )

    assert "stream_version" in app_service_source
    assert "stored_stream_version != req.stream_version" in app_service_source
    assert "GenerationErrorCode.RESUME_VERSION_MISMATCH" in app_service_source
    assert "_translator.to_api_event(" in app_service_source
    assert "ServiceEvent" not in app_service_source


def _extract_quoted_literals(block: str) -> set[str]:
    return set(re.findall(r"""['"]([^'"]+)['"]""", block))


def test_backend_event_types_are_supported_by_frontend_sse_schema():
    """Guard backend/frontend event contract drift."""
    backend_source = _read_project_file("gui/backend/sse_emitter.py")
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


def test_service_event_message_defaults_to_empty_string():
    """Guard constructor compatibility for callers omitting message."""
    from gui.backend.sse_emitter import ServiceEvent

    event = ServiceEvent(type="info")

    assert event.message == ""


def test_windows_launcher_runs_startup_preflight_before_webview_start():
    """Guard Windows startup preflight before pywebview boot."""
    launcher_source = _read_project_file("gui/launcher.py")

    assert "prepare_windows_startup" in launcher_source
    assert "require_webview2=not smoke_mode" in launcher_source
    assert "show_windows_startup_error" in launcher_source
    assert "LECTERN_SMOKE_MODE" in launcher_source
    assert "webview.start(gui=gui_backend)" in launcher_source


def test_windows_spec_mentions_webview2_runtime_bundle_path():
    """Guard Windows spec support for optional bundled WebView2 runtime."""
    windows_spec_source = _read_project_file("specs/Lectern.windows.spec")

    assert "webview2-runtime" in windows_spec_source


def test_windows_build_script_verifies_runtime_artifacts():
    """Guard post-build validation for critical Windows runtime files."""
    build_script_source = _read_project_file("scripts/build_windows.ps1")

    assert "Verify-WindowsBundle" in build_script_source
    assert "$PSNativeCommandUseErrorActionPreference" in build_script_source
    assert "Python.Runtime.dll" in build_script_source
    assert "Microsoft.Web.WebView2.Core.dll" in build_script_source


def test_build_release_windows_runs_packaged_launch_smoke_test():
    """Guard CI launch verification for built Windows binary."""
    workflow_source = _read_project_file(".github/workflows/build-release.yml")

    assert "Run Windows launch smoke test" in workflow_source
    assert "$env:LECTERN_SMOKE_MODE = '1'" in workflow_source
    assert "http://127.0.0.1:4173/health" in workflow_source
    assert "dist\\Lectern\\Lectern.exe" in workflow_source


def test_vite_manual_chunks_uses_function_form_for_vite8_compat():
    """Guard against object-form manualChunks breaking Vite 8 rolldown builds."""
    vite_config_source = _read_project_file("gui/frontend/vite.config.ts")

    assert "manualChunks: (id" in vite_config_source
