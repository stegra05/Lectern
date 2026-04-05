from __future__ import annotations

import os
import platform
import subprocess
import sys
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from lectern.utils.path_utils import ensure_app_dirs, get_app_data_dir

_WEBVIEW2_CLIENT_KEYS = (
    "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",  # Runtime
    "{2CD8A007-E189-409D-A2C8-9AF4EF3C72AA}",  # Beta
    "{0D50BFEC-CD6A-4F9A-964C-C7416E3ACB10}",  # Dev
    "{65C35B14-6C1D-4122-AC46-7148CC9D6497}",  # Canary
)
_MIN_WEBVIEW2_VERSION = (86, 0, 622, 0)
_DOTNET_DESKTOP_RUNTIME_NAME = "Microsoft.WindowsDesktop.App"


@dataclass(frozen=True)
class WindowsStartupPreparation:
    error_message: str | None
    webview2_runtime_path: str | None
    diagnostics_log_path: Path | None


def prepare_windows_startup(
    *, require_webview2: bool = True
) -> WindowsStartupPreparation:
    if platform.system() != "Windows":
        return WindowsStartupPreparation(
            error_message=None,
            webview2_runtime_path=None,
            diagnostics_log_path=None,
        )

    ensure_app_dirs()
    diagnostics_log_path = get_app_data_dir() / "logs" / "windows-startup.log"
    diagnostics: list[str] = [
        f"timestamp_utc={datetime.now(timezone.utc).isoformat()}",
        f"python={sys.version}",
        f"executable={sys.executable}",
    ]
    errors: list[str] = []

    dotnet_runtime_ok = _has_system_dotnet_desktop_runtime(diagnostics)
    if not dotnet_runtime_ok:
        errors.append(
            ".NET Desktop Runtime (x64) is not available. "
            "Install it before launching Lectern."
        )
        diagnostics.append("pythonnet_probe=skipped:dotnet_desktop_runtime_missing")
    else:
        pythonnet_error = _probe_pythonnet(diagnostics)
        if pythonnet_error:
            errors.append(pythonnet_error)

    bundled_runtime_path = _resolve_bundled_webview2_runtime(diagnostics)
    system_runtime_ok = _has_system_webview2_runtime(diagnostics)
    if bundled_runtime_path is None and not system_runtime_ok:
        if require_webview2:
            errors.append(
                "Microsoft Edge WebView2 Runtime is not available. "
                "Install WebView2 Runtime or use a Lectern build with bundled runtime."
            )
        else:
            diagnostics.append("webview2_requirement=skipped")

    _write_diagnostics_log(diagnostics_log_path, diagnostics, errors)

    if errors:
        return WindowsStartupPreparation(
            error_message=_format_startup_error(errors, diagnostics_log_path),
            webview2_runtime_path=None,
            diagnostics_log_path=diagnostics_log_path,
        )

    return WindowsStartupPreparation(
        error_message=None,
        webview2_runtime_path=(
            str(bundled_runtime_path) if bundled_runtime_path else None
        ),
        diagnostics_log_path=diagnostics_log_path,
    )


def show_windows_startup_error(message: str) -> None:
    print(message, file=sys.stderr)
    if platform.system() != "Windows":
        return

    try:
        import ctypes

        mb_icon_error = 0x10
        ctypes.windll.user32.MessageBoxW(
            None, message, "Lectern startup error", mb_icon_error
        )
    except Exception:
        pass


def _probe_pythonnet(diagnostics: list[str]) -> str | None:
    try:
        import pythonnet

        version = getattr(pythonnet, "__version__", "unknown")
        diagnostics.append(f"pythonnet_version={version}")

        try:
            import clr  # type: ignore[import-not-found]

            diagnostics.append("pythonnet_clr_import=ok")
        except Exception:
            os.environ["PYTHONNET_RUNTIME"] = "coreclr"
            import clr  # type: ignore[import-not-found]

            diagnostics.append("pythonnet_clr_import=ok:coreclr")
        return None
    except Exception as exc:
        diagnostics.append(f"pythonnet_load=error:{type(exc).__name__}:{exc}")
        diagnostics.extend(_format_traceback(exc))
        return (
            "Python .NET bridge failed to initialize. "
            "This usually means the Windows runtime dependencies are missing "
            "or the app bundle is incompatible."
        )


def _has_system_dotnet_desktop_runtime(diagnostics: list[str]) -> bool:
    cli_versions = _dotnet_desktop_runtime_versions_from_cli(diagnostics)
    if cli_versions:
        diagnostics.append(f"dotnet_desktop_runtime=found_cli:{','.join(cli_versions)}")
        return True

    registry_versions = _dotnet_desktop_runtime_versions_from_registry(diagnostics)
    if registry_versions:
        diagnostics.append(
            f"dotnet_desktop_runtime=found_registry:{','.join(registry_versions)}"
        )
        return True

    diagnostics.append("dotnet_desktop_runtime=not_found")
    return False


def _dotnet_desktop_runtime_versions_from_cli(diagnostics: list[str]) -> list[str]:
    try:
        process = subprocess.run(
            ["dotnet", "--list-runtimes"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except FileNotFoundError:
        diagnostics.append("dotnet_cli=not_found")
        return []
    except Exception as exc:
        diagnostics.append(f"dotnet_cli=error:{type(exc).__name__}:{exc}")
        return []

    if process.returncode != 0:
        diagnostics.append(f"dotnet_cli=exit_code:{process.returncode}")
        stderr = (process.stderr or "").strip()
        if stderr:
            diagnostics.append(f"dotnet_cli_stderr={stderr[:200]}")
        return []

    versions: list[str] = []
    for line in (process.stdout or "").splitlines():
        if not line.startswith(f"{_DOTNET_DESKTOP_RUNTIME_NAME} "):
            continue
        parts = line.split()
        if len(parts) >= 2:
            versions.append(parts[1])

    return sorted(set(versions))


def _dotnet_desktop_runtime_versions_from_registry(
    diagnostics: list[str],
) -> list[str]:
    try:
        import winreg
    except Exception:
        diagnostics.append("dotnet_registry=unavailable:winreg_import_failed")
        return []

    registry_paths = [
        (
            winreg.HKEY_LOCAL_MACHINE,
            rf"SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\{_DOTNET_DESKTOP_RUNTIME_NAME}",
        ),
        (
            winreg.HKEY_LOCAL_MACHINE,
            rf"SOFTWARE\WOW6432Node\dotnet\Setup\InstalledVersions\x64\sharedfx\{_DOTNET_DESKTOP_RUNTIME_NAME}",
        ),
        (
            winreg.HKEY_CURRENT_USER,
            rf"SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\{_DOTNET_DESKTOP_RUNTIME_NAME}",
        ),
    ]

    versions: set[str] = set()

    for hive, path in registry_paths:
        try:
            with winreg.OpenKey(hive, path) as registry_key:
                index = 0
                while True:
                    try:
                        name, _, _ = winreg.EnumValue(registry_key, index)
                    except OSError:
                        break

                    if isinstance(name, str) and name:
                        versions.add(name)
                    index += 1
        except FileNotFoundError:
            continue
        except Exception as exc:
            diagnostics.append(
                f"dotnet_registry=error:{type(exc).__name__}:{exc}@{path}"
            )

    return sorted(versions)


def _resolve_bundled_webview2_runtime(diagnostics: list[str]) -> Path | None:
    candidates: list[Path] = []

    env_path = os.environ.get("LECTERN_WEBVIEW2_RUNTIME_PATH")
    if env_path:
        candidates.append(Path(env_path))

    exe_dir = Path(sys.executable).resolve().parent
    candidates.extend(
        [
            exe_dir / "webview2-runtime",
            exe_dir / "_internal" / "webview2-runtime",
            exe_dir / "Lectern_internal" / "webview2-runtime",
        ]
    )

    if hasattr(sys, "_MEIPASS"):
        meipass_dir = Path(getattr(sys, "_MEIPASS"))
        candidates.append(meipass_dir / "webview2-runtime")

    project_root = Path(__file__).resolve().parents[3]
    candidates.append(project_root / "resources" / "webview2-runtime")

    for path in candidates:
        if path.exists() and path.is_dir():
            diagnostics.append(f"bundled_webview2_runtime=found:{path}")
            return path

    diagnostics.append("bundled_webview2_runtime=not_found")
    return None


def _has_system_webview2_runtime(diagnostics: list[str]) -> bool:
    try:
        import winreg
    except Exception:
        diagnostics.append("system_webview2_runtime=unavailable:winreg_import_failed")
        return False

    registry_paths = []
    for key in _WEBVIEW2_CLIENT_KEYS:
        registry_paths.append(
            (winreg.HKEY_CURRENT_USER, rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{key}")
        )
        registry_paths.append(
            (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{key}")
        )
        registry_paths.append(
            (
                winreg.HKEY_LOCAL_MACHINE,
                rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{key}",
            )
        )

    for hive, path in registry_paths:
        try:
            with winreg.OpenKey(hive, path) as registry_key:
                version_value = winreg.QueryValueEx(registry_key, "pv")[0]
                if _version_at_least(version_value, _MIN_WEBVIEW2_VERSION):
                    diagnostics.append(
                        f"system_webview2_runtime=found:{version_value}@{path}"
                    )
                    return True
        except FileNotFoundError:
            continue
        except Exception as exc:
            diagnostics.append(
                f"system_webview2_runtime=error:{type(exc).__name__}:{exc}"
            )

    diagnostics.append("system_webview2_runtime=not_found")
    return False


def _version_at_least(version_text: str, minimum: tuple[int, int, int, int]) -> bool:
    version_parts: list[int] = []
    for part in version_text.split("."):
        if not part.isdigit():
            return False
        version_parts.append(int(part))

    while len(version_parts) < 4:
        version_parts.append(0)

    return tuple(version_parts[:4]) >= minimum


def _write_diagnostics_log(
    path: Path, diagnostics: list[str], errors: list[str]
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["[startup]"] + diagnostics
    if errors:
        lines.append("[errors]")
        lines.extend(errors)
    else:
        lines.append("[errors]")
        lines.append("none")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _format_startup_error(errors: list[str], log_path: Path) -> str:
    summary = "\n- ".join(errors)
    return (
        "Lectern cannot start on this Windows machine.\n\n"
        "Detected issue(s):\n"
        f"- {summary}\n\n"
        "Try this:\n"
        "1) Install .NET Desktop Runtime (x64).\n"
        "2) Install Microsoft Edge WebView2 Runtime (x64).\n"
        "3) Re-download the latest Windows release and fully extract the zip.\n"
        "4) Start Lectern again.\n\n"
        "Python does not need to be installed on your PC.\n"
        f"Diagnostics log: {log_path}"
    )


def _format_traceback(exc: BaseException) -> list[str]:
    return [
        line.rstrip("\n")
        for line in traceback.format_exception(type(exc), exc, exc.__traceback__)
    ]
