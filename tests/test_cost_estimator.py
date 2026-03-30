import pytest

from lectern.cost_estimator import (
    derive_effective_target,
    estimate_card_cap,
    compute_suggested_card_count,
)


def test_compute_suggested_card_count_slides():
    # 10 pages, slides mode -> default 0.6 cards per slide = 6 cards
    count = compute_suggested_card_count(page_count=10, text_chars=2000)
    assert count == 6


def test_compute_suggested_card_count_script():
    # 5000 chars, script mode -> (5000/1000) * 3.0 = 15 cards
    count = compute_suggested_card_count(page_count=2, text_chars=5000)
    assert count == 15

def test_compute_suggested_card_count_script_respects_env_override(monkeypatch):
    import importlib
    import lectern.config as config_module
    import lectern.cost_estimator as estimator

    monkeypatch.setenv("SCRIPT_SUGGESTED_CARDS_PER_1K", "2.0")
    importlib.reload(config_module)
    importlib.reload(estimator)
    try:
        # 5000/1000 * 2.0 = 10
        count = estimator.compute_suggested_card_count(page_count=2, text_chars=5000)
        assert count == 10
    finally:
        monkeypatch.delenv("SCRIPT_SUGGESTED_CARDS_PER_1K", raising=False)
        importlib.reload(config_module)
        importlib.reload(estimator)

def test_derive_effective_target_slides():
    # 10 pages, target 20 -> density 2.0
    density, is_script = derive_effective_target(
        page_count=10,
        estimated_text_chars=2000,
        target_card_count=20,
        density_target=None,
    )
    assert density == 2.0
    assert is_script is False


def test_derive_effective_target_script():
    # 5000 chars, target 10 -> density 10 / (5000/1000) = 2.0
    density, is_script = derive_effective_target(
        page_count=2,
        estimated_text_chars=5000,
        target_card_count=10,
        density_target=None,
    )
    assert density == 2.0
    assert is_script is True


def test_estimate_card_cap_respects_target():
    cap, is_script = estimate_card_cap(
        page_count=10,
        estimated_text_chars=2000,
        image_count=0,
        density_target=None,
        target_card_count=42,
    )
    assert cap == 42
    assert is_script is False


def test_estimate_card_cap_fallback():
    # 10 pages, no target -> fallback to config default
    cap, _ = estimate_card_cap(
        page_count=10,
        estimated_text_chars=2000,
        image_count=0,
        density_target=None,
        target_card_count=None,
    )
    # Default 0.6 * 10 = 6
    assert cap == 6


def test_cost_scales_with_card_count():
    """Cost should increase when target_card_count increases (the user's core complaint)."""
    from lectern.cost_estimator import _compute_cost_and_output

    base_kwargs = dict(
        token_count=10000,
        page_count=10,
        text_chars=5000,
        image_count=0,
        model="gemini-3-flash-preview",
        density_target=None,
    )

    result_10 = _compute_cost_and_output(**base_kwargs, target_card_count=10)
    result_50 = _compute_cost_and_output(**base_kwargs, target_card_count=50)

    assert (
        result_50["cost"] > result_10["cost"]
    ), f"Cost for 50 cards (${result_50['cost']:.4f}) should be > cost for 10 cards (${result_10['cost']:.4f})"
    assert result_50["output_tokens"] > result_10["output_tokens"]


@pytest.mark.asyncio
async def test_estimate_cost_with_base_returns_upload_metadata_for_cache() -> None:
    from dataclasses import dataclass
    from unittest.mock import patch
    from lectern import cost_estimator as mod

    @dataclass(frozen=True)
    class _Uploaded:
        uri: str
        mime_type: str

    class _FakeAI:
        def __init__(self, model_name=None):
            self.model_name = model_name

        async def upload_document(self, pdf_path: str):
            del pdf_path
            return _Uploaded(uri="gs://upload-cache.pdf", mime_type="application/pdf")

        async def count_tokens_for_pdf(self, *, file_uri: str, mime_type: str, prompt: str):
            assert file_uri == "gs://upload-cache.pdf"
            assert mime_type == "application/pdf"
            assert prompt
            return 321

    async def _fake_to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    with patch.object(mod, "extract_pdf_metadata", return_value={"page_count": 2, "text_chars": 1200, "image_count": 1}), \
            patch.object(mod, "LecternAIClient", _FakeAI), \
            patch.object(mod.asyncio, "to_thread", side_effect=_fake_to_thread):
        _result, base = await mod.estimate_cost_with_base(
            pdf_path="/tmp/test.pdf",
            model_name="gemini-2.5-flash",
            target_card_count=5,
        )

    assert base["uploaded_uri"] == "gs://upload-cache.pdf"
    assert base["uploaded_mime_type"] == "application/pdf"
    assert base["token_count"] == 321
