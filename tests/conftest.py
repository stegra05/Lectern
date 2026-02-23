"""
Shared pytest fixtures for Lectern tests.

This module provides reusable fixtures for mocking external services,
creating test data, and setting up isolated test environments.
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Generator

import pytest


# --- Anki Connector Fixtures ---

@pytest.fixture
def mock_anki_response() -> MagicMock:
    """Create a mock Anki API response with configurable result/error."""
    response = MagicMock()
    response.json.return_value = {"result": None, "error": None}
    return response


@pytest.fixture
def mock_requests_post(mock_anki_response: MagicMock) -> Generator[MagicMock, None, None]:
    """Mock requests.post for AnkiConnect API calls."""
    with patch("requests.post") as mock_post:
        mock_post.return_value = mock_anki_response
        yield mock_post


@pytest.fixture
def mock_anki_connected(mock_requests_post: MagicMock, mock_anki_response: MagicMock) -> MagicMock:
    """Configure Anki mock for successful connection."""
    mock_anki_response.json.return_value = {"result": 6, "error": None}
    return mock_requests_post


@pytest.fixture
def mock_anki_disconnected(mock_requests_post: MagicMock) -> MagicMock:
    """Configure Anki mock for connection failure."""
    mock_requests_post.side_effect = Exception("Connection refused")
    return mock_requests_post


# --- AI Client Fixtures ---

@pytest.fixture
def mock_ai_client() -> Generator[MagicMock, None, None]:
    """Mock AI client for Gemini API calls."""
    with patch("lectern.ai_client.AIClient") as mock_client_class:
        mock_client = MagicMock()
        mock_client.generate_content = AsyncMock(return_value={"text": "Test response"})
        mock_client_class.return_value = mock_client
        yield mock_client


@pytest.fixture
def mock_ai_response() -> MagicMock:
    """Create a configurable mock AI response."""
    response = MagicMock()
    response.text = "Generated flashcard content"
    response.usage_metadata = MagicMock(
        prompt_token_count=100,
        candidates_token_count=50,
        total_token_count=150
    )
    return response


# --- State Persistence Fixtures ---

@pytest.fixture
def temp_state_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for state files during tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)





# --- PDF Fixtures ---

@pytest.fixture
def sample_pdf_bytes() -> bytes:
    """Minimal valid PDF content for testing."""
    # Minimal PDF structure
    return b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
194
%%EOF"""


@pytest.fixture
def sample_pdf_file(sample_pdf_bytes: bytes) -> Generator[str, None, None]:
    """Create a temporary PDF file for testing."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(sample_pdf_bytes)
        temp_path = f.name

    yield temp_path

    # Cleanup
    try:
        os.unlink(temp_path)
    except OSError:
        pass


# --- Config Fixtures ---

@pytest.fixture
def isolated_config() -> Generator[None, None, None]:
    """Reset ConfigManager singleton before and after each test."""
    from lectern.config import ConfigManager

    # Reset before test
    ConfigManager._reset_instance()

    yield

    # Reset after test
    ConfigManager._reset_instance()


@pytest.fixture
def temp_config_dir(temp_state_dir: Path) -> Generator[Path, None, None]:
    """Provide a temporary directory for config files."""
    config_path = temp_state_dir / "user_config.json"
    with patch("lectern.config.get_app_data_dir", return_value=temp_state_dir):
        yield temp_state_dir


# --- History Fixtures ---

@pytest.fixture
def mock_history_manager() -> Generator[MagicMock, None, None]:
    """Mock HistoryManager for testing."""
    with patch("lectern.utils.history_manager.HistoryManager") as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_all.return_value = []
        mock_mgr.add_entry.return_value = "test-entry-id"
        mock_mgr.delete_entry.return_value = True
        mock_mgr_class.return_value = mock_mgr
        yield mock_mgr


# --- Service Fixtures ---

@pytest.fixture
def mock_generation_service() -> Generator[MagicMock, None, None]:
    """Mock LecternGenerationService for testing."""
    with patch("lectern.lectern_service.LecternGenerationService") as mock_service_class:
        mock_service = MagicMock()
        mock_service.run_generation = AsyncMock()
        mock_service.estimate_cost = AsyncMock(return_value={
            "cost": 0.05,
            "tokens": 1000,
            "estimated_card_count": 10
        })
        mock_service_class.return_value = mock_service
        yield mock_service
