import threading
import os
import uvicorn
import webview
from backend.main import app
from lectern.infrastructure.runtime.windows_startup import (
    prepare_windows_startup,
    show_windows_startup_error,
)


def start_server():
    # Run the FastAPI server
    uvicorn.run(app, host="127.0.0.1", port=4173, log_level="error")


def main():
    startup_prep = prepare_windows_startup()
    if startup_prep.error_message:
        show_windows_startup_error(startup_prep.error_message)
        return

    if startup_prep.webview2_runtime_path:
        webview.settings["WEBVIEW2_RUNTIME_PATH"] = startup_prep.webview2_runtime_path
        os.environ["LECTERN_WEBVIEW2_RUNTIME_PATH"] = startup_prep.webview2_runtime_path

    # Start server in a separate thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Create a native window.
    # NOTE(Windows): Force edgechromium (WebView2) backend explicitly.
    # Without this, pywebview auto-detects and may fall back to mshtml/WinForms,
    # which requires pythonnet/CLR — that fails in a PyInstaller frozen bundle.
    import platform

    gui_backend = "edgechromium" if platform.system() == "Windows" else None
    webview.create_window(
        "Lectern",
        "http://127.0.0.1:4173",
        width=1024,
        height=768,
        resizable=True,
        fullscreen=False,
    )
    webview.start(gui=gui_backend)


if __name__ == "__main__":
    main()
