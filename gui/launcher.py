import os
import sys

# Safety net: Gemini may occasionally output very large integer literals in JSON.
# The SDK parses responses with json.loads, which on Python 3.12+ has a default
# 4300-digit conversion limit.  Raise it to avoid crashes.
sys.set_int_max_str_digits(20_000)

import threading
import time
import uvicorn
import webview
from backend.main import app

def start_server():
    # Run the FastAPI server
    uvicorn.run(app, host="127.0.0.1", port=4173, log_level="error")

def main():
    # Start server in a separate thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Create a native window.
    # NOTE(Windows): Force edgechromium (WebView2) backend explicitly.
    # Without this, pywebview auto-detects and may fall back to mshtml/WinForms,
    # which requires pythonnet/CLR — that fails in a PyInstaller frozen bundle.
    import platform
    gui_backend = "edgechromium" if platform.system() == "Windows" else None
    webview.create_window("Lectern", "http://127.0.0.1:4173", width=1024, height=768, resizable=True, fullscreen=False)
    webview.start(gui=gui_backend)

if __name__ == "__main__":
    main()
