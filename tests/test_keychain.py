import pytest
from unittest.mock import patch, MagicMock
from keyring.errors import KeyringError
import sys
import os

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from utils.keychain_manager import get_gemini_key, set_gemini_key, delete_gemini_key

def test_get_set_delete_key():
    """Test standard success path for keychain operations."""
    with patch('keyring.get_password') as mock_get, \
         patch('keyring.set_password') as mock_set, \
         patch('keyring.delete_password') as mock_del:
        
        # Clear cache first (global state)
        import utils.keychain_manager
        utils.keychain_manager._cached_key = None
        
        # Test Set
        set_gemini_key("test-key")
        mock_set.assert_called_with("Lectern", "gemini_api_key", "test-key")
        
        # Test Get (should hit cache first)
        key = get_gemini_key()
        assert key == "test-key"
        mock_get.assert_not_called()
        
        # Clear cache and test Get (hit keyring)
        utils.keychain_manager._cached_key = None
        mock_get.return_value = "remote-key"
        key = get_gemini_key()
        assert key == "remote-key"
        mock_get.assert_called_once()
        
        # Test Delete
        delete_gemini_key()
        mock_del.assert_called_once()
        assert utils.keychain_manager._cached_key is None

def test_keychain_error_handling():
    """Test how the manager handles KeyringError."""
    with patch('keyring.get_password') as mock_get:
        # Clear cache
        import utils.keychain_manager
        utils.keychain_manager._cached_key = None
        
        mock_get.side_effect = KeyringError("Access Denied")
        key = get_gemini_key()
        assert key is None

def test_set_key_raises_error():
    """Test that set_gemini_key re-raises KeyringError as expected."""
    with patch('keyring.set_password') as mock_set:
        mock_set.side_effect = KeyringError("Write Failed")
        with pytest.raises(KeyringError):
            set_gemini_key("new-key")

def test_delete_key_ignores_error():
    """Test that delete_gemini_key handles errors gracefully (no raise)."""
    with patch('keyring.delete_password') as mock_del:
        mock_del.side_effect = Exception("System Error")
        delete_gemini_key()
        # Should not raise
