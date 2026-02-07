"""
Keychain manager for Lectern.

Handles secure storage of API keys using the system keyring service.
"""

import logging
import keyring
from keyring.errors import KeyringError

SERVICE_NAME = "Lectern"
GEMINI_KEY_USER = "gemini_api_key"

logger = logging.getLogger(__name__)

# Cache the key in memory to avoid repeated keychain prompts/access
_cached_key: str | None = None

def get_gemini_key() -> str | None:
    """Retrieve the Gemini API key from the system keyring."""
    global _cached_key
    if _cached_key is not None:
        return _cached_key

    try:
        val = keyring.get_password(SERVICE_NAME, GEMINI_KEY_USER)
        if val:
            _cached_key = val
        return val
    except KeyringError as e:
        logger.warning(f"Failed to access keyring: {e}")
        return None
    except Exception as e:
        logger.warning(f"Unexpected error accessing keyring: {e}")
        return None

def set_gemini_key(key: str) -> None:
    """Securely store the Gemini API key in the system keyring."""
    global _cached_key
    try:
        keyring.set_password(SERVICE_NAME, GEMINI_KEY_USER, key)
        _cached_key = key
    except KeyringError as e:
        logger.error(f"Failed to save to keyring: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error saving to keyring: {e}")
        raise

def delete_gemini_key() -> None:
    """Remove the Gemini API key from the system keyring."""
    global _cached_key
    try:
        keyring.delete_password(SERVICE_NAME, GEMINI_KEY_USER)
        _cached_key = None
    except KeyringError as e:
        logger.warning(f"Failed to delete from keyring: {e}")
    except Exception as e:
        logger.warning(f"Unexpected error deleting from keyring: {e}")
