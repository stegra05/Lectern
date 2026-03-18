"""Factory for selecting AI providers."""

from __future__ import annotations

from typing import Any, Callable

from lectern.providers.base import AIProvider
from lectern.providers.gemini_provider import GeminiProvider

DEFAULT_PROVIDER = "gemini"


ProviderConstructor = Callable[..., AIProvider]


_PROVIDER_MAP: dict[str, ProviderConstructor] = {
    "gemini": GeminiProvider,
}


def create_provider(provider_name: str | None = None, **kwargs: Any) -> AIProvider:
    """Create an AI provider for the requested backend."""

    resolved_name = (provider_name or DEFAULT_PROVIDER).strip().lower()
    provider_cls = _PROVIDER_MAP.get(resolved_name)
    if provider_cls is None:
        supported = ", ".join(sorted(_PROVIDER_MAP))
        raise ValueError(
            f"Unsupported provider '{provider_name}'. Supported providers: {supported}"
        )
    return provider_cls(**kwargs)
