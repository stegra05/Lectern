"""
Configuration module for the Lectern application.

This module centralizes configuration values such as API keys and service
endpoints. Secrets are read from environment variables to avoid hardcoding
them in the repository.
"""

from __future__ import annotations

import os


# Google Gemini API key. Must be provided via environment variable for security.
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

# AnkiConnect default URL. Can be overridden via environment variable if needed.
ANKI_CONNECT_URL: str = os.getenv("ANKI_CONNECT_URL", "http://localhost:8765")


def assert_required_config() -> None:
    """Raise a ValueError if critical configuration is missing.

    This validation is intended to be called at application startup
    to fail fast when required configuration is not present.
    """

    if not GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY is not set. Please export it in your environment."
        )


