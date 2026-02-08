"""
Configuration module for the Lectern application.

This module centralizes configuration values such as API keys and service
endpoints. Secrets are read from environment variables to avoid hardcoding
them in the repository.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

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

# --- User Config (JSON) Loading ---
# Path for user configuration file (adjacent to config.py or in app data)
_CONFIG_DIR = os.path.dirname(os.path.abspath(__file__))
_USER_CONFIG_PATH = os.path.join(_CONFIG_DIR, "user_config.json")
_USER_CONFIG: Dict[str, Any] = {}

def _load_user_config() -> Dict[str, Any]:
    """Load user configuration from JSON file if it exists."""
    global _USER_CONFIG
    if os.path.exists(_USER_CONFIG_PATH):
        try:
            with open(_USER_CONFIG_PATH, "r") as f:
                _USER_CONFIG = json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load user_config.json: {e}")
            _USER_CONFIG = {}
    return _USER_CONFIG

def save_user_config(config: Dict[str, Any]) -> None:
    """Save user configuration to JSON file."""
    global _USER_CONFIG
    _USER_CONFIG.update(config)
    try:
        with open(_USER_CONFIG_PATH, "w") as f:
            json.dump(_USER_CONFIG, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save user_config.json: {e}")

def _get_config(key: str, default: Any, env_key: Optional[str] = None) -> Any:
    """Get config value with priority: Env Var > User Config > Default."""
    # 1. Check environment variable
    env_name = env_key or key.upper()
    env_val = os.getenv(env_name)
    if env_val is not None:
        return env_val
    # 2. Check user config
    if key in _USER_CONFIG:
        return _USER_CONFIG[key]
    # 3. Return default
    return default

# Load user config at module init
_load_user_config()

from utils.keychain_manager import get_gemini_key

# Google Gemini API key. Must be provided via environment variable or keychain for security.
GEMINI_API_KEY: str = get_gemini_key() or os.getenv("GEMINI_API_KEY", "")

# Default Gemini model name for generation.
# Centralizes the model selection to avoid hardcoding in modules.
DEFAULT_GEMINI_MODEL: str = _get_config("gemini_model", "gemini-3-flash-preview", "DEFAULT_GEMINI_MODEL")

# Thinking level for Gemini 3 Flash models (minimal, low, medium, high).
# Controls reasoning depth and latency.
GEMINI_THINKING_LEVEL: str = _get_config("gemini_thinking_level", "low", "GEMINI_THINKING_LEVEL")

# Lightweight model for fast, cheap inference tasks like naming and classification.
# Uses Gemini 3 Flash by default for speed and cost efficiency.
LIGHTWEIGHT_MODEL: str = _get_config("lightweight_model", "gemini-3-flash-preview", "LIGHTWEIGHT_MODEL")

# AnkiConnect default URL. Can be overridden via environment variable if needed.
ANKI_CONNECT_URL: str = _get_config("anki_url", "http://localhost:8765", "ANKI_CONNECT_URL")

# Allowed origins for the GUI backend CORS configuration.
FRONTEND_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.getenv(
        "LECTERN_FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if origin.strip()
]


# Default Anki note models to use. These can be overridden via environment.
# Intended to steer AI output and to map generic model names returned by the AI.
DEFAULT_BASIC_MODEL: str = _get_config("basic_model", "Basic", "BASIC_MODEL_NAME")
DEFAULT_CLOZE_MODEL: str = _get_config("cloze_model", "Cloze", "CLOZE_MODEL_NAME")

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

# Density thresholds (chars per page) for auto-detection
# "script" mode: > 1500 chars/page
# "normal" mode: 400-1500 chars/page
# "slides" mode: < 400 chars/page
DENSE_THRESHOLD_CHARS_PER_PAGE: int = int(os.getenv("DENSE_THRESHOLD_CHARS_PER_PAGE", "1500"))
NORMAL_THRESHOLD_CHARS_PER_PAGE: int = int(os.getenv("NORMAL_THRESHOLD_CHARS_PER_PAGE", "400"))

# Cards per character in dense mode (e.g., 500 -> ~1 card per paragraph)
SCRIPT_CHARS_PER_CARD: int = int(os.getenv("SCRIPT_CHARS_PER_CARD", "500"))

# Absolute maximum total notes (0 disables the hard cap)
MAX_TOTAL_NOTES: int = int(os.getenv("MAX_TOTAL_NOTES", "0"))

# Temperature settings for Gemini 3 structured output (optimal range: 0.8-0.9 per docs)
# Base temperature for card generation (normal mode)
GEMINI_GENERATION_TEMPERATURE: float = float(os.getenv("GEMINI_GENERATION_TEMPERATURE", "0.8"))
# Temperature for normal mode (higher for variety)
GEMINI_NORMAL_MODE_TEMPERATURE: float = float(os.getenv("GEMINI_NORMAL_MODE_TEMPERATURE", "0.9"))

# Session logging controls
LOG_SESSION_CONTENT: bool = os.getenv("LOG_SESSION_CONTENT", "true").lower() not in (
    "0",
    "false",
    "no",
)
LOG_MAX_RESPONSE_CHARS: int = int(os.getenv("LOG_MAX_RESPONSE_CHARS", "20000"))


# --- Estimation and Pricing ---
# Gemini model pricing (per million tokens, as of 2025)
# Format: {model_pattern: (input_rate_usd, output_rate_usd)}
GEMINI_PRICING = {
    "gemini-2.5-pro": (1.25, 10.00),   # $1.25/M in, $10/M out
    "gemini-2.5-flash": (0.30, 2.50),  # $0.30/M in, $2.50/M out
    "gemini-3-flash": (0.30, 2.50),    # Assume same as 2.5 Flash for now
    "default": (0.50, 4.00),           # Conservative fallback
}

# Heuristics for cost estimation
ESTIMATION_OUTPUT_RATIO = 0.35      # Output tokens are roughly 35% of input for card generation
ESTIMATION_PROMPT_OVERHEAD = 3000   # System instruction + overhead for concept map & first batch
GEMINI_IMAGE_TOKEN_COST = 258       # Fixed cost per image in Gemini models


