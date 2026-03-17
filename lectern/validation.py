"""
Validation utilities for Lectern generation service.

This module provides validation functions for PDF files and AnkiConnect
connection checks, yielding ServiceEvents for progress reporting.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, AsyncGenerator, Optional

from lectern.anki_connector import check_connection
from lectern import config


@dataclass
class ValidationResult:
    """Result of a validation check."""

    valid: bool
    error_event: Optional[Dict[str, Any]] = None
    info_data: Optional[Dict[str, Any]] = None


def validate_pdf(pdf_path: str) -> ValidationResult:
    """Validate that a PDF file exists and is not empty."""
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


async def validate_anki_connection(
    skip_export: bool,
) -> AsyncGenerator[Dict[str, Any], bool]:
    """Validate AnkiConnect connection with progress events (Async)."""
    yield {
        "type": "step_start",
        "message": "Check AnkiConnect",
        "data": {},
    }

    if not await check_connection():
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
            return
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
            return

    yield {
        "type": "step_end",
        "message": "AnkiConnect Connected",
        "data": {"success": True},
    }
    return
