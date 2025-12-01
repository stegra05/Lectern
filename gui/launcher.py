import os
import sys
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

    # Create a native window
    webview.create_window("Lectern", "http://127.0.0.1:4173", width=1024, height=768, resizable=True)
    webview.start()

if __name__ == "__main__":
    main()
