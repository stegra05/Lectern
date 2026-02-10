import pytest
import sys
import os
from pathlib import Path
from unittest.mock import patch, MagicMock
from lectern.utils.path_utils import get_app_data_dir, ensure_app_dirs

def test_get_app_data_dir_darwin():
    with patch("sys.platform", "darwin"), \
         patch("pathlib.Path.home", return_value=Path("/users/test")):
        path = get_app_data_dir()
        assert path == Path("/users/test/Library/Application Support/Lectern")

def test_get_app_data_dir_windows():
    with patch("sys.platform", "win32"), \
         patch.dict(os.environ, {"APPDATA": "C:\\AppData"}), \
         patch("pathlib.Path.home", return_value=Path("/users/test")):
        path = get_app_data_dir()
        assert path.as_posix().replace('\\', '/') == "C:/AppData/Lectern"

def test_get_app_data_dir_windows_no_env():
    with patch("sys.platform", "win32"), \
         patch.dict(os.environ, {}, clear=True), \
         patch("pathlib.Path.home", return_value=Path("/users/test")):
        path = get_app_data_dir()
        # Fallback in code: Path.home() / "AppData" / "Roaming"
        assert path.as_posix() == "/users/test/AppData/Roaming/Lectern"

def test_get_app_data_dir_linux_xdg():
    with patch("sys.platform", "linux"), \
         patch.dict(os.environ, {"XDG_CONFIG_HOME": "/custom/config"}), \
         patch("pathlib.Path.home", return_value=Path("/home/test")):
        path = get_app_data_dir()
        assert path == Path("/custom/config/lectern")

def test_get_app_data_dir_linux_no_xdg():
    with patch("sys.platform", "linux"), \
         patch.dict(os.environ, {}, clear=True), \
         patch("pathlib.Path.home", return_value=Path("/home/test")):
        path = get_app_data_dir()
        assert path == Path("/home/test/.config/lectern")

def test_ensure_app_dirs(tmp_path):
    with patch("lectern.utils.path_utils.get_app_data_dir", return_value=tmp_path):
        ensure_app_dirs()
        assert (tmp_path / "logs").exists()
        assert (tmp_path / "state").exists()
        assert (tmp_path / "logs").is_dir()
        assert (tmp_path / "state").is_dir()
