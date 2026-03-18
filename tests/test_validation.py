"""Tests for the validation module."""

import pytest
from unittest.mock import patch

from lectern.validation import (
    ValidationResult,
    validate_pdf,
    validate_anki_connection,
)


class TestValidationResult:
    """Tests for ValidationResult dataclass."""

    def test_valid_result(self):
        """Test creating a valid result."""
        result = ValidationResult(valid=True)
        assert result.valid is True
        assert result.error_event is None
        assert result.info_data is None

    def test_invalid_result_with_error(self):
        """Test creating an invalid result with error."""
        result = ValidationResult(
            valid=False,
            error_event={"type": "error", "message": "Test error"},
        )
        assert result.valid is False
        assert result.error_event is not None
        assert result.error_event["type"] == "error"


class TestValidatePdf:
    """Tests for validate_pdf function."""

    def test_validates_existing_non_empty_file(self, tmp_path):
        """Test validation passes for existing non-empty file."""
        pdf_file = tmp_path / "test.pdf"
        pdf_file.write_bytes(b"test content")

        result = validate_pdf(str(pdf_file))

        assert result.valid is True
        assert result.info_data is not None
        assert result.info_data["file_size"] == 12
        assert result.info_data["file_name"] == "test.pdf"

    def test_fails_for_nonexistent_file(self, tmp_path):
        """Test validation fails for nonexistent file."""
        result = validate_pdf(str(tmp_path / "nonexistent.pdf"))

        assert result.valid is False
        assert result.error_event is not None
        assert result.error_event["type"] == "error"
        assert "PDF not found" in result.error_event["message"]
        assert result.error_event["data"]["recoverable"] is False

    def test_fails_for_empty_file(self, tmp_path):
        """Test validation fails for empty file."""
        pdf_file = tmp_path / "empty.pdf"
        pdf_file.write_bytes(b"")

        result = validate_pdf(str(pdf_file))

        assert result.valid is False
        assert result.error_event is not None
        assert result.error_event["type"] == "error"
        assert "empty" in result.error_event["message"].lower()
        assert result.error_event["data"]["recoverable"] is False


class TestValidateAnkiConnection:
    """Tests for validate_anki_connection generator."""

    @pytest.mark.asyncio
    @patch("lectern.validation.check_connection")
    async def test_success_when_connected(self, mock_check):
        """Test successful connection validation."""
        mock_check.return_value = True

        events = []
        async for event in validate_anki_connection(skip_export=False):
            events.append(event)

        assert len(events) == 2
        assert events[0]["type"] == "step_start"
        assert events[1]["type"] == "step_end"
        assert events[1]["data"]["success"] is True

    @pytest.mark.asyncio
    @patch("lectern.validation.check_connection")
    async def test_offline_mode_allowed(self, mock_check):
        """Test offline mode when skip_export is True."""
        mock_check.return_value = False

        events = []
        async for event in validate_anki_connection(skip_export=True):
            events.append(event)

        # Should have step_start, step_end (unreachable), step_end (offline), warning
        assert len(events) == 4
        assert events[0]["type"] == "step_start"
        assert events[2]["type"] == "step_end"
        assert events[2]["data"]["success"] is True  # Offline mode enabled
        assert events[3]["type"] == "warning"

    @pytest.mark.asyncio
    @patch("lectern.validation.check_connection")
    async def test_fails_when_not_connected_and_export_required(self, mock_check):
        """Test failure when not connected and export is required."""
        mock_check.return_value = False

        events = []
        async for event in validate_anki_connection(skip_export=False):
            events.append(event)

        assert len(events) == 3
        assert events[0]["type"] == "step_start"
        assert events[1]["type"] == "step_end"
        assert events[1]["data"]["success"] is False
        assert events[2]["type"] == "error"
        assert "Could not connect to AnkiConnect" in events[2]["message"]
