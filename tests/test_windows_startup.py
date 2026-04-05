from __future__ import annotations

from pathlib import Path

from lectern.infrastructure.runtime import windows_startup


def _configure_windows_test_environment(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(windows_startup.platform, "system", lambda: "Windows")
    monkeypatch.setattr(windows_startup, "ensure_app_dirs", lambda: None)
    monkeypatch.setattr(windows_startup, "get_app_data_dir", lambda: tmp_path)


def test_prepare_windows_startup_reports_missing_dotnet_and_webview2(
    tmp_path: Path, monkeypatch
) -> None:
    _configure_windows_test_environment(tmp_path, monkeypatch)

    monkeypatch.setattr(
        windows_startup,
        "_probe_pythonnet",
        lambda diagnostics: None,
    )

    def dotnet_missing(diagnostics: list[str]) -> bool:
        diagnostics.append("dotnet_desktop_runtime=not_found")
        return False

    def webview2_missing(diagnostics: list[str]) -> bool:
        diagnostics.append("system_webview2_runtime=not_found")
        return False

    monkeypatch.setattr(
        windows_startup,
        "_has_system_dotnet_desktop_runtime",
        dotnet_missing,
        raising=False,
    )
    monkeypatch.setattr(
        windows_startup, "_resolve_bundled_webview2_runtime", lambda diagnostics: None
    )
    monkeypatch.setattr(
        windows_startup, "_has_system_webview2_runtime", webview2_missing
    )

    result = windows_startup.prepare_windows_startup()

    assert result.error_message is not None
    assert ".NET Desktop Runtime (x64) is not available." in result.error_message
    assert "Microsoft Edge WebView2 Runtime is not available." in result.error_message


def test_prepare_windows_startup_skips_webview_requirement_in_smoke_mode(
    tmp_path: Path, monkeypatch
) -> None:
    _configure_windows_test_environment(tmp_path, monkeypatch)

    monkeypatch.setattr(windows_startup, "_probe_pythonnet", lambda diagnostics: None)
    monkeypatch.setattr(
        windows_startup,
        "_has_system_dotnet_desktop_runtime",
        lambda diagnostics: True,
        raising=False,
    )
    monkeypatch.setattr(
        windows_startup, "_resolve_bundled_webview2_runtime", lambda diagnostics: None
    )
    monkeypatch.setattr(
        windows_startup, "_has_system_webview2_runtime", lambda diagnostics: False
    )

    result = windows_startup.prepare_windows_startup(require_webview2=False)

    assert result.error_message is None


def test_prepare_windows_startup_reports_pythonnet_init_failure(
    tmp_path: Path, monkeypatch
) -> None:
    _configure_windows_test_environment(tmp_path, monkeypatch)

    monkeypatch.setattr(
        windows_startup,
        "_probe_pythonnet",
        lambda diagnostics: "Python .NET bridge failed to initialize.",
    )
    monkeypatch.setattr(
        windows_startup,
        "_has_system_dotnet_desktop_runtime",
        lambda diagnostics: True,
        raising=False,
    )
    monkeypatch.setattr(
        windows_startup,
        "_resolve_bundled_webview2_runtime",
        lambda diagnostics: Path("C:/runtime"),
    )
    monkeypatch.setattr(
        windows_startup, "_has_system_webview2_runtime", lambda diagnostics: True
    )

    result = windows_startup.prepare_windows_startup()

    assert result.error_message is not None
    assert "Python .NET bridge failed to initialize." in result.error_message


def test_prepare_windows_startup_returns_runtime_path_when_healthy(
    tmp_path: Path, monkeypatch
) -> None:
    _configure_windows_test_environment(tmp_path, monkeypatch)

    bundled_runtime = tmp_path / "webview2-runtime"
    bundled_runtime.mkdir(parents=True)

    monkeypatch.setattr(windows_startup, "_probe_pythonnet", lambda diagnostics: None)
    monkeypatch.setattr(
        windows_startup,
        "_has_system_dotnet_desktop_runtime",
        lambda diagnostics: True,
        raising=False,
    )
    monkeypatch.setattr(
        windows_startup,
        "_resolve_bundled_webview2_runtime",
        lambda diagnostics: bundled_runtime,
    )
    monkeypatch.setattr(
        windows_startup, "_has_system_webview2_runtime", lambda diagnostics: True
    )

    result = windows_startup.prepare_windows_startup()

    assert result.error_message is None
    assert result.webview2_runtime_path == str(bundled_runtime)


def test_format_startup_error_includes_dependency_actions() -> None:
    message = windows_startup._format_startup_error(
        ["Python .NET bridge failed to initialize."],
        Path("C:/Users/test/AppData/Roaming/Lectern/logs/windows-startup.log"),
    )

    assert "Install .NET Desktop Runtime (x64)." in message
    assert "Install Microsoft Edge WebView2 Runtime (x64)." in message
    assert "Python does not need to be installed on your PC." in message
