# Hybrid Batch Sizing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement hybrid generation batch sizing (target-aware primary + page-based guardrail) without changing pacing behavior.

**Architecture:** Keep orchestration flow unchanged and modify only batch-size computation in `GenerationPhase`. Add explicit config knobs for hybrid sizing and implement the algorithm in a focused helper function for deterministic, unit-testable behavior. Keep API/event contracts unchanged and update AI pipeline docs to match runtime behavior.

**Tech Stack:** Python (FastAPI orchestration), pytest, docs (`AI_PIPELINE.md`)

---

## Spec Reference

- Spec: `docs/superpowers/specs/2026-03-19-hybrid-batch-sizing-design.md`

## File Structure Map

- Modify: `lectern/config.py`  
  Add hybrid batch settings (ratio + dynamic clamps + page guardrail bounds/floor).

- Modify: `lectern/orchestration/phases.py`  
  Add pure helper to compute hybrid batch size and use it from `GenerationPhase.execute`.

- Modify: `tests/test_generation_phase.py`  
  Add TDD tests for hybrid sizing behavior, integration wiring, and edge handling.

- Modify: `tests/test_config.py`  
  Add config-default test for new batch knobs.

- Modify: `docs/AI_PIPELINE.md`  
  Document hybrid batching rule.

---

## Chunk 1: Config + Core Hybrid Computation + Integration Wiring

**Chunk boundary note:** Chunk 1 is intentionally interim and not spec-complete by itself.  
Spec-mandated sanitization fallback branches (including `total_cards_cap <= 0`) are finalized in Chunk 2 Task 4. Do not consider this work complete until Chunk 2 verification passes.

### Task 1: Add hybrid batch config knobs with safe env parsing

**Files:**
- Modify: `lectern/config.py`
- Modify: `tests/test_config.py`

- [ ] **Step 0: Capture baseline for this chunk**

Run: `pytest tests/test_generation_phase.py::test_generation_phase_maps_domain_events_and_updates_context -v`  
Expected: PASS before any batch-sizing changes.

- [ ] **Step 1: Write failing config test for new batch knobs (RED)**

```python
def test_dynamic_batch_env_overrides_are_loaded() -> None:
    with patch.dict(os.environ, {
        "DYNAMIC_BATCH_TARGET_RATIO": "0.15",
        "DYNAMIC_MIN_NOTES_PER_BATCH": "10",
        "DYNAMIC_MAX_NOTES_PER_BATCH": "25",
        "PAGE_GUARDRAIL_MIN_RATIO": "0.7",
        "PAGE_GUARDRAIL_MAX_RATIO": "1.3",
        "PAGE_GUARDRAIL_MIN_FLOOR": "8",
    }, clear=False):
        import importlib
        import lectern.config as c
        importlib.reload(c)
        assert c.DYNAMIC_BATCH_TARGET_RATIO == 0.15
        assert c.DYNAMIC_MIN_NOTES_PER_BATCH == 10
        assert c.DYNAMIC_MAX_NOTES_PER_BATCH == 25
        assert c.PAGE_GUARDRAIL_MIN_RATIO == 0.7
        assert c.PAGE_GUARDRAIL_MAX_RATIO == 1.3
        assert c.PAGE_GUARDRAIL_MIN_FLOOR == 8

def test_dynamic_batch_invalid_env_values_fallback_to_defaults() -> None:
    with patch.dict(os.environ, {
        "DYNAMIC_BATCH_TARGET_RATIO": "nan",
        "DYNAMIC_MIN_NOTES_PER_BATCH": "0",
        "DYNAMIC_MAX_NOTES_PER_BATCH": "-3",
        "PAGE_GUARDRAIL_MIN_RATIO": "-1",
        "PAGE_GUARDRAIL_MAX_RATIO": "-2",
        "PAGE_GUARDRAIL_MIN_FLOOR": "-9",
    }, clear=False):
        import importlib
        import lectern.config as c
        importlib.reload(c)
        assert c.DYNAMIC_BATCH_TARGET_RATIO == 0.15
        assert c.DYNAMIC_MIN_NOTES_PER_BATCH == 10
        assert c.DYNAMIC_MAX_NOTES_PER_BATCH == 25
        assert c.PAGE_GUARDRAIL_MIN_RATIO == 0.7
        assert c.PAGE_GUARDRAIL_MAX_RATIO == 1.3
        assert c.PAGE_GUARDRAIL_MIN_FLOOR == 8
```

- [ ] **Step 2: Run test to confirm RED**

Run: `pytest tests/test_config.py -k "dynamic_batch_env_overrides_are_loaded or dynamic_batch_invalid_env_values_fallback_to_defaults" -v`  
Expected: FAIL with missing config attributes/constants.

- [ ] **Step 3: Implement safe env helpers + constants**

```python
import math

def _safe_float_env(name: str, default: float) -> float:
    raw = os.getenv(name, str(default))
    try:
        value = float(raw)
    except Exception:
        return float(default)
    if math.isnan(value) or math.isinf(value):
        return float(default)
    return value

def _safe_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        return int(raw)
    except Exception:
        return int(default)

DYNAMIC_BATCH_TARGET_RATIO: float = _safe_float_env("DYNAMIC_BATCH_TARGET_RATIO", 0.15)
DYNAMIC_MIN_NOTES_PER_BATCH: int = _safe_int_env("DYNAMIC_MIN_NOTES_PER_BATCH", 10)
DYNAMIC_MAX_NOTES_PER_BATCH: int = _safe_int_env("DYNAMIC_MAX_NOTES_PER_BATCH", 25)
PAGE_GUARDRAIL_MIN_RATIO: float = _safe_float_env("PAGE_GUARDRAIL_MIN_RATIO", 0.7)
PAGE_GUARDRAIL_MAX_RATIO: float = _safe_float_env("PAGE_GUARDRAIL_MAX_RATIO", 1.3)
PAGE_GUARDRAIL_MIN_FLOOR: int = _safe_int_env("PAGE_GUARDRAIL_MIN_FLOOR", 8)

# threshold enforcement (spec-aligned)
if DYNAMIC_BATCH_TARGET_RATIO <= 0:
    DYNAMIC_BATCH_TARGET_RATIO = 0.15
if DYNAMIC_MIN_NOTES_PER_BATCH < 1:
    DYNAMIC_MIN_NOTES_PER_BATCH = 10
if DYNAMIC_MAX_NOTES_PER_BATCH < 1:
    DYNAMIC_MAX_NOTES_PER_BATCH = 25
if PAGE_GUARDRAIL_MIN_RATIO < 0:
    PAGE_GUARDRAIL_MIN_RATIO = 0.7
if PAGE_GUARDRAIL_MAX_RATIO < 0:
    PAGE_GUARDRAIL_MAX_RATIO = 1.3
if PAGE_GUARDRAIL_MIN_FLOOR < 0:
    PAGE_GUARDRAIL_MIN_FLOOR = 8
```

- [ ] **Step 4: Re-run config test to confirm GREEN**

Run: `pytest tests/test_config.py -k "dynamic_batch_env_overrides_are_loaded or dynamic_batch_invalid_env_values_fallback_to_defaults" -v`  
Expected: PASS with `2 passed, 0 failed`.

- [ ] **Step 5: Commit task**

```bash
git add lectern/config.py tests/test_config.py
git commit -m "feat: add hybrid batch sizing config knobs"
```

### Task 2: Add pure hybrid helper and deterministic unit tests

**Files:**
- Modify: `lectern/orchestration/phases.py`
- Modify: `tests/test_generation_phase.py`

- [ ] **Step 1: Write failing helper tests (RED)**

```python
def test_compute_hybrid_batch_size_prefers_target_with_page_guardrail() -> None:
    assert _compute_hybrid_batch_size(total_cards_cap=100, page_count=60) == 21

def test_compute_hybrid_batch_size_small_target_hits_dynamic_min() -> None:
    assert _compute_hybrid_batch_size(total_cards_cap=20, page_count=20) == 10

def test_compute_hybrid_batch_size_normalizes_inverted_bounds() -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        dynamic_min=30,
        dynamic_max=12,
        guardrail_min_ratio=0.0,
        guardrail_max_ratio=10.0,
        guardrail_floor=0,
    ) == 15

def test_compute_hybrid_batch_size_applies_guardrail_max_cap() -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=16,
        guardrail_min_ratio=0.0,
        guardrail_max_ratio=0.8,
        guardrail_floor=0,
        dynamic_min=1,
        dynamic_max=100,
    ) == 6

def test_compute_hybrid_batch_size_applies_dynamic_max_clamp() -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=200,
        page_count=100,
        dynamic_ratio=0.5,
        dynamic_min=1,
        dynamic_max=17,
        guardrail_min_ratio=0.0,
        guardrail_max_ratio=10.0,
        guardrail_floor=0,
    ) == 17

def test_compute_hybrid_batch_size_normalizes_inverted_guardrail_ratios() -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        guardrail_min_ratio=1.3,
        guardrail_max_ratio=0.7,
    ) == 21

def test_compute_hybrid_batch_size_uses_python_round_semantics() -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=50,
        page_count=20,
        dynamic_ratio=0.25,
        dynamic_min=1,
        dynamic_max=100,
        guardrail_min_ratio=0.0,
        guardrail_max_ratio=10.0,
        guardrail_floor=0,
    ) == 12
```

- [ ] **Step 2: Run helper tests to confirm RED**

Run: `pytest tests/test_generation_phase.py -k "hybrid_batch_size or inverted_guardrail_ratios or python_round_semantics or guardrail_max_cap or dynamic_max_clamp" -v`  
Expected: FAIL (`1+ failed`).

- [ ] **Step 3: Implement `_compute_hybrid_batch_size` minimally**

```python
def _compute_hybrid_batch_size(
    *,
    total_cards_cap: int,
    page_count: int,
    dynamic_ratio: float | None = None,
    dynamic_min: int | None = None,
    dynamic_max: int | None = None,
    guardrail_min_ratio: float | None = None,
    guardrail_max_ratio: float | None = None,
    guardrail_floor: int | None = None,
) -> int:
    ratio = dynamic_ratio if dynamic_ratio is not None else config.DYNAMIC_BATCH_TARGET_RATIO
    dmin = dynamic_min if dynamic_min is not None else config.DYNAMIC_MIN_NOTES_PER_BATCH
    dmax = dynamic_max if dynamic_max is not None else config.DYNAMIC_MAX_NOTES_PER_BATCH
    gmin_r = guardrail_min_ratio if guardrail_min_ratio is not None else config.PAGE_GUARDRAIL_MIN_RATIO
    gmax_r = guardrail_max_ratio if guardrail_max_ratio is not None else config.PAGE_GUARDRAIL_MAX_RATIO
    gfloor = guardrail_floor if guardrail_floor is not None else config.PAGE_GUARDRAIL_MIN_FLOOR

    if dmin > dmax:
        dmin, dmax = dmax, dmin
    if gmin_r > gmax_r:
        gmin_r, gmax_r = gmax_r, gmin_r

    page_center = max(0, page_count // 2)
    target_batch = round(total_cards_cap * ratio)
    guardrail_min = max(gfloor, round(page_center * gmin_r))
    guardrail_max = max(guardrail_min, round(page_center * gmax_r))

    hybrid_batch = max(guardrail_min, min(guardrail_max, target_batch))
    actual_batch = max(dmin, min(dmax, hybrid_batch))
    return int(actual_batch)
```

- [ ] **Step 4: Re-run helper tests to confirm GREEN**

Run: `pytest tests/test_generation_phase.py -k "hybrid_batch_size or inverted_guardrail_ratios or python_round_semantics or guardrail_max_cap or dynamic_max_clamp" -v`  
Expected: PASS (`0 failed`).

### Task 3: Wire helper into GenerationPhase and lock pacing invariance

**Files:**
- Modify: `lectern/orchestration/phases.py`
- Modify: `tests/test_generation_phase.py`

- [ ] **Step 1: Write failing integration test (RED)**

```python
@pytest.mark.asyncio
async def test_generation_phase_sets_actual_batch_size_from_hybrid_helper_and_keeps_pacing_fields() -> None:
    emitter = RecordingEmitter()
    context = _context()
    context.pages = [{"number": i} for i in range(60)]
    context.concept_map = {"concepts": [], "relations": []}
    context.examples = "example style"
    context.pdf.metadata_chars = 48000
    context.pdf.image_count = 0

    fake_orchestrator = MagicMock()
    fake_orchestrator.state = SimpleNamespace(all_cards=[], seen_keys=set())
    fake_orchestrator.prepare_generation.return_value = GenerationSetupResult(
        effective_target=2.5,
        total_cards_cap=100,
        is_script_mode=False,
        chars_per_page=800.0,
        initial_coverage={"total_pages": 60, "covered_page_count": 0},
    )
    fake_orchestrator.should_stop.return_value = True

    async def run_generation(*args, **kwargs):
        del args, kwargs
        if False:
            yield

    async def run_reflection(*args, **kwargs):
        del args, kwargs
        if False:
            yield

    fake_orchestrator.run_generation = run_generation
    fake_orchestrator.run_reflection = run_reflection

    with patch("lectern.orchestration.phases.SessionOrchestrator", return_value=fake_orchestrator):
        await GenerationPhase().execute(context, emitter, MagicMock())

    assert context.targets.actual_batch_size == 21
    assert context.targets.effective_target == 2.5
    assert context.targets.chars_per_page == 800.0
```

- [ ] **Step 2: Run integration test to confirm RED**

Run: `pytest tests/test_generation_phase.py::test_generation_phase_sets_actual_batch_size_from_hybrid_helper_and_keeps_pacing_fields -v`  
Expected: FAIL (`1 failed`) before wiring.

- [ ] **Step 3: Replace old page-only formula with helper call**

```python
batch_size = _compute_hybrid_batch_size(
    total_cards_cap=setup.total_cards_cap,
    page_count=len(context.pages),
    dynamic_ratio=config.DYNAMIC_BATCH_TARGET_RATIO,
    dynamic_min=config.DYNAMIC_MIN_NOTES_PER_BATCH,
    dynamic_max=config.DYNAMIC_MAX_NOTES_PER_BATCH,
    guardrail_min_ratio=config.PAGE_GUARDRAIL_MIN_RATIO,
    guardrail_max_ratio=config.PAGE_GUARDRAIL_MAX_RATIO,
    guardrail_floor=config.PAGE_GUARDRAIL_MIN_FLOOR,
)
```

- [ ] **Step 4: Re-run helper + integration tests to confirm GREEN**

Run: `pytest tests/test_generation_phase.py -k "hybrid_batch_size or actual_batch_size_from_hybrid_helper_and_keeps_pacing_fields or generation_phase_maps_domain_events_and_updates_context" -v`  
Expected: PASS (`0 failed`).

- [ ] **Step 5: Commit tasks 2+3**

```bash
git add lectern/orchestration/phases.py tests/test_generation_phase.py
git commit -m "feat: implement hybrid batch size computation in generation phase"
```

- [ ] **Step 6: End-of-chunk verification snapshot**

Run: `pytest tests/test_config.py -k "dynamic_batch_env_overrides_are_loaded or dynamic_batch_invalid_env_values_fallback_to_defaults" -v && pytest tests/test_generation_phase.py -k "hybrid_batch_size or actual_batch_size_from_hybrid_helper_and_keeps_pacing_fields or generation_phase_maps_domain_events_and_updates_context" -v`  
Expected: all selected tests PASS (`0 failed`).

---

## Chunk 2: Sanitization, Docs, and Full Verification

### Task 4: Add edge-case sanitization and tests

**Files:**
- Modify: `lectern/orchestration/phases.py`
- Modify: `tests/test_generation_phase.py`

- [ ] **Step 1: Write failing edge-case tests (RED)**

```python
def test_compute_hybrid_batch_size_uses_page_center_when_cap_non_positive() -> None:
    # page_center=20 should be used as target before clamping
    assert _compute_hybrid_batch_size(
        total_cards_cap=0,
        page_count=40,
        dynamic_min=1,
        dynamic_max=100,
        guardrail_min_ratio=0.0,
        guardrail_max_ratio=10.0,
        guardrail_floor=0,
    ) == 20

def test_compute_hybrid_batch_size_uses_page_center_when_cap_negative() -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=-5,
        page_count=40,
        dynamic_min=1,
        dynamic_max=100,
        guardrail_min_ratio=0.0,
        guardrail_max_ratio=10.0,
        guardrail_floor=0,
    ) == 20

def test_compute_hybrid_batch_size_handles_zero_pages() -> None:
    result = _compute_hybrid_batch_size(total_cards_cap=50, page_count=0)
    assert 10 <= result <= 25

@pytest.mark.parametrize("bad_ratio", [0.0, -0.1, float("nan"), float("inf"), -float("inf")])
def test_compute_hybrid_batch_size_invalid_ratio_falls_back_to_default(bad_ratio: float) -> None:
    assert _compute_hybrid_batch_size(total_cards_cap=100, page_count=60, dynamic_ratio=bad_ratio) == 21

@pytest.mark.parametrize("bad_ratio", ["abc", "", object()])
def test_compute_hybrid_batch_size_non_numeric_ratio_falls_back_to_default(bad_ratio: object) -> None:
    assert _compute_hybrid_batch_size(total_cards_cap=100, page_count=60, dynamic_ratio=bad_ratio) == 21

@pytest.mark.parametrize("bad_guardrail_ratio", [-0.1, float("nan"), float("inf"), -float("inf")])
def test_compute_hybrid_batch_size_invalid_guardrail_ratio_falls_back_to_default(
    bad_guardrail_ratio: float,
) -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        guardrail_min_ratio=bad_guardrail_ratio,
        guardrail_max_ratio=1.3,
    ) == 21
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        guardrail_min_ratio=0.7,
        guardrail_max_ratio=bad_guardrail_ratio,
    ) == 21

@pytest.mark.parametrize("bad_guardrail_ratio", ["abc", "", object()])
def test_compute_hybrid_batch_size_non_numeric_guardrail_ratio_falls_back_to_default(
    bad_guardrail_ratio: object,
) -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        guardrail_min_ratio=bad_guardrail_ratio,
        guardrail_max_ratio=1.3,
    ) == 21
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        guardrail_min_ratio=0.7,
        guardrail_max_ratio=bad_guardrail_ratio,
    ) == 21

@pytest.mark.parametrize(
    "dynamic_min,dynamic_max,guardrail_floor,expected",
    [
        (0, 25, 8, 21),      # min invalid -> default min=10
        (10, 0, 8, 21),      # max invalid -> default max=25
        (10, 25, -5, 21),    # floor invalid -> default floor=8
    ],
)
def test_compute_hybrid_batch_size_invalid_int_thresholds_fallback(
    dynamic_min: int,
    dynamic_max: int,
    guardrail_floor: int,
    expected: int,
) -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        dynamic_min=dynamic_min,
        dynamic_max=dynamic_max,
        guardrail_floor=guardrail_floor,
    ) == expected

def test_compute_hybrid_batch_size_non_numeric_int_thresholds_fallback() -> None:
    assert _compute_hybrid_batch_size(
        total_cards_cap=100,
        page_count=60,
        dynamic_min="abc",
        dynamic_max="xyz",
        guardrail_floor="oops",
    ) == 21
```

- [ ] **Step 2: Run edge-case tests to confirm RED**

Run: `pytest tests/test_generation_phase.py -k "cap_non_positive or cap_negative or zero_pages or invalid_ratio or non_numeric_ratio or invalid_guardrail_ratio or non_numeric_guardrail_ratio or invalid_int_thresholds_fallback or non_numeric_int_thresholds_fallback" -v`  
Expected: FAIL before sanitization code is added (`1+ failed`).

- [ ] **Step 3: Implement minimal sanitization logic**

Implement in helper:
- ratio fallback for invalid (`<=0`, NaN/Inf),
- ratio fallback for non-numeric values,
- dynamic min/max fallback to defaults if invalid,
- dynamic min/max and guardrail floor fallback for non-numeric values,
- guardrail ratio fallback + normalization,
- guardrail ratio fallback for non-numeric values,
- guardrail floor fallback to default when `< 0`,
- non-positive cap fallback to page_center.
- Note: non-numeric string parsing is enforced at config-loading layer (`_safe_*_env`), while helper-level tests cover runtime numeric-invalid cases (NaN/Inf/threshold violations).

- [ ] **Step 4: Re-run edge-case tests to confirm GREEN**

Run: `pytest tests/test_generation_phase.py -k "cap_non_positive or cap_negative or zero_pages or invalid_ratio or non_numeric_ratio or invalid_guardrail_ratio or non_numeric_guardrail_ratio or invalid_int_thresholds_fallback or non_numeric_int_thresholds_fallback" -v`  
Expected: PASS with `0 failed`.

- [ ] **Step 5: Commit edge-case hardening**

```bash
git add lectern/orchestration/phases.py tests/test_generation_phase.py
git commit -m "test: cover hybrid batch sizing sanitization edge cases"
```

### Task 5: Update docs and run regressions

**Files:**
- Modify: `docs/AI_PIPELINE.md`

- [ ] **Step 1: Update batching description**

Document:
- target-aware primary (`total_cards_cap * ratio`),
- page-derived guardrail bounds,
- final dynamic min/max clamp,
- no pacing logic changes.
Expected doc outcome: `docs/AI_PIPELINE.md` explicitly states hybrid batch sizing and explicitly states pacing behavior is unchanged.

- [ ] **Step 2: Run focused tests**

Run: `pytest tests/test_generation_phase.py -v`  
Expected: PASS (`0 failed`).

- [ ] **Step 3: Run full backend regression**

Run: `pytest tests/ -v`  
Expected: PASS; no new failures introduced.

- [ ] **Step 4: Commit docs update**

```bash
git add docs/AI_PIPELINE.md
git commit -m "docs: describe hybrid generation batch sizing"
```

- [ ] **Step 5: Final verification snapshot**

Run:

```bash
git --no-pager status
```

Expected: output contains `working tree clean` or only intentional unrelated pre-existing changes.
