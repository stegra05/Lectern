import pytest
from fastapi.testclient import TestClient
from gui.backend.main import app
import unittest.mock as mock

client = TestClient(app)

@pytest.fixture(autouse=True)
def reset_cache():
    from gui.backend.main import _update_cache
    _update_cache["data"] = None
    _update_cache["expires_at"] = 0

def test_version_endpoint_success():
    # Mock requests.get to simulate GitHub API
    with mock.patch("requests.get") as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {
            "tag_name": "v9.9.9",
            "html_url": "https://github.com/stegra05/Lectern/releases/tag/v9.9.9"
        }
        
        response = client.get("/version")
        assert response.status_code == 200
        data = response.json()
        assert "current" in data
        assert data["latest"] == "9.9.9"
        assert data["update_available"] is True
        assert "release_url" in data

def test_version_endpoint_failure():
    # Mock requests.get to simulate failure
    with mock.patch("requests.get") as mock_get:
        mock_get.side_effect = Exception("Network error")
        
        response = client.get("/version")
        assert response.status_code == 200
        data = response.json()
        assert "current" in data
        assert data["latest"] is None
        assert data["update_available"] is False
