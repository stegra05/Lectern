from __future__ import annotations

import asyncio
import base64
import re
from typing import Any, Dict, Tuple

from lectern import config
from lectern.ai_client import LecternAIClient
from lectern.ai_common import _compose_multimodal_content


def _estimate_page_count_from_pdf_bytes(pdf_bytes: bytes) -> int:
    """Fallback: regex page count when pypdf fails."""
    matches = re.findall(rb"/Type\s*/Page\b", pdf_bytes)
    if matches:
        return len(matches)
    return max(1, int(len(pdf_bytes) / 80000))


def _extract_pdf_metadata(pdf_path: str) -> Dict[str, int]:
    """Extract text length, page count, and image count via pypdf."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(pdf_path)
        page_count = len(reader.pages)
        total_text = ""
        image_count = 0
        for page in reader.pages:
            total_text += page.extract_text() or ""
            image_count += len(page.images)
        return {
            "page_count": max(1, page_count),
            "text_chars": len(total_text),
            "image_count": image_count,
        }
    except Exception:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
        page_count = _estimate_page_count_from_pdf_bytes(pdf_bytes)
        return {
            "page_count": page_count,
            "text_chars": page_count * 600,
            "image_count": 0,
        }


def detect_content_mode(*, source_type: str, chars_per_page: float) -> str:
    normalized_source = source_type.lower()
    if normalized_source == "script" or (
        normalized_source == "auto" and chars_per_page > config.DENSE_THRESHOLD_CHARS_PER_PAGE
    ):
        return "script"
    return "slides"


def estimate_card_cap(
    *,
    page_count: int,
    estimated_text_chars: int,
    image_count: int,
    source_type: str,
    density_target: float | None,
    target_card_count: int | None = None,
    script_base_chars: int = 1000,
) -> Tuple[int, bool]:
    chars_per_page = estimated_text_chars / page_count if page_count > 0 else 0.0
    mode = detect_content_mode(source_type=source_type, chars_per_page=chars_per_page)
    is_script_mode = mode == "script"

    if target_card_count is not None:
        return max(1, int(target_card_count)), is_script_mode

    effective_target = (
        density_target
        if density_target is not None
        else float(getattr(config, "CARDS_PER_SLIDE_TARGET", 1.5))
    )
    if is_script_mode:
        text_cards = estimated_text_chars / script_base_chars * effective_target
        image_cards = image_count * 0.5
        return max(5, int(text_cards + image_cards)), True
    return max(3, int(page_count * effective_target)), False


def derive_effective_target(
    *,
    page_count: int,
    estimated_text_chars: int,
    source_type: str,
    target_card_count: int | None,
    density_target: float | None,
    script_base_chars: int = 1000,
) -> tuple[float, bool]:
    chars_per_page = estimated_text_chars / page_count if page_count > 0 else 0.0
    mode = detect_content_mode(source_type=source_type, chars_per_page=chars_per_page)
    is_script_mode = mode == "script"

    if target_card_count is not None:
        target = float(max(1, int(target_card_count)))
        if is_script_mode:
            basis = max(estimated_text_chars / script_base_chars, 1e-6)
        else:
            basis = max(float(page_count), 1.0)
        return target / basis, is_script_mode

    effective_target = (
        density_target
        if density_target is not None
        else float(getattr(config, "CARDS_PER_SLIDE_TARGET", 1.5))
    )
    return float(effective_target), is_script_mode


def compute_suggested_card_count(
    *,
    page_count: int,
    text_chars: int,
    source_type: str,
) -> int:
    chars_per_page = text_chars / page_count if page_count > 0 else 0.0
    mode = detect_content_mode(source_type=source_type, chars_per_page=chars_per_page)
    if mode == "script":
        return max(1, round((text_chars / 1000) * config.SCRIPT_SUGGESTED_CARDS_PER_1K))
    return max(1, round(page_count * 1.0))


def _estimate_card_count_from_metadata(
    *,
    page_count: int,
    estimated_text_chars: int,
    image_count: int,
    source_type: str,
    density_target: float | None,
    target_card_count: int | None = None,
) -> int:
    card_cap, _ = estimate_card_cap(
        page_count=page_count,
        estimated_text_chars=estimated_text_chars,
        image_count=image_count,
        source_type=source_type,
        density_target=density_target,
        target_card_count=target_card_count,
    )
    return card_cap


def _compute_cost_and_output(
    *,
    token_count: int,
    page_count: int,
    text_chars: int,
    image_count: int,
    model: str,
    source_type: str,
    density_target: float | None,
    target_card_count: int | None = None,
) -> Dict[str, Any]:
    """Cheap recompute: card count + cost from cached base data. No network/upload."""
    estimated_card_count = _estimate_card_count_from_metadata(
        page_count=page_count,
        estimated_text_chars=text_chars,
        image_count=image_count,
        source_type=source_type,
        density_target=density_target,
        target_card_count=target_card_count,
    )
    suggested_card_count = compute_suggested_card_count(
        page_count=page_count,
        text_chars=text_chars,
        source_type=source_type,
    )
    input_tokens = token_count + config.ESTIMATION_PROMPT_OVERHEAD
    base_output = int(input_tokens * config.ESTIMATION_BASE_OUTPUT_RATIO)
    card_output = estimated_card_count * config.ESTIMATION_TOKENS_PER_CARD
    output_tokens = base_output + card_output
    pricing = config.GEMINI_PRICING.get("default")
    for pattern, rates in config.GEMINI_PRICING.items():
        if pattern in model.lower():
            pricing = rates
            break
    input_cost = (input_tokens / 1_000_000) * pricing[0]
    output_cost = (output_tokens / 1_000_000) * pricing[1]
    return {
        "tokens": token_count,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "input_cost": input_cost,
        "output_cost": output_cost,
        "cost": input_cost + output_cost,
        "pages": page_count,
        "text_chars": text_chars,
        "model": model,
        "estimated_card_count": estimated_card_count,
        "suggested_card_count": suggested_card_count,
        "image_count": image_count,
        "image_token_cost": 0,
        "image_token_source": "native_embedded",
    }


async def estimate_cost(
    pdf_path: str,
    model_name: str | None = None,
    source_type: str = "auto",
    density_target: float | None = None,
    target_card_count: int | None = None,
) -> Dict[str, Any]:
    """Estimate token count and cost for processing a PDF (full path: metadata + upload + token count)."""
    result, _ = await estimate_cost_with_base(
        pdf_path=pdf_path,
        model_name=model_name,
        source_type=source_type,
        density_target=density_target,
        target_card_count=target_card_count,
    )
    return result


async def estimate_cost_with_base(
    pdf_path: str,
    model_name: str | None = None,
    source_type: str = "auto",
    density_target: float | None = None,
    target_card_count: int | None = None,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Full estimate + base data for cache. Returns (response, base_data)."""
    metadata = await asyncio.to_thread(_extract_pdf_metadata, pdf_path)
    page_count = metadata["page_count"]
    text_chars = metadata["text_chars"]
    image_count = metadata["image_count"]

    ai = LecternAIClient(model_name=model_name)
    uploaded_pdf = ai.upload_pdf(pdf_path)
    token_count = ai.count_tokens_for_pdf(
        file_uri=uploaded_pdf["uri"],
        mime_type=uploaded_pdf.get("mime_type", "application/pdf"),
        prompt="Analyze this PDF for card generation cost estimation.",
    )
    model = model_name or config.DEFAULT_GEMINI_MODEL

    result = _compute_cost_and_output(
        token_count=token_count,
        page_count=page_count,
        text_chars=text_chars,
        image_count=image_count,
        model=model,
        source_type=source_type,
        density_target=density_target,
        target_card_count=target_card_count,
    )
    base_data = {
        "token_count": token_count,
        "page_count": page_count,
        "text_chars": text_chars,
        "image_count": image_count,
        "model": model,
    }
    return result, base_data


def recompute_estimate(
    *,
    token_count: int,
    page_count: int,
    text_chars: int,
    image_count: int,
    model: str,
    source_type: str = "auto",
    density_target: float | None = None,
    target_card_count: int | None = None,
) -> Dict[str, Any]:
    """Cheap recompute: card count + cost from cached base data. No network/upload."""
    return _compute_cost_and_output(
        token_count=token_count,
        page_count=page_count,
        text_chars=text_chars,
        image_count=image_count,
        model=model,
        source_type=source_type,
        density_target=density_target,
        target_card_count=target_card_count,
    )


async def verify_image_token_cost(model_name: str | None = None) -> Dict[str, Any]:
    """Estimate per-image token cost via count_tokens delta (text+image vs text-only)."""
    # 1x1 transparent PNG, useful for deterministic token-delta checks.
    tiny_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zz8QAAAAASUVORK5CYII="
    )
    prompt = "Token counting probe."

    text_only_content = _compose_multimodal_content([{"text": "probe", "images": []}], prompt)
    image_content = _compose_multimodal_content([{"text": "probe", "images": [tiny_png]}], prompt)

    ai = LecternAIClient(model_name=model_name)
    text_tokens = ai.count_tokens(text_only_content)
    image_tokens = ai.count_tokens(image_content)
    delta = max(0, image_tokens - text_tokens)

    return {
        "text_tokens": text_tokens,
        "image_tokens": image_tokens,
        "delta_per_image": delta,
    }
