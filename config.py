"""
Configuration module for the Lectern application.

This module centralizes configuration values such as API keys and service
endpoints. Secrets are read from environment variables to avoid hardcoding
them in the repository.
"""

from __future__ import annotations

import os

try:
    # Prefer python-dotenv if available to load .env automatically
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover - optional dependency at runtime
    load_dotenv = None  # type: ignore[assignment]

def _load_environment_files() -> None:
    """Load environment variables from project .env and fallback to home .env.

    - First tries `.env` in the project root (current working directory).
    - Then tries `~/.env` as a fallback if not already set.
    """

    if load_dotenv is None:
        return

    # Load from CWD/project root if present
    load_dotenv(override=False)

    # Fallback to ~/.env for users who prefer global secrets
    home_env_path = os.path.join(os.path.expanduser("~"), ".env")
    if os.path.exists(home_env_path):
        load_dotenv(dotenv_path=home_env_path, override=False)

# Load env files before reading values
_load_environment_files()

# Google Gemini API key. Must be provided via environment variable for security.
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

# Default Gemini model name for generation.
# Centralizes the model selection to avoid hardcoding in modules.
DEFAULT_GEMINI_MODEL: str = os.getenv("DEFAULT_GEMINI_MODEL", "gemini-2.5-pro")

# AnkiConnect default URL. Can be overridden via environment variable if needed.
ANKI_CONNECT_URL: str = os.getenv("ANKI_CONNECT_URL", "http://localhost:8765")


# Default Anki note models to use. These can be overridden via environment.
# Intended to steer AI output and to map generic model names returned by the AI.
DEFAULT_BASIC_MODEL: str = os.getenv("BASIC_MODEL_NAME", "prettify-nord-basic")
DEFAULT_CLOZE_MODEL: str = os.getenv("CLOZE_MODEL_NAME", "prettify-nord-cloze")

# Default tag behavior. When enabled, the application will ensure this tag is
# present on every created note unless explicitly disabled via CLI.
DEFAULT_TAG: str = os.getenv("DEFAULT_TAG", "lectern")
ENABLE_DEFAULT_TAG: bool = os.getenv("ENABLE_DEFAULT_TAG", "true").lower() not in (
    "0",
    "false",
    "no",
)

# Group tags under the destination deck using Anki's hierarchical tag separator '::'.
# Example: deck "Econ::Macro", tag "gdp" -> "econ::macro::gdp".
# Optional TAG_GROUP_ROOT adds a root namespace like "lectern::".
GROUP_TAGS_BY_DECK: bool = os.getenv("GROUP_TAGS_BY_DECK", "true").lower() not in (
    "0",
    "false",
    "no",
)
TAG_GROUP_ROOT: str = os.getenv("TAG_GROUP_ROOT", "")


def assert_required_config() -> None:
    """Raise a ValueError if critical configuration is missing.

    This validation is intended to be called at application startup
    to fail fast when required configuration is not present.
    """

    if not GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY is not set. Please export it in your environment."
        )



# Batch generation and reflection settings
# Maximum notes the model should emit per batch. Keep small to avoid truncation.
MAX_NOTES_PER_BATCH: int = int(os.getenv("MAX_NOTES_PER_BATCH", "30"))

# Number of pages to include per generation window (sliding through the PDF)
PAGE_WINDOW_SIZE: int = int(os.getenv("PAGE_WINDOW_SIZE", "6"))

# Maximum number of reflection rounds to attempt after initial generation
REFLECTION_MAX_ROUNDS: int = int(os.getenv("REFLECTION_MAX_ROUNDS", "2"))

# Enable/disable reflection phase
ENABLE_REFLECTION: bool = os.getenv("ENABLE_REFLECTION", "true").lower() not in (
    "0",
    "false",
    "no",
)

