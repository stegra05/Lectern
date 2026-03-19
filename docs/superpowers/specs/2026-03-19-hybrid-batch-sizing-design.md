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

Computation:

1. `target_batch = round(total_cards_cap * DYNAMIC_BATCH_TARGET_RATIO)`
2. `guardrail_min = max(PAGE_GUARDRAIL_MIN_FLOOR, round(page_center * PAGE_GUARDRAIL_MIN_RATIO))`
3. `guardrail_max = max(guardrail_min, round(page_center * PAGE_GUARDRAIL_MAX_RATIO))`
4. `hybrid_batch = clamp(target_batch, guardrail_min, guardrail_max)`
5. `actual_batch_size = clamp(hybrid_batch, DYNAMIC_MIN_NOTES_PER_BATCH, DYNAMIC_MAX_NOTES_PER_BATCH)`

Normalization rules:

- If any min/max pair is inverted, normalize locally before clamp.
- If `total_cards_cap <= 0`, fallback to page-centered batch before final clamp.

## Why Hybrid Instead of Pure Target-Aware

Pure target-aware is strongly aligned to user intent but can ignore document shape.  
Hybrid keeps target intent as primary while retaining page-derived sanity bounds for unusual PDFs.

## Expected Behavioral Impact

- More frequent generation batches versus current page-only rule in many cases.
- More frequent grounding gate + repair opportunities.
- Potentially higher call count, but better quality control granularity.

No expected change to:

- early stop semantics (`grounding_non_progress_*`),
- reflection-round logic,
- progress event contract.

## Files to Change

- `lectern/config.py`
  - Add dynamic batch and page guardrail settings.
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

