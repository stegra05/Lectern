"""
Configuration module for the Lectern application.

This module centralizes configuration values such as API keys and service
endpoints. Secrets are read from environment variables to avoid hardcoding
them in the repository.

Uses ConfigManager singleton for runtime configuration management to avoid
hot-reload issues with module-level constants.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

# Prefer python-dotenv if available to load .env automatically
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover - optional dependency at runtime
    load_dotenv = None  # type: ignore[assignment]

from lectern.utils.path_utils import get_app_data_dir
from lectern.utils.keychain_manager import get_gemini_key

logger = logging.getLogger(__name__)


# --- ConfigManager Singleton ---


class ConfigManager:
    """Singleton configuration manager for Lectern.

    Replaces module-level constants to fix hot-reload issues. Provides:
    - get(key, default): Retrieve config value with fallback
    - set(key, value): Update config value and persist to disk
    - instance(): Class method to get the singleton instance

    Priority order: Environment Variable > User Config (JSON) > Default
    """

    _instance: Optional["ConfigManager"] = None

    # Default values for all configurable keys
    _DEFAULTS: Dict[str, Any] = {
        "gemini_model": "gemini-3-flash",
        "lightweight_model": "gemini-3-flash",
        "anki_url": "http://localhost:8765",
        "basic_model": "Basic",
        "cloze_model": "Cloze",
        "tag_template": "{{deck}}::{{slide_set}}::{{topic}}",
        "debug": False,
    }

    # Environment variable name mappings
    _ENV_MAPPINGS = {
        "gemini_model": "DEFAULT_GEMINI_MODEL",
        "lightweight_model": "LIGHTWEIGHT_MODEL",
        "anki_url": "ANKI_CONNECT_URL",
        "basic_model": "BASIC_MODEL_NAME",
        "cloze_model": "CLOZE_MODEL_NAME",
        "tag_template": "TAG_TEMPLATE",
        "debug": "DEBUG",
    }

    def __init__(self) -> None:
        """Initialize config manager. Called once via instance()."""
        self._config: Dict[str, Any] = {}
        self._config_path = get_app_data_dir() / "user_config.json"
        self._legacy_config_path = Path(__file__).resolve().parent / "user_config.json"
        self._load()

    @classmethod
    def instance(cls) -> "ConfigManager":
        """Get the singleton ConfigManager instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def _reset_instance(cls) -> None:
        """Reset the singleton instance. Only for testing."""
        cls._instance = None

    def get(self, key: str, default: Any = None) -> Any:
        """Get config value with priority: Env Var > User Config > Default.

        Args:
            key: Config key in snake_case (e.g., "gemini_model")
            default: Fallback value if key not found anywhere

        Returns:
            Config value from env var, user config, or default
        """
        # 1. Check environment variable first (highest priority)
        env_key = self._ENV_MAPPINGS.get(key, key.upper())
        env_val = os.getenv(env_key)
        if env_val is not None:
            return env_val

        # 2. Check user config
        if key in self._config:
            return self._config[key]

        # 3. Return default
        if default is not None:
            return default
        return self._DEFAULTS.get(key)

    def set(self, key: str, value: Any) -> None:
        """Set config value and persist to disk.

        Args:
            key: Config key in snake_case (e.g., "anki_url")
            value: Value to set (must be JSON-serializable)
        """
        self._config[key] = value
        self._save()

    def get_all(self) -> Dict[str, Any]:
        """Get all user config values."""
        return dict(self._config)

    def _load(self) -> None:
        """Load configuration from JSON file."""
        self._prepare_config_path()
        if self._config_path.exists():
            try:
                with open(self._config_path, "r", encoding="utf-8") as f:
                    self._config = json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load user_config.json: {e}")
                self._config = {}

    def _save(self) -> None:
        """Save configuration to JSON file."""
        try:
            self._prepare_config_path()
            with open(self._config_path, "w", encoding="utf-8") as f:
                json.dump(self._config, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save user_config.json: {e}")

    def _prepare_config_path(self) -> None:
        """Ensure config directory exists and migrate from legacy path."""
        try:
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            if self._legacy_config_path.exists() and not self._config_path.exists():
                shutil.copy2(self._legacy_config_path, self._config_path)
        except Exception as e:
            logger.warning(f"Failed to prepare user_config.json path: {e}")


# --- Helper Functions ---


def _load_environment_files() -> None:
    """Load environment variables from project .env and fallback to home .env."""
    if load_dotenv is None:
        return
    load_dotenv(override=False)
    home_env_path = os.path.join(os.path.expanduser("~"), ".env")
    if os.path.exists(home_env_path):
        load_dotenv(dotenv_path=home_env_path, override=False)


# Load env files at module init
_load_environment_files()


def save_user_config(config: Dict[str, Any]) -> None:
    """Save user configuration to JSON file. Delegates to ConfigManager."""
    mgr = ConfigManager.instance()
    for key, value in config.items():
        mgr.set(key, value)


def assert_required_config() -> None:
    """Raise a ValueError if critical configuration is missing."""
    api_key = get_gemini_key() or os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY is not set. Please export it in your environment."
        )


# --- Module-level Constants (for backward compatibility) ---
# These are evaluated once at import time. For hot-reloadable values,
# use ConfigManager.instance().get() directly.

# API Key (from keychain, static)
GEMINI_API_KEY: str = get_gemini_key() or os.getenv("GEMINI_API_KEY", "")

# CORS origins (static at module load)
FRONTEND_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.getenv(
        "LECTERN_FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if origin.strip()
]

# Tag defaults (static)
DEFAULT_TAG: str = os.getenv("DEFAULT_TAG", "lectern")
ENABLE_DEFAULT_TAG: bool = os.getenv("ENABLE_DEFAULT_TAG", "true").lower() not in (
    "0",
    "false",
    "no",
)

# Batch generation settings (env-only)
MIN_CARDS_PER_SLIDE: float = float(os.getenv("MIN_CARDS_PER_SLIDE", "0.8"))
CARDS_PER_SLIDE_TARGET: float = float(os.getenv("CARDS_PER_SLIDE_TARGET", "1.2"))
CHARS_PER_CARD_TARGET: int = int(os.getenv("CHARS_PER_CARD_TARGET", "200"))
DENSE_THRESHOLD_CHARS_PER_PAGE: int = int(
    os.getenv("DENSE_THRESHOLD_CHARS_PER_PAGE", "1500")
)
NORMAL_THRESHOLD_CHARS_PER_PAGE: int = int(
    os.getenv("NORMAL_THRESHOLD_CHARS_PER_PAGE", "400")
)
SCRIPT_CHARS_PER_CARD: int = int(os.getenv("SCRIPT_CHARS_PER_CARD", "500"))
SCRIPT_SUGGESTED_CARDS_PER_1K: float = float(
    os.getenv("SCRIPT_SUGGESTED_CARDS_PER_1K", "3.0")
)
MAX_TOTAL_NOTES: int = int(os.getenv("MAX_TOTAL_NOTES", "0"))
MIN_NOTES_PER_BATCH: int = int(os.getenv("MIN_NOTES_PER_BATCH", "20"))
MAX_NOTES_PER_BATCH: int = int(os.getenv("MAX_NOTES_PER_BATCH", "50"))
SCRIPT_BASE_CHARS: int = int(os.getenv("SCRIPT_BASE_CHARS", "1000"))
GEMINI_TEMPERATURE: float = float(os.getenv("GEMINI_TEMPERATURE", "1.0"))
USE_NATIVE_PDF: bool = os.getenv("USE_NATIVE_PDF", "true").lower() in (
    "1",
    "true",
    "yes",
)

# Reflection loop settings (env-only)
REFLECTION_RECENT_CARD_WINDOW: int = int(
    os.getenv("REFLECTION_RECENT_CARD_WINDOW", "100")
)
REFLECTION_HARD_CAP_MULTIPLIER: float = float(
    os.getenv("REFLECTION_HARD_CAP_MULTIPLIER", "1.2")
)
REFLECTION_HARD_CAP_PADDING: int = int(os.getenv("REFLECTION_HARD_CAP_PADDING", "5"))

# Session logging controls
LOG_SESSION_CONTENT: bool = os.getenv("LOG_SESSION_CONTENT", "true").lower() not in (
    "0",
    "false",
    "no",
)
LOG_MAX_RESPONSE_CHARS: int = int(os.getenv("LOG_MAX_RESPONSE_CHARS", "20000"))

# Pricing dictionary (per million tokens: input, output)
GEMINI_PRICING: Dict[str, tuple[float, float]] = {
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3-pro-preview": (2.00, 12.00),
    "gemini-3-flash-preview": (0.50, 3.00),
    "gemini-3-pro": (2.00, 12.00),
    "gemini-3-flash": (0.50, 3.00),
    "gemini-2.5-pro": (1.25, 10.00),
    "gemini-2.5-flash": (0.30, 2.50),
    "default": (0.50, 4.00),
}

# Heuristics for cost estimation
ESTIMATION_BASE_OUTPUT_RATIO: float = 0.20
ESTIMATION_TOKENS_PER_CARD: int = 100
ESTIMATION_PROMPT_OVERHEAD: int = 3000
GEMINI_IMAGE_TOKEN_COST: int = 258
ESTIMATION_VERIFY_IMAGE_TOKEN_COST: bool = os.getenv(
    "ESTIMATION_VERIFY_IMAGE_TOKEN_COST", "false"
).lower() in (
    "1",
    "true",
    "yes",
)


# --- Dynamic Config via __getattr__ ---
# This allows config.DEFAULT_GEMINI_MODEL to return live values from ConfigManager.


def __getattr__(name: str) -> Any:
    """Dynamic attribute access for hot-reloadable config values."""
    # Map module attribute names to ConfigManager keys
    key_mapping = {
        "DEFAULT_GEMINI_MODEL": "gemini_model",
        "LIGHTWEIGHT_MODEL": "lightweight_model",
        "ANKI_CONNECT_URL": "anki_url",
        "DEFAULT_BASIC_MODEL": "basic_model",
        "DEFAULT_CLOZE_MODEL": "cloze_model",
        "TAG_TEMPLATE": "tag_template",
        "DEBUG": "debug",
    }

    if name in key_mapping:
        return ConfigManager.instance().get(key_mapping[name])

    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
