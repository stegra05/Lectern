import os
import sys
from pathlib import Path

def get_app_data_dir() -> Path:
    """
    Get the platform-specific directory for application data.
    - macOS: ~/Library/Application Support/Lectern
    - Windows: %APPDATA%/Lectern
    - Linux: ~/.config/lectern or $XDG_CONFIG_HOME/lectern
    """
    if sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / "Lectern"
    elif sys.platform == "win32":
        path = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Lectern"
    else:
        # Linux / Unix
        config_home = os.environ.get("XDG_CONFIG_HOME")
        if config_home:
            path = Path(config_home) / "lectern"
        else:
            path = Path.home() / ".config" / "lectern"
    
    return path

def ensure_app_dirs() -> None:
    """Ensure all required application directories exist."""
    base_dir = get_app_data_dir()
    for sub in ["logs", "state"]:
        (base_dir / sub).mkdir(parents=True, exist_ok=True)
