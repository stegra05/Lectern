# Generation Loop Restructuring for Grounding Consistency

## Problem Statement

Current generation quality issues are concentrated in factual grounding/provenance consistency:

- Cards can enter the accepted set with weak provenance fields (`source_excerpt`, `rationale`, `source_pages`).
- Reflection currently operates as a later global pass, so weak grounding can persist through much of the loop.
- Export only warns on rubric quality; weakly grounded cards are not actively gated.

The user priority is to improve grounding quality, even with higher cost/time, if gains are clear.

## Proposed Approach

Adopt an interleaved loop structure:

`Generate -> Grounding micro-pass -> Accept/Reject -> Coverage update`

This keeps the existing orchestrator structure but introduces a targeted quality gate immediately after each generation batch.

Retry semantics are strict and deterministic:

- Retry is **per-card**, not per-batch.
- Retry means up to **two micro-reflection attempts total per card**:
  - attempt 1: standard grounding repair
  - attempt 2: strict grounding repair
- No additional `generate_cards` call is used for retries in this design.

## Scope

### In Scope

- Per-batch targeted grounding repair for newly generated cards.
- Explicit promotion gate before cards are added to the accepted card set.
- Bounded retry policy for cards that fail grounding checks.
- Observability metrics for grounding improvements.

### Out of Scope

- Provider/model replacement.
- Full rewrite of generation/reflection architecture.
- UI redesign of progress surfaces (events may be extended, but no UI behavior redesign is required in this spec).

## Architecture Changes

### Current Control Flow (Simplified)

1. Generate batch cards.
2. Deduplicate and append to `all_cards`.
3. Update coverage/progress.
4. Run global reflection rounds later.

### New Control Flow (Per Batch)

1. Generate candidate cards (unchanged AI call surface).
2. Normalize and deduplicate candidates (within-batch and against global `seen_keys`) before any repair attempts.
3. Score/annotate candidates with existing rubric and provenance flags.
4. Partition candidates:
   - `pass_now`: already meet grounding gate.
   - `needs_repair`: weak provenance (e.g., missing rationale/source excerpt/source pages).
5. Run targeted micro-reflection on `needs_repair` only.
6. Re-score repaired candidates.
7. Promote only cards passing gate into `all_cards` (and `seen_keys`).
8. For cards still failing after attempt 1, run attempt 2 (strict mode), then drop with warning if still failing.
9. Update coverage/progress from promoted set.

Global reflection remains after generation, but as a polish/synthesis pass rather than primary grounding repair.

## Component Responsibilities

### SessionOrchestrator (`run_generation`)

- Continue owning loop/state mutations.
- Add transient per-batch candidate containers:
  - `pending_batch_cards`
  - `repaired_batch_cards`
  - `promoted_batch_cards`
- Enforce promotion gate before mutating canonical `all_cards`.
- Emit warnings for dropped cards and retry outcomes.
- Apply deterministic dedupe policy:
  - Use existing `get_card_key` normalization.
  - Drop duplicates against `seen_keys` before micro-reflection.
  - Drop intra-batch duplicates before micro-reflection.
  - After each repair attempt, dedupe repaired output again against `seen_keys` and current-batch promoted keys before promotion.
  - Never spend retry budget on duplicate candidates.

### Grounding Gate Policy (new helper module/function)

A deterministic policy that decides whether a card is promotable.

Inputs:

- `quality_score`
- `quality_flags`
- required provenance fields presence

Output:

- pass/fail boolean
- machine-readable fail reasons

Default pass criteria (initial):

- No `missing_source_excerpt`
- No `missing_rationale`
- No `missing_source_pages`
- Quality score at or above configurable threshold (`GROUNDING_GATE_MIN_QUALITY`, default `60.0`)
- Retry policy defaults:
  - `GROUNDING_RETRY_MAX_ATTEMPTS=2` (attempt1 standard + attempt2 strict)
  - `GROUNDING_NON_PROGRESS_MAX_BATCHES=2`

### Micro-Reflection Invocation

- Reuse existing reflection prompt contract/API.
- Operate only on weak cards from current batch.
- Use stricter grounding instruction variant for retry attempt.
- Keep attempts bounded to two total micro-reflection attempts per failed card to control cost/runtime.

Operational state machine (per card):

1. Candidate scored.
2. If passes gate -> promote immediately.
3. If fails gate and retry_count=0 -> micro-reflect once (standard repair), re-score.
4. If still failing and retry_count=1 -> micro-reflect once (strict repair), re-score.
5. If still failing -> drop with explicit fail reasons.

Attempt counting definition:

- `retry_count` counts completed micro-reflection attempts.
- `GROUNDING_RETRY_MAX_ATTEMPTS` is the total allowed micro-reflection attempts per card.

### Global Reflection (`run_reflection`)

- Keep existing phase and events.
- Position as quality polish + coverage rebalance, not gating.
- Revalidate any reflected replacement cards through the same grounding gate before they replace accepted cards.
- If a reflected replacement fails gate, keep the original accepted card instead of regressing grounding quality.

## Data Flow and State Integrity

- `all_cards` remains single source of truth for accepted cards.
- Weak candidates are never appended directly to canonical state.
- `seen_keys` updates only on promoted cards.
- Coverage is computed from accepted/promoted cards only.
- Card UUID injection remains on promoted/final cards before emission.

## Error Handling

- If micro-reflection call fails:
  - Emit warning with batch context.
  - Do not silently promote failed weak cards.
  - Mark affected weak cards as failed for that attempt and consume that attempt budget.
  - If attempt 1 failed due to call failure, card may proceed to attempt 2 (strict) within budget.
  - If final allowed attempt fails, drop card with reason `repair_call_failed`.
  - Continue with already passing cards in batch.
- If strict retry fails:
  - Drop candidates with explicit warning reasons.
- If quality scorer or gate evaluation raises for a candidate:
  - Treat as non-promotable.
  - Emit warning with normalized error kind (`grounding_gate_error`) and card key when available.
  - Continue processing remaining cards in batch.
- If repaired card payload is invalid (missing required shape/fields):
  - Treat as failed repair for that attempt.
  - Emit warning with reason `invalid_repaired_payload`.
  - Continue according to retry budget; if exhausted, drop card.
- If two consecutive batches produce zero promoted cards (`GROUNDING_NON_PROGRESS_MAX_BATCHES`):
  - Stop generation with explicit non-progress reason/event.
  - Preserve generated diagnostics in warning/error payloads for troubleshooting.
- No broad silent fallback behavior; failures are surfaced in events.

## Eventing and Observability

Add or extend event payloads to include:

- `generated_candidates_count`
- `grounding_repair_attempted_count`
- `grounding_promoted_count`
- `grounding_dropped_count`
- `grounding_drop_reasons` summary

Emission points:

- `GenerationBatchCompletedEvent` (per generation batch): include the grounding count fields above as optional additions.
- `WarningEmittedEvent` (per dropped/failed candidate): include machine-readable reason (`grounding_gate_error`, `invalid_repaired_payload`, or gate fail reasons).
- `GenerationStoppedEvent` (termination): use one canonical non-progress reason enum:
  - `grounding_non_progress_duplicates`
  - `grounding_non_progress_gate_failures`

Typed contract requirement:

- New payload keys must be added in shared event definitions on backend and in frontend event processing in lockstep.
- Maintain backward compatibility by only adding optional fields to existing events unless a coordinated event-version change is introduced.

Non-progress termination contract:

- Emit `GenerationStoppedEvent` with:
  - `reason="grounding_non_progress_duplicates"` when duplicate saturation is dominant.
  - `reason="grounding_non_progress_gate_failures"` when grounding gate failures are dominant.
- Include details payload fields:
  - `consecutive_zero_promoted_batches`
  - `last_batch_generated_candidates_count`
  - `last_batch_grounding_promoted_count`
  - `last_batch_grounding_dropped_count`
  - `last_batch_duplicate_drop_count`
  - `last_batch_gate_failure_drop_count`
- Dominance algorithm:
  - If `last_batch_duplicate_drop_count > last_batch_gate_failure_drop_count`, use `grounding_non_progress_duplicates`.
  - Otherwise (including ties), use `grounding_non_progress_gate_failures`.

Track run-level outcome metrics:

- Rate of cards with missing provenance flags.
- Average rubric quality.
- Promotion ratio and drop ratio.
- Retry-attempt distribution (attempt1 pass, attempt2 pass, dropped).

## Testing Strategy

Follow “Safety Net Before Surgery”:

1. Add/extend orchestrator tests for:
   - weak cards gated before promotion
   - micro-reflection repair path
   - strict retry then drop path
   - coverage computed from promoted cards only
   - scorer/gate exception path does not crash loop
   - invalid repaired payload path uses retry budget then drops
   - non-progress termination emits one of:
     - `grounding_non_progress_duplicates`
     - `grounding_non_progress_gate_failures`
2. Preserve existing reflection and export behavior tests.
3. Add regression assertions for emitted metric counts in domain/service events.

## Interfaces and Ownership

### Orchestrator-owned flow

- `SessionOrchestrator.run_generation(...)` remains the only owner of:
  - per-batch candidate lifecycle
  - promotion to canonical state
  - retry budget tracking
  - non-progress termination

### New helper interfaces

- `evaluate_grounding_gate(card: CardData, *, min_quality: float) -> tuple[bool, list[str]]`
  - Location: `lectern/generation_loop.py` (or adjacent helper module).
  - Pure function; no side effects.

- `repair_weak_cards(
    cards: list[CardData],
    *,
    strict: bool,
    coverage_gaps: str
  ) -> list[RepairResult]`
  - Location: orchestrator-private helper that wraps provider `reflect_cards`.
  - Side effects isolated to AI call + warnings; no direct state mutation.
  - Must preserve identity mapping per input card using normalized key:
    - `RepairResult` shape:
      - `input_card_key: str`
      - `status: Literal["ok", "invalid_payload", "missing_output"]`
      - `card: CardData | None`
  - `input_card_key` must map exactly to the source weak card so retry budgets and drop reasons remain deterministic.

- `partition_by_gate(cards: list[CardData], *, min_quality: float) -> tuple[list[CardData], list[CardData]]`
  - Pure function used before/after repair attempts.

These boundaries ensure each unit is independently testable:
- gate evaluation tests (pure)
- partitioning/dedupe tests (pure)
- orchestration integration tests (state + events)

## Trade-offs

### Benefits

- Stronger factual grounding consistency in accepted cards.
- Lower chance weak provenance survives to export.
- Better operational visibility into grounding quality.

### Costs

- Increased token usage and runtime due to micro-reflection and retries.
- Slightly more loop complexity in orchestrator logic.

Given user priority, this trade-off is acceptable.

## Feasibility Assessment

Feasibility is high with current codebase:

- Orchestrator already centralizes loop/state transitions.
- Card quality scoring and provenance flags already exist.
- Reflection APIs and prompt schema already carry required provenance fields.
- Required change is primarily control-flow/gating integration, not architectural rewrite.

Estimated implementation risk: low to medium, concentrated in loop correctness and test coverage.

## Rollout Notes

- Introduce gate threshold and retry policy as config-backed defaults.
- Config source and precedence (explicit):
  1. Runtime request/session override (if provided)
  2. Application config module defaults (`lectern/config.py`)
  3. Environment variables only if already wired through existing config loading path
- New config keys are owned in `lectern/config.py` and consumed by orchestrator setup:
  - `GROUNDING_GATE_MIN_QUALITY=60.0`
  - `GROUNDING_RETRY_MAX_ATTEMPTS=2`
  - `GROUNDING_NON_PROGRESS_MAX_BATCHES=2`
- Compare before/after metrics on representative PDFs to validate quality gain.
