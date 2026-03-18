import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Literal, Optional, Union

from lectern.version import __version__
from lectern import config, anki_connector
from lectern.config import ConfigManager
from lectern.utils.error_handling import capture_exception

router = APIRouter()

# --- Models ---


class VersionResponse(BaseModel):
    current: str
    latest: Optional[str] = None
    update_available: bool
    release_url: str


class HealthResponse(BaseModel):
    status: str
    anki_connected: bool
    gemini_configured: bool
    active_provider: str
    provider_configured: bool
    provider_ready: bool
    backend_ready: bool


class ConfigResponse(BaseModel):
    ai_provider: Optional[str] = None
    gemini_model: Optional[str] = None
    anki_url: Optional[str] = None
    basic_model: Optional[str] = None
    cloze_model: Optional[str] = None
    tag_template: Optional[str] = None
    gemini_configured: bool


class ConfigUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    anki_url: Optional[str] = None
    basic_model: Optional[str] = None
    cloze_model: Optional[str] = None
    gemini_model: Optional[str] = None
    tag_template: Optional[str] = None


class ConfigUpdatedResponse(BaseModel):
    status: Literal["updated"]
    fields: List[str]
    warnings: Optional[List[str]] = None


class ConfigNoChangeResponse(BaseModel):
    status: Literal["no_change"]


ConfigUpdateResponse = Union[ConfigUpdatedResponse, ConfigNoChangeResponse]

# --- Endpoints ---


def _provider_readiness() -> tuple[str, bool]:
    active_provider = (str(config.AI_PROVIDER or "gemini")).strip().lower()
    if active_provider == "gemini":
        return active_provider, bool(config.GEMINI_API_KEY)
    return active_provider, True


@router.get("/version", response_model=VersionResponse)
async def get_version():
    """Returns local version and checks GitHub for updates."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.github.com/repos/stegra05/Lectern/releases/latest",
                headers={"Accept": "application/vnd.github.v3+json"},
                timeout=5.0,
            )

        if response.status_code == 200:
            data = response.json()
            latest_version = data.get("tag_name", "v0.0.0").lstrip("v")
            release_url = data.get(
                "html_url", "https://github.com/stegra05/Lectern/releases"
            )

            curr_parts = [int(p) for p in __version__.split(".")]
            late_parts = [int(p) for p in latest_version.split(".")]

            update_available = late_parts > curr_parts

            return {
                "current": __version__,
                "latest": latest_version,
                "update_available": update_available,
                "release_url": release_url,
            }
    except Exception as e:
        capture_exception(e, "Version check")

    return {
        "current": __version__,
        "latest": None,
        "update_available": False,
        "release_url": "https://github.com/stegra05/Lectern/releases",
    }


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint that safely checks system status."""
    anki_status = False
    active_provider, provider_configured = _provider_readiness()
    try:
        anki_status = await anki_connector.check_connection()
    except Exception as e:
        capture_exception(e, "Anki health check")

    return {
        "status": "ok",
        "anki_connected": anki_status,
        "gemini_configured": bool(config.GEMINI_API_KEY),
        "active_provider": active_provider,
        "provider_configured": provider_configured,
        "provider_ready": provider_configured,
        "backend_ready": True,
    }


@router.get("/config", response_model=ConfigResponse)
async def get_config():
    return {
        "ai_provider": config.AI_PROVIDER,
        "gemini_model": config.DEFAULT_GEMINI_MODEL,
        "anki_url": config.ANKI_CONNECT_URL,
        "basic_model": config.DEFAULT_BASIC_MODEL,
        "cloze_model": config.DEFAULT_CLOZE_MODEL,
        "tag_template": config.TAG_TEMPLATE,
        "gemini_configured": bool(config.GEMINI_API_KEY),
    }


@router.post("/config", response_model=ConfigUpdateResponse)
async def update_config(cfg: ConfigUpdate):
    updated_fields = []

    if cfg.gemini_api_key:
        try:
            from lectern.utils.keychain_manager import set_gemini_key

            set_gemini_key(cfg.gemini_api_key)
            updated_fields.append("gemini_api_key")
        except Exception as e:
            user_msg, _ = capture_exception(e, "API key update")
            raise HTTPException(status_code=500, detail=user_msg)

    json_updates = {}
    if cfg.anki_url:
        json_updates["anki_url"] = cfg.anki_url
        updated_fields.append("anki_url")

    warnings = []
    if cfg.basic_model or cfg.cloze_model:
        try:
            anki_info = await anki_connector.get_connection_info()
            if anki_info.get("connected") and anki_info.get(
                "collection_available", False
            ):
                anki_models = await anki_connector.get_model_names()
            else:
                anki_models = []
        except Exception as e:
            capture_exception(e, "Model names fetch")
            anki_models = []

        if anki_models:
            if cfg.basic_model and cfg.basic_model not in anki_models:
                warnings.append(
                    f"Note type '{cfg.basic_model}' not found in Anki — saving anyway."
                )
            if cfg.cloze_model and cfg.cloze_model not in anki_models:
                warnings.append(
                    f"Note type '{cfg.cloze_model}' not found in Anki — saving anyway."
                )

    if cfg.basic_model:
        json_updates["basic_model"] = cfg.basic_model
        updated_fields.append("basic_model")
    if cfg.cloze_model:
        json_updates["cloze_model"] = cfg.cloze_model
        updated_fields.append("cloze_model")
    if cfg.gemini_model:
        json_updates["gemini_model"] = cfg.gemini_model
        updated_fields.append("gemini_model")
    if cfg.tag_template:
        json_updates["tag_template"] = cfg.tag_template
        updated_fields.append("tag_template")

    if json_updates:
        try:
            mgr = ConfigManager.instance()
            for key, value in json_updates.items():
                mgr.set(key, value)
        except Exception as e:
            user_msg, _ = capture_exception(e, "Config save")
            raise HTTPException(status_code=500, detail=user_msg)

    if updated_fields:
        from lectern.utils import note_export as _ne

        _ne._anki_models_cache = None
        _ne._detected_builtins_cache = None
        result: dict = {"status": "updated", "fields": updated_fields}
        if warnings:
            result["warnings"] = warnings
        return result

    return {"status": "no_change"}
