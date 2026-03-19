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
2. Score/annotate candidates with existing rubric and provenance flags.
3. Partition candidates:
   - `pass_now`: already meet grounding gate.
   - `needs_repair`: weak provenance (e.g., missing rationale/source excerpt/source pages).
4. Run targeted micro-reflection on `needs_repair` only.
5. Re-score repaired candidates.
6. Promote only cards passing gate into `all_cards` (and `seen_keys`).
7. Retry once (strict prompt mode) for remaining failed candidates, then drop with warning.
8. Update coverage/progress from promoted set.

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
- Quality score at or above configurable threshold

### Micro-Reflection Invocation

- Reuse existing reflection prompt contract/API.
- Operate only on weak cards from current batch.
- Use stricter grounding instruction variant for retry attempt.
- Keep one retry max per failed card to bound cost/runtime.

### Global Reflection (`run_reflection`)

- Keep existing phase and events.
- Position as quality polish + coverage rebalance, not gating.

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
  - Continue with already passing cards in batch.
- If strict retry fails:
  - Drop candidates with explicit warning reasons.
- No broad silent fallback behavior; failures are surfaced in events.

## Eventing and Observability

Add or extend event payloads to include:

- `generated_candidates_count`
- `grounding_repair_attempted_count`
- `grounding_promoted_count`
- `grounding_dropped_count`
- `grounding_drop_reasons` summary

Track run-level outcome metrics:

- Rate of cards with missing provenance flags.
- Average rubric quality.
- Promotion ratio and drop ratio.
- Delta against baseline runs.

## Testing Strategy

Follow “Safety Net Before Surgery”:

1. Add/extend orchestrator tests for:
   - weak cards gated before promotion
   - micro-reflection repair path
   - strict retry then drop path
   - coverage computed from promoted cards only
2. Preserve existing reflection and export behavior tests.
3. Add regression assertions for emitted metric counts in domain/service events.

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
- Keep behavior toggleable initially (feature flag) if needed for conservative rollout.
- Compare before/after metrics on representative PDFs to validate quality gain.
