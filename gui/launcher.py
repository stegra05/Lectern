import os
import sys
import threading
import webbrowser
import time
import uvicorn
from backend.main import app

def start_server():
    # Run the FastAPI server
    # Port 4173 is commonly used for Vite preview, let's use it or 8000
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

def main():
    # Start server in a separate thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Wait a bit for server to start
    time.sleep(2)

    # Open the browser
    print("Opening browser at http://127.0.0.1:8000")
    webbrowser.open("http://127.0.0.1:8000")

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Exiting...")

if __name__ == "__main__":
    main()
