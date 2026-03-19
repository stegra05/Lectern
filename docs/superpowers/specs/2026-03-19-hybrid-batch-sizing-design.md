# Hybrid Batch Sizing Design (Target-Aware + Page Guardrail)

## Problem Statement

Current generation batching is page-driven:

- `actual_batch_size = clamp(len(pages)//2, MIN_NOTES_PER_BATCH, MAX_NOTES_PER_BATCH)`

This can produce large batches for quality-sensitive runs and offers less frequent grounding/repair checkpoints.  
We want to improve grounding reliability by moving to smaller, target-aware batches while keeping a page-based safety guardrail.

## Goals

- Keep pacing logic unchanged.
- Keep target-card optional behavior unchanged (auto-estimation remains when user does not provide a target).
- Improve generation quality control by making batch sizing primarily target-aware.
- Preserve document-size awareness via a secondary page-based guardrail.

## Non-Goals

- No change to `derive_effective_target` / `estimate_card_cap` behavior.
- No change to generation loop stop conditions.
- No change to frontend progress semantics/events.

## Proposed Approach

Use a hybrid batch-size computation in `GenerationPhase`:

1. Use computed `setup.total_cards_cap` as the primary driver.
2. Apply page-based guardrail bounds derived from `len(context.pages)//2`.
3. Apply final absolute min/max clamps.

This keeps batching policy centralized where it already lives and avoids touching orchestrator internals.

## Algorithm

Given:

- `total_cards_cap = setup.total_cards_cap`
- `page_center = len(context.pages) // 2`

Config knobs:

- `DYNAMIC_BATCH_TARGET_RATIO` (default `0.15`)
- `DYNAMIC_MIN_NOTES_PER_BATCH` (default `10`)
- `DYNAMIC_MAX_NOTES_PER_BATCH` (default `25`)
- `PAGE_GUARDRAIL_MIN_RATIO` (default `0.7`)
- `PAGE_GUARDRAIL_MAX_RATIO` (default `1.3`)
- `PAGE_GUARDRAIL_MIN_FLOOR` (default `8`)

Parameter constraints (normative):

- `DYNAMIC_BATCH_TARGET_RATIO` must be `> 0`; invalid values fallback to default `0.15`.
- `PAGE_GUARDRAIL_MIN_RATIO` and `PAGE_GUARDRAIL_MAX_RATIO` must be `>= 0`; invalid values fallback to defaults `0.7` and `1.3`.
- `PAGE_GUARDRAIL_MIN_FLOOR` must be `>= 0`; invalid values fallback to `8`.
- `DYNAMIC_MIN_NOTES_PER_BATCH` and `DYNAMIC_MAX_NOTES_PER_BATCH` must be `>= 1`; invalid values fallback to defaults `10` and `25`.

Definition of invalid (normative):

- non-numeric parsed value,
- `NaN`,
- positive/negative infinity,
- value violating the threshold rules above.

Computation:

1. `target_batch = round(total_cards_cap * DYNAMIC_BATCH_TARGET_RATIO)`
2. `guardrail_min = max(PAGE_GUARDRAIL_MIN_FLOOR, round(page_center * PAGE_GUARDRAIL_MIN_RATIO))`
3. `guardrail_max = max(guardrail_min, round(page_center * PAGE_GUARDRAIL_MAX_RATIO))`
4. `hybrid_batch = clamp(target_batch, guardrail_min, guardrail_max)`
5. `actual_batch_size = clamp(hybrid_batch, DYNAMIC_MIN_NOTES_PER_BATCH, DYNAMIC_MAX_NOTES_PER_BATCH)`

Normalization rules:

- If a min/max pair is inverted, **swap values** before use.
- If `total_cards_cap <= 0`, set `target_batch = page_center`.
- If `len(context.pages) == 0`, set `page_center = 0` then rely on floors/final clamp.
- For guardrail ratios, if `PAGE_GUARDRAIL_MIN_RATIO > PAGE_GUARDRAIL_MAX_RATIO`, swap before computing guardrail bounds.

### Canonical Pseudocode (Normative)

```python
def _sanitize_float(value: Any, default: float, *, min_inclusive: float | None = None, greater_than: float | None = None) -> float:
    try:
        f = float(value)
    except Exception:
        return default
    if math.isnan(f) or math.isinf(f):
        return default
    if min_inclusive is not None and f < min_inclusive:
        return default
    if greater_than is not None and f <= greater_than:
        return default
    return f

def _sanitize_int(value: Any, default: int, *, min_inclusive: int | None = None) -> int:
    try:
        i = int(value)
    except Exception:
        return default
    if min_inclusive is not None and i < min_inclusive:
        return default
    return i

def sanitize_batch_config(raw_cfg) -> BatchConfig:
    return BatchConfig(
        dynamic_ratio=_sanitize_float(raw_cfg.DYNAMIC_BATCH_TARGET_RATIO, 0.15, greater_than=0.0),
        dynamic_min=_sanitize_int(raw_cfg.DYNAMIC_MIN_NOTES_PER_BATCH, 10, min_inclusive=1),
        dynamic_max=_sanitize_int(raw_cfg.DYNAMIC_MAX_NOTES_PER_BATCH, 25, min_inclusive=1),
        guardrail_min_ratio=_sanitize_float(raw_cfg.PAGE_GUARDRAIL_MIN_RATIO, 0.7, min_inclusive=0.0),
        guardrail_max_ratio=_sanitize_float(raw_cfg.PAGE_GUARDRAIL_MAX_RATIO, 1.3, min_inclusive=0.0),
        guardrail_floor=_sanitize_int(raw_cfg.PAGE_GUARDRAIL_MIN_FLOOR, 8, min_inclusive=0),
    )

def _norm_bounds(min_v: int, max_v: int) -> tuple[int, int]:
    return (max_v, min_v) if min_v > max_v else (min_v, max_v)

def _norm_ratio_bounds(min_r: float, max_r: float) -> tuple[float, float]:
    return (max_r, min_r) if min_r > max_r else (min_r, max_r)

cfg = sanitize_batch_config(config)
page_center = max(0, len(context.pages) // 2)

dynamic_min, dynamic_max = _norm_bounds(
    cfg.dynamic_min,
    cfg.dynamic_max,
)
guardrail_min_ratio, guardrail_max_ratio = _norm_ratio_bounds(
    cfg.guardrail_min_ratio,
    cfg.guardrail_max_ratio,
)

# rounding semantics: Python built-in round() (banker's rounding)
target_batch = round(setup.total_cards_cap * cfg.dynamic_ratio)
if setup.total_cards_cap <= 0:
    target_batch = page_center

guardrail_min = max(
    cfg.guardrail_floor,
    round(page_center * guardrail_min_ratio),
)
guardrail_max = max(
    guardrail_min,
    round(page_center * guardrail_max_ratio),
)

hybrid_batch = clamp(target_batch, guardrail_min, guardrail_max)
actual_batch_size = clamp(hybrid_batch, dynamic_min, dynamic_max)
```

### Worked Examples

1. **Explicit target 100, medium deck (60 pages)**  
   - `page_center=30`, `target_batch=15` (`ratio=0.15`)  
   - guardrail band: `[21, 39]` (`0.7x` to `1.3x`)  
   - `hybrid_batch=21`, final clamp `[10,25]` -> `actual_batch_size=21`

2. **Auto-estimated cap 20, small deck (20 pages)**  
   - `page_center=10`, `target_batch=3`  
   - guardrail band: `[8, 13]` (floor keeps lower bound sensible)  
   - `hybrid_batch=8`, final clamp `[10,25]` -> `actual_batch_size=10`

3. **Misconfigured dynamic bounds (`min=30`, `max=12`)**  
   - normalized to `[12, 30]` before final clamp use.

## Why Hybrid Instead of Pure Target-Aware

Pure target-aware is strongly aligned to user intent but can ignore document shape.  
Hybrid keeps target intent as primary while retaining page-derived sanity bounds for unusual PDFs.

## Expected Behavioral Impact

- More frequent generation batches versus current page-only rule in many cases.
- More frequent grounding gate + repair opportunities.
- Potentially higher call count, but better quality control granularity.

No expected change to:

- stop **logic** semantics (`grounding_non_progress_*`),
- reflection-round logic,
- progress event contract.

Clarification on stop behavior:

- Threshold values and stop reasons are unchanged in this scope.
- Because batch counts may increase, **frequency** of stop checks can increase; this is expected and accepted for quality-first behavior.
- Retuning `GROUNDING_NON_PROGRESS_MAX_BATCHES` is explicitly out of scope for this change.

## Files to Change

- `lectern/config.py`
  - Add dynamic batch and page guardrail settings.
  - Keep legacy `MIN_NOTES_PER_BATCH` / `MAX_NOTES_PER_BATCH` defined but **unused by this new algorithm**.
- `lectern/orchestration/phases.py`
  - Replace page-only batch sizing block with hybrid computation.
- `docs/AI_PIPELINE.md`
  - Update batched generation section to describe hybrid sizing.

## Testing Strategy (TDD)

Add failing tests first (RED), then implement minimal code (GREEN):

- `tests/test_generation_phase.py`
  - asserts target-ratio influences batch size.
  - asserts page guardrail can cap or raise target-derived value.
  - asserts final dynamic min/max clamps are respected.
  - asserts pacing fields remain unchanged (regression guard).
  - asserts inverted dynamic bounds are normalized deterministically.
  - asserts `total_cards_cap <= 0` fallback uses page_center.
  - asserts `len(context.pages)==0` still yields valid bounded batch size.
  - asserts invalid ratio values (non-numeric/NaN/inf/negative/zero) fallback to defaults.
  - asserts invalid min/max/floor values fallback to defaults.
  - asserts rounding behavior matches Python `round()` semantics.

Verification commands:

- Focused: `pytest tests/test_generation_phase.py -v`
- Full backend: `pytest tests/ -v`

## Risks and Mitigations

- Risk: too many tiny batches increasing overhead  
  - Mitigation: dynamic min clamp + page guardrail floor.

- Risk: config complexity  
  - Mitigation: conservative defaults and backward-compatible legacy batch settings retained.

- Risk: accidental pacing drift  
  - Mitigation: explicit non-goal + regression assertions.

## Rollout Notes

- This is backward-compatible at API/event level.
- Behavior can be tuned with env vars without further code changes.
- Config precedence for batching:
  - New algorithm uses only: `DYNAMIC_*` and `PAGE_GUARDRAIL_*`.
  - Legacy `MIN_NOTES_PER_BATCH` / `MAX_NOTES_PER_BATCH` are retained for compatibility but are not consulted by hybrid sizing.

### Edge-Case I/O Table (Normative)

| Inputs | Output expectation |
|---|---|
| `total_cards_cap=100`, `pages=60`, defaults | `actual_batch_size=21` |
| `total_cards_cap=20`, `pages=20`, defaults | `actual_batch_size=10` |
| `pages=0`, defaults | valid bounded result within dynamic clamp (`[10,25]`) |
| inverted dynamic min/max (`30`,`12`) | normalized to (`12`,`30`) before final clamp |
| inverted guardrail ratios (`1.3`,`0.7`) | normalized to (`0.7`,`1.3`) before guardrail computation |
| invalid/negative ratio value | fallback to default ratio before computation |
