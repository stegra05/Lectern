"""
Validation utilities for Lectern generation service.

This module provides validation functions for PDF files and AnkiConnect
connection checks, yielding ServiceEvents for progress reporting.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, Generator, Optional

from lectern.anki_connector import check_connection
from lectern import config


@dataclass
class ValidationResult:
    """Result of a validation check."""

    valid: bool
    error_event: Optional[Dict[str, Any]] = None
    info_data: Optional[Dict[str, Any]] = None


def validate_pdf(pdf_path: str) -> ValidationResult:
    """Validate that a PDF file exists and is not empty.

    Args:
        pdf_path: Path to the PDF file to validate.

    Returns:
        ValidationResult with valid=True if PDF is accessible and non-empty,
        or valid=False with error_event if validation fails.
    """
    if not os.path.exists(pdf_path):
        return ValidationResult(
            valid=False,
            error_event={
                "type": "error",
                "message": f"PDF not found: {os.path.basename(pdf_path)}",
                "data": {"recoverable": False},
            },
        )

    file_size = os.path.getsize(pdf_path)
    if file_size == 0:
        return ValidationResult(
            valid=False,
            error_event={
                "type": "error",
                "message": f"PDF file is empty (0 bytes): {os.path.basename(pdf_path)}",
                "data": {"recoverable": False},
            },
        )

    return ValidationResult(
        valid=True,
        info_data={
            "file_size": file_size,
            "file_name": os.path.basename(pdf_path),
        },
    )


def validate_anki_connection(
    skip_export: bool,
) -> Generator[Dict[str, Any], None, bool]:
    """Validate AnkiConnect connection with progress events.

    Yields ServiceEvent dicts for progress reporting.

    Args:
        skip_export: If True, allow offline mode when AnkiConnect is unreachable.

    Yields:
        ServiceEvent dicts for step_start, step_end, warning, and error events.

    Returns:
        True if connected or offline mode is acceptable, False if connection
        is required but unavailable.
    """
    yield {
        "type": "step_start",
        "message": "Check AnkiConnect",
        "data": {},
    }

    if not check_connection():
        if skip_export:
            # Offline mode - technically successful but with warning
            yield {
                "type": "step_end",
                "message": "AnkiConnect unreachable",
                "data": {"success": False},
            }
            yield {
                "type": "step_end",
                "message": "Offline Mode Enabled",
                "data": {"success": True},
            }
            yield {
                "type": "warning",
                "message": "Could not connect to AnkiConnect. Proceeding in offline mode (examples and export will be skipped).",
                "data": {},
            }
            return True
        else:
            yield {
                "type": "step_end",
                "message": "AnkiConnect unreachable",
                "data": {"success": False},
            }
            yield {
                "type": "error",
                "message": f"Could not connect to AnkiConnect at {config.ANKI_CONNECT_URL}",
                "data": {"recoverable": False},
            }
            return False

    yield {
        "type": "step_end",
        "message": "AnkiConnect Connected",
        "data": {"success": True},
    }
    return True
