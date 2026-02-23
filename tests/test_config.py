"""
Tests for lectern/config.py - Configuration management.

Tests the ConfigManager singleton, config priority (env > user > defaults),
persistence, and error handling.
"""

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from lectern.config import ConfigManager, save_user_config


@pytest.fixture(autouse=True)
def reset_config_and_env(tmp_path: Path):
    """Ensure ConfigManager singleton is reset and env vars are cleared before/after each test."""
    # Reset singleton before test
    ConfigManager._reset_instance()

    # Save and clear relevant env vars
    env_vars_to_clear = [
        "DEFAULT_GEMINI_MODEL",
        "LIGHTWEIGHT_MODEL",
        "ANKI_CONNECT_URL",
        "BASIC_MODEL_NAME",
        "CLOZE_MODEL_NAME",
        "TAG_TEMPLATE",
    ]
    original_values = {}
    for var in env_vars_to_clear:
        original_values[var] = os.environ.get(var)
        if var in os.environ:
            del os.environ[var]

    # Use a temp directory for config storage during test
    temp_config = tmp_path / "test_config"
    temp_config.mkdir(exist_ok=True)

    with patch("lectern.config.get_app_data_dir", return_value=temp_config):
        yield

    # Restore original environment
    for var, value in original_values.items():
        if value is not None:
            os.environ[var] = value
        elif var in os.environ:
            del os.environ[var]

    # Reset singleton after test
    ConfigManager._reset_instance()


@pytest.fixture
def temp_config_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory for config files."""
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    return config_dir


class TestConfigManagerSingleton:
    """Test ConfigManager singleton behavior."""

    def test_singleton_returns_same_instance(self) -> None:
        """Multiple calls to instance() return the same object."""
        instance1 = ConfigManager.instance()
        instance2 = ConfigManager.instance()

        assert instance1 is instance2

    def test_reset_instance_allows_new_instance(self) -> None:
        """Reset allows creation of a new instance."""
        instance1 = ConfigManager.instance()
        ConfigManager._reset_instance()
        instance2 = ConfigManager.instance()

        # After reset, should be a different object
        assert instance1 is not instance2

    def test_singleton_persists_across_calls(self) -> None:
        """Instance persists across multiple access patterns."""
        instance = ConfigManager.instance()
        instance.set("test_key", "test_value")

        # Get again and verify value persists
        same_instance = ConfigManager.instance()
        assert same_instance.get("test_key") == "test_value"


class TestConfigPriority:
    """Test configuration value priority: env var > user config > defaults."""

    def test_default_value_when_no_override(self) -> None:
        """Returns default when no env var or user config exists."""
        config = ConfigManager.instance()

        # gemini_model has a default value
        assert config.get("gemini_model") == "gemini-3.0-flash"

    def test_env_var_overrides_default(self) -> None:
        """Environment variable takes precedence over default."""
        with patch.dict(os.environ, {"DEFAULT_GEMINI_MODEL": "custom-model"}):
            ConfigManager._reset_instance()
            config = ConfigManager.instance()

            assert config.get("gemini_model") == "custom-model"

    def test_user_config_overrides_default(self, temp_config_dir: Path) -> None:
        """User config file overrides default value."""
        # Write user config
        config_path = temp_config_dir / "user_config.json"
        config_path.write_text(json.dumps({"anki_url": "http://custom:8765"}))

        with patch("lectern.config.get_app_data_dir", return_value=temp_config_dir):
            ConfigManager._reset_instance()
            config = ConfigManager.instance()

            assert config.get("anki_url") == "http://custom:8765"

    def test_env_var_overrides_user_config(self, temp_config_dir: Path) -> None:
        """Environment variable takes precedence over user config."""
        # Write user config
        config_path = temp_config_dir / "user_config.json"
        config_path.write_text(json.dumps({"anki_url": "http://user:8765"}))

        with patch("lectern.config.get_app_data_dir", return_value=temp_config_dir):
            with patch.dict(os.environ, {"ANKI_CONNECT_URL": "http://env:8765"}):
                ConfigManager._reset_instance()
                config = ConfigManager.instance()

                assert config.get("anki_url") == "http://env:8765"

    def test_explicit_default_parameter(self) -> None:
        """Explicit default parameter is returned when key not found."""
        config = ConfigManager.instance()

        result = config.get("nonexistent_key", "explicit_default")
        assert result == "explicit_default"

    def test_none_for_missing_key_without_default(self) -> None:
        """Returns None for missing key when no default provided."""
        config = ConfigManager.instance()

        result = config.get("totally_nonexistent_key_12345")
        assert result is None


class TestConfigGetSet:
    """Test get() and set() operations."""

    def test_set_and_get_value(self) -> None:
        """Set stores value and get retrieves it."""
        config = ConfigManager.instance()

        config.set("anki_url", "http://localhost:9999")
        assert config.get("anki_url") == "http://localhost:9999"

    def test_set_overwrites_existing(self) -> None:
        """Set overwrites previously set value."""
        config = ConfigManager.instance()

        config.set("anki_url", "http://first:8765")
        config.set("anki_url", "http://second:8765")

        assert config.get("anki_url") == "http://second:8765"

    def test_get_all_returns_copy(self) -> None:
        """get_all returns a copy of internal config dict."""
        config = ConfigManager.instance()
        config.set("test_key", "test_value")

        all_config = config.get_all()

        # Modifying returned dict doesn't affect internal state
        all_config["another_key"] = "another_value"
        assert "another_key" not in config.get_all()

    def test_env_mapping_for_different_keys(self) -> None:
        """Various config keys map to correct environment variables."""
        env_mappings = {
            "anki_url": "ANKI_CONNECT_URL",
            "basic_model": "BASIC_MODEL_NAME",
            "cloze_model": "CLOZE_MODEL_NAME",
        }

        for config_key, env_key in env_mappings.items():
            ConfigManager._reset_instance()
            with patch.dict(os.environ, {env_key: f"test_{config_key}"}):
                config = ConfigManager.instance()
                assert config.get(config_key) == f"test_{config_key}"


class TestConfigPersistence:
    """Test JSON file persistence and error handling."""

    def test_set_persists_to_file(self, temp_config_dir: Path) -> None:
        """Set operation writes to JSON file."""
        with patch("lectern.config.get_app_data_dir", return_value=temp_config_dir):
            ConfigManager._reset_instance()
            config = ConfigManager.instance()

            config.set("anki_url", "http://persisted:8765")

            # Verify file was written
            config_path = temp_config_dir / "user_config.json"
            assert config_path.exists()

            with open(config_path) as f:
                saved = json.load(f)

            assert saved["anki_url"] == "http://persisted:8765"

    def test_load_reads_existing_config(self, temp_config_dir: Path) -> None:
        """ConfigManager loads existing config file on init."""
        config_path = temp_config_dir / "user_config.json"
        config_path.write_text(json.dumps({
            "anki_url": "http://preexisting:8765",
            "custom_key": "custom_value"
        }))

        with patch("lectern.config.get_app_data_dir", return_value=temp_config_dir):
            ConfigManager._reset_instance()
            config = ConfigManager.instance()

            assert config.get("anki_url") == "http://preexisting:8765"
            assert config.get("custom_key") == "custom_value"

    def test_load_handles_malformed_json(self, temp_config_dir: Path, caplog) -> None:
        """Malformed JSON file is handled gracefully."""
        config_path = temp_config_dir / "user_config.json"
        config_path.write_text("{ invalid json }")

        with patch("lectern.config.get_app_data_dir", return_value=temp_config_dir):
            ConfigManager._reset_instance()
            config = ConfigManager.instance()

            # Should fall back to empty config
            assert config.get_all() == {}
            assert "Failed to load" in caplog.text

    def test_save_handles_write_error(self, caplog) -> None:
        """Save error is logged but doesn't raise."""
        ConfigManager._reset_instance()
        config = ConfigManager.instance()

        with patch("builtins.open", side_effect=PermissionError("Write denied")):
            # Should not raise
            config.set("anki_url", "http://test:8765")

        assert "Failed to save" in caplog.text

    def test_config_directory_created(self, tmp_path: Path) -> None:
        """Config directory is created if it doesn't exist."""
        config_dir = tmp_path / "new_config"
        # Don't create the directory - ConfigManager should create it

        with patch("lectern.config.get_app_data_dir", return_value=config_dir):
            ConfigManager._reset_instance()
            config = ConfigManager.instance()

            config.set("test", "value")

            # Directory should be created
            assert config_dir.exists()


class TestLegacyPathMigration:
    """Test migration from legacy config path."""

    def test_migrates_legacy_config(self, temp_config_dir: Path) -> None:
        """Legacy config file is copied to new location."""
        # Create legacy config in the module directory
        legacy_path = Path(__file__).parent.parent / "lectern" / "user_config.json"

        # Clean up any existing file first
        if legacy_path.exists():
            legacy_path.unlink()

        try:
            legacy_path.write_text(json.dumps({"migrated_key": "migrated_value"}))

            with patch("lectern.config.get_app_data_dir", return_value=temp_config_dir):
                ConfigManager._reset_instance()
                config = ConfigManager.instance()

                # Should have loaded the migrated config
                assert config.get("migrated_key") == "migrated_value"

                # New location should now exist
                new_path = temp_config_dir / "user_config.json"
                assert new_path.exists()

        finally:
            # Cleanup legacy file
            if legacy_path.exists():
                legacy_path.unlink()


class TestDynamicAttributeAccess:
    """Test __getattr__ for dynamic config access."""

    def test_module_level_attribute_access(self) -> None:
        """Module-level attributes return live config values."""
        ConfigManager._reset_instance()
        ConfigManager.instance().set("gemini_model", "dynamic-model")

        # Access via module attribute
        import lectern.config as config_module
        assert config_module.DEFAULT_GEMINI_MODEL == "dynamic-model"

    def test_module_attribute_for_anki_url(self) -> None:
        """ANKI_CONNECT_URL is accessible via module attribute."""
        ConfigManager._reset_instance()
        ConfigManager.instance().set("anki_url", "http://module:8765")

        import lectern.config as config_module
        assert config_module.ANKI_CONNECT_URL == "http://module:8765"

    def test_invalid_attribute_raises(self) -> None:
        """Accessing non-existent attribute raises AttributeError."""
        import lectern.config as config_module

        with pytest.raises(AttributeError, match="has no attribute"):
            _ = config_module.NONEXISTENT_CONFIG_KEY


class TestSaveUserConfigHelper:
    """Test the save_user_config helper function."""

    def test_save_user_config_delegates_to_manager(self, temp_config_dir: Path) -> None:
        """save_user_config updates ConfigManager for each key."""
        with patch("lectern.config.get_app_data_dir", return_value=temp_config_dir):
            ConfigManager._reset_instance()

            save_user_config({
                "anki_url": "http://helper:8765",
                "basic_model": "HelperBasic"
            })

            config = ConfigManager.instance()
            assert config.get("anki_url") == "http://helper:8765"
            assert config.get("basic_model") == "HelperBasic"


class TestConfigDefaults:
    """Test default configuration values."""

    def test_all_defaults_are_defined(self) -> None:
        """All expected default values are defined."""
        config = ConfigManager.instance()

        expected_defaults = {
            "gemini_model": "gemini-3.0-flash",
            "lightweight_model": "gemini-3.0-flash",
            "anki_url": "http://localhost:8765",
            "basic_model": "Basic",
            "cloze_model": "Cloze",
            "tag_template": "{{deck}}::{{slide_set}}::{{topic}}",
        }

        for key, expected_value in expected_defaults.items():
            assert config.get(key) == expected_value, f"Default for {key} mismatch"
