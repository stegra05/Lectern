# Script Mode Card Recommendation Increase Design

## Problem Statement

Script mode currently recommends too few cards for dense text documents relative to user expectations.  
The user requested a **100% increase** for script mode recommended cards and corresponding max slider behavior.

## Goals

- Increase script-mode recommended card count by 100%.
- Ensure slider max in the UI reflects the increased recommendation without adding extra frontend logic.
- Keep slides-mode behavior unchanged.

## Non-Goals

- No changes to estimation API contracts.
- No changes to slides-mode recommendation formula.
- No additional UI redesign.

## Current State

- Backend script recommendation is computed in `lectern/cost_estimator.py`:
  - `round((text_chars / 1000) * config.SCRIPT_SUGGESTED_CARDS_PER_1K)`
- Default config value in `lectern/config.py`:
  - `SCRIPT_SUGGESTED_CARDS_PER_1K = 1.5` (env-overridable)
- Frontend slider config in `gui/frontend/src/utils/density.ts`:
  - `max = ceil(suggestedCardCount * 1.25)`

Because slider max is derived from suggested count, increasing script recommendation automatically increases max.

## Options Considered

### Option A (Recommended): Change default constant from 1.5 to 3.0

- **Change:** `SCRIPT_SUGGESTED_CARDS_PER_1K` default value in config only.
- **Pros:** Minimal change surface, low risk, clear behavior, preserves env override.
- **Cons:** Global default shift for script mode.

### Option B: Multiply by 2 in formula

- **Change:** Keep default at 1.5, apply `* 2` in `compute_suggested_card_count`.
- **Pros:** Explicit formula-level expression.
- **Cons:** More logic branching for same outcome.

### Option C: Add dedicated multiplier config

- **Change:** New env/config key such as `SCRIPT_SUGGESTED_MULTIPLIER=2.0`.
- **Pros:** More tunable long-term.
- **Cons:** Extra config complexity not required by request.

## Selected Approach

Use **Option A**: update config default from **1.5 -> 3.0**.

### Acceptance Criteria

- In environments **without** `SCRIPT_SUGGESTED_CARDS_PER_1K`, the script-mode **coefficient** is doubled from `1.5` to `3.0`.
- Numeric recommendation outputs follow existing rounding and floor behavior (`round(...)`, `max(1, ...)`), so very small inputs are not required to show exact 2x integer output.
- In environments **with** `SCRIPT_SUGGESTED_CARDS_PER_1K` explicitly set, existing override precedence is preserved (no forced rewrite of user-specified value).
- Slides-mode recommendation behavior remains unchanged.
- Slider max continues to derive from suggested count and therefore increases automatically when script suggestion increases.

## Detailed Design

### Backend

- File: `lectern/config.py`
- Update:
  - `SCRIPT_SUGGESTED_CARDS_PER_1K: float = float(os.getenv("SCRIPT_SUGGESTED_CARDS_PER_1K", "3.0"))`

No additional backend code changes are needed because recommendation calculation already consumes this setting.

### Frontend

No code changes required.

- `computeTargetSliderConfig()` derives max from suggested count (`1.25x`), so max increases as a direct consequence of higher script recommendation.

### Behavioral Example

Input:

- `text_chars = 5000`
- script mode detected

Before:

- suggested = `round((5000/1000) * 1.5)` = `round(7.5)` = `8`

After:

- suggested = `round((5000/1000) * 3.0)` = `round(15)` = `15`

Frontend max (same formula):

- before max: `ceil(8 * 1.25)` = `10`
- after max: `ceil(15 * 1.25)` = `19`

## Error Handling and Compatibility

- No new error paths introduced.
- Existing env override remains compatible:
  - If user sets `SCRIPT_SUGGESTED_CARDS_PER_1K`, that value continues to take precedence.

## Testing Strategy

### Unit tests to update

- `tests/test_cost_estimator.py`
  - `test_compute_suggested_card_count_script` expectation from `8` to `15`.
  - Keep existing slides test to assert no-regression in slides-mode recommendation behavior.

- `gui/frontend/src/tests/density.test.ts`
  - Add/confirm a case that `computeTargetSliderConfig(15)` returns `max=19`, proving slider max derivation follows increased suggestion without frontend logic changes.

### Additional backend compatibility test

- Add a focused backend test that verifies env override precedence still applies when `SCRIPT_SUGGESTED_CARDS_PER_1K` is explicitly configured.
- Test method must be explicit and deterministic:
  - use `monkeypatch.setenv(...)`,
  - reload `lectern.config` (and, if needed, `lectern.cost_estimator`) via `importlib.reload`,
  - assert the recommendation formula uses the overridden coefficient.

### End-to-end propagation check

- Add a frontend+backend integration regression check (existing estimation-to-slider path) asserting:
  - backend script suggestion value arrives in estimation response,
  - frontend slider config computes `max = ceil(suggested * 1.25)` from that value.

### Verification commands

- Focused backend:
  - `pytest tests/test_cost_estimator.py -v`
- Focused frontend:
  - `cd gui/frontend && npm test -- --run src/tests/density.test.ts`
- Full backend:
  - `pytest tests/ -v`
- Frontend (regression confidence for slider math path):
  - `cd gui/frontend && npm run lint && npm test -- --run`

## Risks and Mitigations

- **Risk:** Higher default recommendation may increase cost estimates for script-mode documents.
- **Mitigation:** This is intended behavior per user request, and can be tuned via env override without code changes.

## Rollout Notes

- No migration or data backfill needed.
- Effective on next app/backend startup (config reload behavior unchanged).
