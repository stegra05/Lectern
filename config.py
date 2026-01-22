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

from utils.keychain_manager import get_gemini_key

# Google Gemini API key. Must be provided via environment variable or keychain for security.
GEMINI_API_KEY: str = get_gemini_key() or os.getenv("GEMINI_API_KEY", "")

# Default Gemini model name for generation.
# Centralizes the model selection to avoid hardcoding in modules.
DEFAULT_GEMINI_MODEL: str = os.getenv("DEFAULT_GEMINI_MODEL", "gemini-3-flash-preview")

# Thinking level for Gemini 3 Flash models (minimal, low, medium, high).
# Controls reasoning depth and latency.
GEMINI_THINKING_LEVEL: str = os.getenv("GEMINI_THINKING_LEVEL", "low")

# Lightweight model for fast, cheap inference tasks like naming and classification.
# Uses Gemini 3 Flash by default for speed and cost efficiency.
LIGHTWEIGHT_MODEL: str = os.getenv("LIGHTWEIGHT_MODEL", "gemini-3-flash-preview")

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

# NOTE(Tags): The legacy GROUP_TAGS_BY_DECK option has been removed.
# The hierarchical tagging system now always uses the 4-level format:
#   Deck::SlideSet::Topic::Tag
# Example: "Introduction to Machine Learning::Lecture 1 Supervised Learning::Image Classification::preprocessing"


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

# Maximum number of reflection rounds to attempt after initial generation
REFLECTION_MAX_ROUNDS: int = int(os.getenv("REFLECTION_MAX_ROUNDS", "2"))

# Enable/disable reflection phase
ENABLE_REFLECTION: bool = os.getenv("ENABLE_REFLECTION", "true").lower() not in (
    "0",
    "false",
    "no",
)

# Caps for total note creation per run
# Minimum cards per slide (enforced threshold, e.g., 0.8 -> at least 80% of page count)
MIN_CARDS_PER_SLIDE: float = float(os.getenv("MIN_CARDS_PER_SLIDE", "0.8"))

# Target cards per slide (e.g., 1.5 -> ~50% more cards than slides)
CARDS_PER_SLIDE_TARGET: float = float(os.getenv("CARDS_PER_SLIDE_TARGET", "1.2"))

# Heuristic for text density: target this many characters per card
CHARS_PER_CARD_TARGET: int = int(os.getenv("CHARS_PER_CARD_TARGET", "200"))

# Absolute maximum total notes (0 disables the hard cap)
MAX_TOTAL_NOTES: int = int(os.getenv("MAX_TOTAL_NOTES", "0"))

# Exam preparation mode - prioritizes understanding/comparison cards over memorization
# Set EXAM_MODE=true to make exam mode the default (can be overridden with --exam-mode flag)
# CLI: --exam-mode flag defaults to this value
# GUI: Configurable per-run via checkbox
EXAM_MODE: bool = os.getenv("EXAM_MODE", "false").lower() in ("1", "true", "yes")

# Temperature settings for Gemini 3 structured output (optimal range: 0.8-0.9 per docs)
# Base temperature for card generation (normal mode)
GEMINI_GENERATION_TEMPERATURE: float = float(os.getenv("GEMINI_GENERATION_TEMPERATURE", "0.8"))
# Temperature for exam mode (slightly lower for strictness)
GEMINI_EXAM_MODE_TEMPERATURE: float = float(os.getenv("GEMINI_EXAM_MODE_TEMPERATURE", "0.7"))
# Temperature for normal mode (higher for variety)
GEMINI_NORMAL_MODE_TEMPERATURE: float = float(os.getenv("GEMINI_NORMAL_MODE_TEMPERATURE", "0.9"))

# Exam mode safety cap: maximum cards per slide in exam mode
# Prevents truncation while relying on prompt for ~0.9 avg target
EXAM_MODE_SAFETY_CAP: float = float(os.getenv("EXAM_MODE_SAFETY_CAP", "1.5"))


