import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Literal, Optional, Union

from lectern.version import __version__
from lectern import config, anki_connector
from lectern.config import ConfigManager
from lectern.providers.factory import DEFAULT_PROVIDER, is_supported_provider
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
    diagnostics: "HealthDiagnostics"


class AnkiDiagnostics(BaseModel):
    status: Literal["healthy", "offline", "unreachable"]
    connected: bool
    reason: Optional[str] = None
    hint: Optional[str] = None


class ProviderDiagnostics(BaseModel):
    name: str
    configured: bool
    ready: bool
    reason: Optional[str] = None
    hint: Optional[str] = None


class ApiKeyDiagnostics(BaseModel):
    required: bool
    configured: bool
    reason: Optional[str] = None
    hint: Optional[str] = None


class HealthDiagnostics(BaseModel):
    anki: AnkiDiagnostics
    provider: ProviderDiagnostics
    api_key: ApiKeyDiagnostics


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
    active_provider = (str(config.AI_PROVIDER or DEFAULT_PROVIDER)).strip().lower()
    if not is_supported_provider(active_provider):
        return active_provider, False
    if active_provider == "gemini":
        return active_provider, bool(config.GEMINI_API_KEY)
    return active_provider, True


def _build_health_diagnostics(
    *,
    active_provider: str,
    provider_ready: bool,
    anki_connected: bool,
    anki_error: Optional[str],
) -> HealthDiagnostics:
    provider_supported = is_supported_provider(active_provider)
    api_key_required = active_provider == "gemini"
    api_key_configured = bool(config.GEMINI_API_KEY)

    anki_reason = None
    anki_hint = None
    anki_status: Literal["healthy", "offline", "unreachable"] = "healthy"
    if not anki_connected:
        if anki_error:
            anki_status = "unreachable"
            anki_reason = anki_error
        else:
            anki_status = "offline"
            anki_reason = "Anki connection check returned offline."
        anki_hint = (
            "Start Anki and ensure AnkiConnect is installed/enabled "
            "(add-on code: 2055492159)."
        )

    provider_reason = None
    provider_hint = None
    if not provider_supported:
        provider_reason = f"Unsupported provider '{active_provider}'."
        provider_hint = "Set ai_provider to a supported backend (e.g. gemini)."
    elif active_provider == "gemini" and not api_key_configured:
        provider_reason = "Gemini provider requires an API key."
        provider_hint = "Add a Gemini API key in Settings to enable generation."

    api_key_reason = None
    api_key_hint = None
    if api_key_required and not api_key_configured:
        api_key_reason = "Gemini API key is missing."
        api_key_hint = "Open Settings and provide a Gemini API key."

    return HealthDiagnostics(
        anki=AnkiDiagnostics(
            status=anki_status,
            connected=anki_connected,
            reason=anki_reason,
            hint=anki_hint,
        ),
        provider=ProviderDiagnostics(
            name=active_provider,
            configured=provider_supported,
            ready=provider_ready,
            reason=provider_reason,
            hint=provider_hint,
        ),
        api_key=ApiKeyDiagnostics(
            required=api_key_required,
            configured=api_key_configured,
            reason=api_key_reason,
            hint=api_key_hint,
        ),
    )


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
    anki_error: Optional[str] = None
    active_provider, provider_ready = _provider_readiness()
    try:
        anki_status = await anki_connector.check_connection()
    except Exception as e:
        anki_error = str(e)
        capture_exception(e, "Anki health check")

    diagnostics = _build_health_diagnostics(
        active_provider=active_provider,
        provider_ready=provider_ready,
        anki_connected=anki_status,
        anki_error=anki_error,
    )

    return {
        "status": "ok",
        "anki_connected": anki_status,
        "gemini_configured": bool(config.GEMINI_API_KEY),
        "active_provider": active_provider,
        "provider_configured": provider_ready,
        "provider_ready": provider_ready,
        "backend_ready": True,
        "diagnostics": diagnostics.model_dump(exclude_none=True),
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
