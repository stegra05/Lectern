
import os
import sys
import platform

def beep() -> None:
    """Emit a system beep."""
    sys.stdout.write("\a")
    sys.stdout.flush()

def send_notification(title: str, message: str) -> None:
    """Send a system notification."""
    system = platform.system()
    try:
        if system == "Darwin":
            # macOS
            script = f'display notification "{message}" with title "{title}"'
            os.system(f"osascript -e '{script}'")
        elif system == "Linux":
            # Linux (notify-send)
            # Check if notify-send exists
            if os.system("which notify-send > /dev/null 2>&1") == 0:
                os.system(f'notify-send "{title}" "{message}"')
    except Exception:
        pass
