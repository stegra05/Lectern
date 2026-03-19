# Grounding-First Generation Loop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure generation so cards are promoted only after grounding checks/repair, improving provenance consistency (`source_excerpt`, `rationale`, `source_pages`) without regressing coverage behavior.

**Architecture:** Keep the current phase/orchestrator design and insert a grounding gate inside `run_generation` and re-gating inside `run_reflection`. Use pure helper functions for gate/dedupe/partition decisions and keep AI calls isolated in orchestrator helpers. Extend domain/SSE payloads with optional grounding metrics and canonical non-progress stop reasons.

**Tech Stack:** Python (FastAPI backend/orchestrator), pytest, React/TypeScript (SSE consumer + vitest), Zod schemas

---

## Scope Check

This is one subsystem (generation/reflection orchestration plus event contracts). Do **not** split into separate projects.

Execution discipline: @superpowers:test-driven-development + frequent commits.

Worktree discipline: execute in a dedicated worktree before changing production files.

Baseline requirement before first code change:

- Capture baseline NDJSON output on `main` for at least one representative PDF in Draft Mode, and store it as `files/grounding-baseline.ndjson` (session artifact, not committed).

## File Structure Map

### Core backend loop + policy

- Modify: `lectern/config.py`  
  Add grounding gate defaults (`GROUNDING_GATE_MIN_QUALITY`, `GROUNDING_RETRY_MAX_ATTEMPTS`, `GROUNDING_NON_PROGRESS_MAX_BATCHES`).

- Modify: `lectern/generation_loop.py`  
  Add pure gate/partition helpers and typed repair result model used by orchestrator.

- Modify: `lectern/orchestration/session_orchestrator.py`  
  Implement per-card repair attempts, pre/post dedupe, promotion gating, non-progress reason routing, and reflection re-gating.

### Event contracts

- Modify: `lectern/events/domain.py`  
  Extend `GenerationBatchCompletedEvent` and `GenerationStoppedEvent` payload support.

- Modify: `gui/backend/sse_emitter.py`  
  Include optional grounding counters/details in `GenerationBatchCompletedEvent` and `GenerationStoppedEvent` service data.

### Frontend event boundary

- Modify: `gui/frontend/src/schemas/sse.ts`  
  Add optional schema for generation-stop details and batch-grounding summary payloads.

- Modify: `gui/frontend/src/logic/generation.ts`  
  Read optional warning details for non-progress reasons and show clearer toast copy (no behavior break for old payloads).

### Tests

- Modify: `tests/test_config.py`
- Modify: `tests/test_generation_loop_decoupled.py`
- Create: `tests/test_generation_grounding_gate.py`
- Modify: `gui/frontend/src/tests/generation.test.ts`

### Documentation

- Modify: `docs/AI_PIPELINE.md`  
  Update loop description from “generation then reflection” to “generation + micro grounding repair + reflection polish”.

## Chunk 1: Contracts, Config, and Pure Helpers

### Task 1: Add grounding config defaults

**Files:**
- Modify: `lectern/config.py:240+` (near reflection settings/constants)
- Test: `tests/test_config.py`

- [ ] **Step 1: Write failing config test for new defaults**

```python
def test_grounding_defaults_present() -> None:
    import lectern.config as config_module
    assert config_module.GROUNDING_GATE_MIN_QUALITY == 60.0
    assert config_module.GROUNDING_RETRY_MAX_ATTEMPTS == 2
    assert config_module.GROUNDING_NON_PROGRESS_MAX_BATCHES == 2
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pytest tests/test_config.py::test_grounding_defaults_present -v`  
Expected: FAIL (`AttributeError` or missing constant assertion)

- [ ] **Step 3: Add minimal config constants**

```python
GROUNDING_GATE_MIN_QUALITY: float = float(os.getenv("GROUNDING_GATE_MIN_QUALITY", "60.0"))
GROUNDING_RETRY_MAX_ATTEMPTS: int = int(os.getenv("GROUNDING_RETRY_MAX_ATTEMPTS", "2"))
GROUNDING_NON_PROGRESS_MAX_BATCHES: int = int(os.getenv("GROUNDING_NON_PROGRESS_MAX_BATCHES", "2"))
```

- [ ] **Step 4: Add precedence wiring test (session override > config default)**

```python
def test_generation_setup_uses_session_override_for_grounding_threshold():
    context = _context()
    context.config.grounding_min_quality = 75.0  # new optional session-level override
    orchestrator = SessionOrchestrator()
    setup = orchestrator.prepare_generation(
        GenerationSetupConfig(
            pages=[{"number": 1}],
            concept_map={"concepts": [], "relations": []},
            examples="",
            estimated_text_chars=500,
            image_count=0,
        )
    )
    gen_config = GenerationConfig(
        total_cards_cap=5,
        actual_batch_size=1,
        focus_prompt=None,
        effective_target=setup.effective_target,
        stop_check=None,
        examples="",
        grounding_min_quality=context.config.grounding_min_quality,
    )
    assert gen_config.grounding_min_quality == 75.0
    assert gen_config.grounding_min_quality != config.GROUNDING_GATE_MIN_QUALITY
```

- [ ] **Step 5: Re-run targeted config/wiring tests**

Run: `pytest tests/test_config.py -k "grounding_defaults_present or grounding_threshold" -v`  
Expected: PASS for defaults + override precedence wiring.

- [ ] **Step 6: Commit**

```bash
git add lectern/config.py lectern/orchestration/session_orchestrator.py tests/test_config.py tests/test_generation_phase.py
git commit -m "feat: add grounding config defaults and override wiring"
```

### Task 2: Extend domain/SSE event contracts for grounding stats

**Files:**
- Modify: `lectern/events/domain.py:126-145`
- Modify: `gui/backend/sse_emitter.py:119-136`
- Test: `tests/test_generation_loop_decoupled.py`

- [ ] **Step 1: Write failing SSE/domain contract tests for new payload fields**

```python
def test_generation_batch_completed_event_transforms_grounding_fields():
    event = GenerationBatchCompletedEvent(
        batch_index=2,
        cards_added=3,
        model_done=False,
        generated_candidates_count=7,
        grounding_repair_attempted_count=4,
        grounding_promoted_count=3,
        grounding_dropped_count=4,
        grounding_drop_reasons={"missing_source_excerpt": 2, "missing_rationale": 1},
    )
    service_event = SSEEmitter.domain_to_service_event(event)
    assert service_event.data["generated_candidates_count"] == 7
    assert service_event.data["grounding_repair_attempted_count"] == 4
    assert service_event.data["grounding_promoted_count"] == 3
    assert service_event.data["grounding_dropped_count"] == 4
    assert service_event.data["grounding_drop_reasons"]["missing_source_excerpt"] == 2

def test_generation_stopped_event_transforms_details_payload():
    event = GenerationStoppedEvent(
        reason="grounding_non_progress_gate_failures",
        details={"last_batch_gate_failure_drop_count": 5},
    )
    service_event = SSEEmitter.domain_to_service_event(event)
    assert "grounding_non_progress_gate_failures" in service_event.message
    assert service_event.data["reason"] == "grounding_non_progress_gate_failures"
    assert service_event.data["last_batch_gate_failure_drop_count"] == 5
```

- [ ] **Step 2: Run targeted tests (including SSE transform tests)**

Run: `pytest tests/test_generation_loop_decoupled.py -k "generation_batch_completed_event_transforms_grounding_fields or generation_stopped_event_transforms_details_payload" -v`  
Expected: FAIL on missing payload keys/details passthrough.

- [ ] **Step 3: Add optional fields to domain events**

```python
@dataclass(frozen=True)
class GenerationBatchCompletedEvent(DomainEvent):
    cards_added: int = 0
    model_done: bool = False
    generated_candidates_count: int = 0
    grounding_repair_attempted_count: int = 0
    grounding_promoted_count: int = 0
    grounding_dropped_count: int = 0
    grounding_drop_reasons: Dict[str, int] = field(default_factory=dict)

GroundingStopReason = Literal[
    "grounding_non_progress_duplicates",
    "grounding_non_progress_gate_failures",
]

class GenerationStopDetails(TypedDict, total=False):
    consecutive_zero_promoted_batches: int
    last_batch_generated_candidates_count: int
    last_batch_grounding_promoted_count: int
    last_batch_grounding_dropped_count: int
    last_batch_duplicate_drop_count: int
    last_batch_gate_failure_drop_count: int

@dataclass(frozen=True)
class GenerationStoppedEvent(DomainEvent):
    reason: str = ""  # existing reasons plus grounding non-progress variants
    details: GenerationStopDetails = field(default_factory=dict)
```

- [ ] **Step 4: Map new optional fields in SSE emitter**

```python
elif isinstance(event, GenerationBatchCompletedEvent):
    return ServiceEvent(
        type="info",
        message=f"Batch {event.batch_index} summary: +{event.cards_added} cards",
        data={
            "batch": event.batch_index,
            "added": event.cards_added,
            "model_done": event.model_done,
            "generated_candidates_count": event.generated_candidates_count,
            "grounding_repair_attempted_count": event.grounding_repair_attempted_count,
            "grounding_promoted_count": event.grounding_promoted_count,
            "grounding_dropped_count": event.grounding_dropped_count,
            "grounding_drop_reasons": event.grounding_drop_reasons,
        },
    )

elif isinstance(event, GenerationStoppedEvent):
    return ServiceEvent(
        type=(
            "warning"
            if event.reason in {
                "user_cancel",
                "grounding_non_progress_duplicates",
                "grounding_non_progress_gate_failures",
            }
            else "info"
        ),
        message=f"Generation stopped: {event.reason}",
        data={"reason": event.reason, **event.details},
    )
```

- [ ] **Step 5: Re-run targeted tests**

Run: `pytest tests/test_generation_loop_decoupled.py -k "generation_batch_completed_event_transforms_grounding_fields or generation_stopped_event_transforms_details_payload" -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lectern/events/domain.py gui/backend/sse_emitter.py tests/test_generation_loop_decoupled.py
git commit -m "feat: extend generation event payloads for grounding metrics"
```

### Task 2b: Frontend lockstep for event contract (same chunk, no deferred dependency)

**Files:**
- Modify: `gui/frontend/src/schemas/sse.ts`
- Modify: `gui/frontend/src/logic/generation.ts`
- Modify: `gui/frontend/src/tests/generation.test.ts`

- [ ] **Step 1: Add failing test for parsing generation stop details**

```ts
it('parses generation stop details with grounding counters', () => {
  const parsed = validateGenerationStoppedDetails({
    consecutive_zero_promoted_batches: 2,
    last_batch_generated_candidates_count: 8,
    last_batch_grounding_promoted_count: 0,
    last_batch_grounding_dropped_count: 8,
    last_batch_duplicate_drop_count: 2,
    last_batch_gate_failure_drop_count: 5,
  });
  expect(parsed?.consecutive_zero_promoted_batches).toBe(2);
  expect(parsed?.last_batch_generated_candidates_count).toBe(8);
  expect(parsed?.last_batch_grounding_promoted_count).toBe(0);
  expect(parsed?.last_batch_grounding_dropped_count).toBe(8);
  expect(parsed?.last_batch_gate_failure_drop_count).toBe(5);
});
```

- [ ] **Step 2: Run targeted test to confirm failure**

Run: `cd gui/frontend && npm test -- --run src/tests/generation.test.ts -t "generation stop details"`  
Expected: FAIL (helper/schema missing).

- [ ] **Step 3: Add schema + parser helper in `sse.ts`**

```ts
export type GenerationStoppedDetails = z.infer<typeof GenerationStoppedDetailsSchema>;

export const GenerationStoppedDetailsSchema = z.object({
  consecutive_zero_promoted_batches: z.number().optional(),
  last_batch_generated_candidates_count: z.number().optional(),
  last_batch_grounding_promoted_count: z.number().optional(),
  last_batch_grounding_dropped_count: z.number().optional(),
  last_batch_duplicate_drop_count: z.number().optional(),
  last_batch_gate_failure_drop_count: z.number().optional(),
}).passthrough();

export function validateGenerationStoppedDetails(data: unknown): GenerationStoppedDetails | null {
  const result = GenerationStoppedDetailsSchema.safeParse(data);
  if (!result.success) return null;
  return result.data;
}
```

- [ ] **Step 4: Consume optional details in `generation.ts` warnings**

```ts
if (event.type === 'warning') {
  const rawData = (event.data as Record<string, unknown> | undefined) ?? {};
  const reason = typeof rawData.reason === "string" ? rawData.reason : null;
  const details = validateGenerationStoppedDetails(rawData);
  if (reason === "grounding_non_progress_duplicates") {
    const drops = details?.last_batch_duplicate_drop_count ?? 0;
    useLecternStore.getState().addToast(
      "warning",
      `Generation stopped: duplicate saturation detected (${drops} duplicate drops in last batch).`,
      8000
    );
    return;
  }
  if (reason === "grounding_non_progress_gate_failures") {
    const drops = details?.last_batch_gate_failure_drop_count ?? 0;
    useLecternStore.getState().addToast(
      "warning",
      `Generation stopped: grounding gate failures dominated (${drops} gate failures in last batch).`,
      8000
    );
    return;
  }
}
```

- [ ] **Step 5: Re-run targeted frontend tests**

Run: `cd gui/frontend && npm test -- --run src/tests/generation.test.ts -t "generation stop details|grounding_non_progress"`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gui/frontend/src/schemas/sse.ts gui/frontend/src/logic/generation.ts gui/frontend/src/tests/generation.test.ts
git commit -m "feat: update frontend SSE contract for grounding stop details"
```

### Task 3: Add pure grounding gate helpers

**Files:**
- Modify: `lectern/generation_loop.py`
- Create: `tests/test_generation_grounding_gate.py`

- [ ] **Step 1: Write failing tests for gate, partition, and typed repair result**

```python
def test_evaluate_grounding_gate_requires_provenance_flags_clear():
    card = {"quality_score": 90.0, "quality_flags": ["missing_source_excerpt"]}
    ok, reasons = evaluate_grounding_gate(card, min_quality=60.0)
    assert ok is False
    assert "missing_source_excerpt" in reasons

def test_partition_by_gate_splits_promotable_and_repair_sets():
    cards = [
        {"quality_score": 90.0, "quality_flags": []},
        {"quality_score": 50.0, "quality_flags": []},
    ]
    promotable, needs_repair = partition_by_gate(cards, min_quality=60.0)
    assert len(promotable) == 1
    assert len(needs_repair) == 1

def test_repair_result_identity_shape_is_enforced():
    result = RepairResult(input_card_key="k1", status="ok", card={"front": "Q"})
    assert result.input_card_key == "k1"
    assert result.status == "ok"
    assert isinstance(result.card, dict)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_generation_grounding_gate.py -v`  
Expected: FAIL (`ImportError` / undefined symbols)

- [ ] **Step 3: Implement minimal pure helpers**

```python
@dataclass(frozen=True)
class RepairResult:
    input_card_key: str
    status: Literal["ok", "invalid_payload", "missing_output"]
    card: CardData | None = None

def evaluate_grounding_gate(card: CardData, *, min_quality: float) -> tuple[bool, list[str]]:
    flags = set(card.get("quality_flags") or [])
    reasons: list[str] = []
    for key in ("missing_source_excerpt", "missing_rationale", "missing_source_pages"):
        if key in flags:
            reasons.append(key)
    if float(card.get("quality_score") or 0.0) < min_quality:
        reasons.append("below_quality_threshold")
    return (len(reasons) == 0), reasons

def partition_by_gate(cards: list[CardData], *, min_quality: float) -> tuple[list[CardData], list[CardData]]:
    promotable: list[CardData] = []
    needs_repair: list[CardData] = []
    for card in cards:
        ok, _ = evaluate_grounding_gate(card, min_quality=min_quality)
        if ok:
            promotable.append(card)
        else:
            needs_repair.append(card)
    return promotable, needs_repair
```

- [ ] **Step 4: Re-run helper tests**

Run: `pytest tests/test_generation_grounding_gate.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lectern/generation_loop.py tests/test_generation_grounding_gate.py
git commit -m "feat: add pure grounding gate and repair result helpers"
```

## Chunk 2: Orchestrator Integration, Frontend Boundary, and Verification

### Task 4: Integrate grounding-first promotion in `run_generation`

**Files:**
- Modify: `lectern/orchestration/session_orchestrator.py:338-510`
- Modify: `tests/test_generation_loop_decoupled.py`

- [ ] **Step 1: Add failing orchestrator tests for promotion gating and retry flow**

```python
async def test_generation_drops_cards_after_two_failed_repairs():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(return_value={"cards": [{"front": "Q", "back": "A"}], "done": False})
    ai.reflect_cards = AsyncMock(
        side_effect=[
            {"cards": [{"front": "Q", "back": "A", "quality_flags": ["missing_source_excerpt"]}], "done": False},
            {"cards": [{"front": "Q", "back": "A", "quality_flags": ["missing_source_excerpt"]}], "done": False},
        ]
    )
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": i} for i in range(1, 4)]
    orchestrator.state.concept_map = {}
    config = GenerationConfig(total_cards_cap=1, actual_batch_size=1, focus_prompt=None, effective_target=1.0, stop_check=None, examples="")
    events = [e async for e in orchestrator.run_generation(ai_client=ai, config=config)]
    assert len([e for e in events if isinstance(e, CardGeneratedEvent)]) == 0
    warning_msgs = [e.message for e in events if isinstance(e, WarningEmittedEvent)]
    assert any("repair_call_failed" in msg or "missing_source_excerpt" in msg for msg in warning_msgs)

async def test_generation_promotes_only_gate_pass_cards():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(
        return_value={
            "cards": [
                {"front": "Grounded", "back": "A", "quality_score": 90.0, "quality_flags": []},
                {"front": "Weak", "back": "B", "quality_score": 40.0, "quality_flags": ["missing_source_excerpt"]},
            ],
            "done": False,
        }
    )
    ai.reflect_cards = AsyncMock(return_value={"cards": [], "done": False})
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}]
    orchestrator.state.concept_map = {}
    config = GenerationConfig(total_cards_cap=2, actual_batch_size=2, focus_prompt=None, effective_target=1.0, stop_check=None, examples="")
    events = [e async for e in orchestrator.run_generation(ai_client=ai, config=config)]
    cards = [e.card for e in events if isinstance(e, CardGeneratedEvent)]
    assert len(cards) == 1
    assert cards[0].get("front") == "Grounded"

async def test_generation_stops_with_grounding_non_progress_reason():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(return_value={"cards": [{"front": "Weak", "back": "A"}], "done": False})
    ai.reflect_cards = AsyncMock(return_value={"cards": [{"front": "Weak", "back": "A", "quality_flags": ["missing_source_excerpt"]}], "done": False})
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}]
    orchestrator.state.concept_map = {}
    config = GenerationConfig(total_cards_cap=4, actual_batch_size=1, focus_prompt=None, effective_target=1.0, stop_check=None, examples="")
    events = [e async for e in orchestrator.run_generation(ai_client=ai, config=config)]
    stop = next(e for e in events if isinstance(e, GenerationStoppedEvent))
    assert stop.reason in {"grounding_non_progress_duplicates", "grounding_non_progress_gate_failures"}
    assert isinstance(stop.details, dict)
    assert "consecutive_zero_promoted_batches" in stop.details

async def test_generation_non_progress_reason_prefers_duplicates_when_dominant():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(
        side_effect=[
            {"cards": [{"front": "Dup", "back": "A"}], "done": False},
            {"cards": [{"front": "Dup", "back": "A"}], "done": False},
        ]
    )
    ai.reflect_cards = AsyncMock(return_value={"cards": [], "done": False})
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}]
    orchestrator.state.concept_map = {}
    config = GenerationConfig(total_cards_cap=3, actual_batch_size=1, focus_prompt=None, effective_target=1.0, stop_check=None, examples="")
    events = [e async for e in orchestrator.run_generation(ai_client=ai, config=config)]
    stop = next(e for e in events if isinstance(e, GenerationStoppedEvent))
    assert stop.reason == "grounding_non_progress_duplicates"
    assert stop.details["last_batch_duplicate_drop_count"] > stop.details["last_batch_gate_failure_drop_count"]

async def test_generation_non_progress_reason_prefers_gate_failures_on_tie():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(return_value={"cards": [{"front": "Weak", "back": "A"}], "done": False})
    ai.reflect_cards = AsyncMock(
        return_value={"cards": [{"front": "Weak", "back": "A", "quality_flags": ["missing_source_excerpt"]}], "done": False}
    )
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}]
    orchestrator.state.concept_map = {}
    config = GenerationConfig(total_cards_cap=3, actual_batch_size=1, focus_prompt=None, effective_target=1.0, stop_check=None, examples="")
    events = [e async for e in orchestrator.run_generation(ai_client=ai, config=config)]
    stop = next(e for e in events if isinstance(e, GenerationStoppedEvent))
    assert stop.reason == "grounding_non_progress_gate_failures"

async def test_generation_coverage_updates_only_from_promoted_cards():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(
        return_value={
            "cards": [
                {"front": "Good", "back": "A", "quality_score": 90.0, "quality_flags": []},
                {"front": "Bad", "back": "B", "quality_score": 20.0, "quality_flags": ["missing_source_excerpt"]},
            ],
            "done": False,
        }
    )
    ai.reflect_cards = AsyncMock(return_value={"cards": [], "done": False})
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}, {"number": 2}]
    orchestrator.state.concept_map = {}
    config = GenerationConfig(total_cards_cap=2, actual_batch_size=2, focus_prompt=None, effective_target=1.0, stop_check=None, examples="")
    events = [e async for e in orchestrator.run_generation(ai_client=ai, config=config)]
    coverage_event = next(e for e in events if isinstance(e, CoverageUpdatedEvent))
    assert coverage_event.cards_count == 1

async def test_generation_handles_gate_exception_without_crashing_loop():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(return_value={"cards": [{"front": "Q", "back": "A"}], "done": True})
    ai.reflect_cards = AsyncMock(return_value={"cards": [], "done": True})
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}]
    orchestrator.state.concept_map = {}
    with patch("lectern.orchestration.session_orchestrator.evaluate_grounding_gate", side_effect=RuntimeError("boom")):
        events = [e async for e in orchestrator.run_generation(ai_client=ai, config=GenerationConfig(total_cards_cap=1, actual_batch_size=1, focus_prompt=None, effective_target=1.0, stop_check=None, examples=""))]
    assert any(isinstance(e, WarningEmittedEvent) and "grounding_gate_error" in e.message for e in events)

async def test_generation_handles_invalid_repaired_payload_with_retry_budget():
    ai = MagicMock()
    ai.generate_cards = AsyncMock(return_value={"cards": [{"front": "Weak", "back": "A"}], "done": False})
    ai.reflect_cards = AsyncMock(side_effect=[{"cards": [{}], "done": False}, {"cards": [{}], "done": False}])
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}]
    orchestrator.state.concept_map = {}
    events = [e async for e in orchestrator.run_generation(ai_client=ai, config=GenerationConfig(total_cards_cap=1, actual_batch_size=1, focus_prompt=None, effective_target=1.0, stop_check=None, examples=""))]
    assert any(isinstance(e, WarningEmittedEvent) and "invalid_repaired_payload" in e.message for e in events)
    assert not any(isinstance(e, CardGeneratedEvent) for e in events)
```

- [ ] **Step 2: Run these tests and confirm failures**

Run: `pytest tests/test_generation_loop_decoupled.py -k "promotes_only_gate_pass or failed_repairs or grounding_non_progress or tie or coverage_updates_only_from_promoted_cards or gate_exception or invalid_repaired_payload" -v`  
Expected: FAIL (old behavior appends cards directly)

- [ ] **Step 3: Implement per-card pipeline in `run_generation`**

```python
# per batch
# 1) dedupe candidates
# 2) annotate quality
# 3) partition pass_now / needs_repair
# 4) repair attempt1 (standard), re-gate
# 5) repair attempt2 (strict), re-gate
# 6) promote only pass cards -> _add_card + _inject_uuid + CardGeneratedEvent
# 7) emit dropped warnings with reason details
# 8) emit GenerationBatchCompletedEvent with grounding counts
```

- [ ] **Step 4: Implement non-progress dominance reason selection**

```python
if zero_promoted_batches >= config.GROUNDING_NON_PROGRESS_MAX_BATCHES:
    details = {
        "consecutive_zero_promoted_batches": zero_promoted_batches,
        "last_batch_generated_candidates_count": generated_candidates_count,
        "last_batch_grounding_promoted_count": grounding_promoted_count,
        "last_batch_grounding_dropped_count": grounding_dropped_count,
        "last_batch_duplicate_drop_count": duplicate_drop_count,
        "last_batch_gate_failure_drop_count": gate_failure_drop_count,
    }
    reason = (
        "grounding_non_progress_duplicates"
        if duplicate_drop_count > gate_failure_drop_count
        else "grounding_non_progress_gate_failures"
    )
    yield GenerationStoppedEvent(reason=reason, details=details)
    break
```

- [ ] **Step 5: Re-run targeted orchestrator tests**

Run: `pytest tests/test_generation_loop_decoupled.py -k "promotes_only_gate_pass or failed_repairs or grounding_non_progress or tie or coverage_updates_only_from_promoted_cards or gate_exception or invalid_repaired_payload" -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lectern/orchestration/session_orchestrator.py tests/test_generation_loop_decoupled.py
git commit -m "feat: gate generation promotion with grounding repair retries"
```

### Task 5: Re-gate reflection replacements before accepting them

**Files:**
- Modify: `lectern/orchestration/session_orchestrator.py:514-648`
- Modify: `tests/test_generation_loop_decoupled.py`

- [ ] **Step 1: Write failing reflection test for no grounding regression**

```python
async def test_reflection_keeps_original_when_replacement_fails_gate():
    ai = MagicMock()
    ai.reflect_cards = AsyncMock(
        return_value={
            "cards": [{"front": "Replacement", "back": "A", "quality_flags": ["missing_source_excerpt"]}],
            "reflection": "attempted replacement",
            "done": True,
        }
    )
    ai.drain_warnings.return_value = []
    orchestrator = SessionOrchestrator()
    orchestrator.state.pages = [{"number": 1}]
    orchestrator.state.concept_map = {}
    original = {"front": "Original", "back": "A", "quality_score": 90.0, "quality_flags": []}
    orchestrator.state.all_cards = [original]
    events = [e async for e in orchestrator.run_reflection(ai_client=ai, config=ReflectionConfig(total_cards_cap=2, rounds=1, stop_check=None))]
    replaced = next(e for e in events if isinstance(e, CardsReplacedEvent))
    assert replaced.cards[0].get("front") == "Original"
    assert "missing_source_excerpt" not in set(replaced.cards[0].get("quality_flags") or [])
```

- [ ] **Step 2: Run targeted reflection test**

Run: `pytest tests/test_generation_loop_decoupled.py -k "reflection_keeps_original_when_replacement_fails_gate" -v`  
Expected: FAIL

- [ ] **Step 3: Implement reflection replacement re-gate**

```python
# after selecting reflected cards
# evaluate each replacement with:
# ok, reasons = evaluate_grounding_gate(replacement, min_quality=config.grounding_min_quality)
# if replacement fails -> keep original card at same index
# rebuild seen_keys from final accepted cards
```

- [ ] **Step 4: Re-run reflection tests**

Run: `pytest tests/test_generation_loop_decoupled.py -k "reflection" -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lectern/orchestration/session_orchestrator.py tests/test_generation_loop_decoupled.py
git commit -m "fix: prevent reflection from regressing grounding quality"
```

### Task 6: Frontend event schema/logic updates for new optional details

**Files:**
- Modify: `gui/frontend/src/schemas/sse.ts`
- Modify: `gui/frontend/src/logic/generation.ts`
- Modify: `gui/frontend/src/tests/generation.test.ts`

- [ ] **Step 1: Add failing frontend tests for warning detail handling**

```ts
it('shows duplicate-saturation toast for grounding_non_progress_duplicates', () => {
  const addToast = vi.fn();
  vi.mocked(useLecternStore.getState).mockReturnValue({ addToast } as any);
  processGenerationEvent(
    {
      type: "warning",
      message: "Generation stopped: grounding_non_progress_duplicates",
      data: { reason: "grounding_non_progress_duplicates", last_batch_duplicate_drop_count: 3 },
      timestamp: Date.now(),
    },
    vi.fn()
  );
  expect(addToast).toHaveBeenCalledWith(
    "warning",
    expect.stringContaining("duplicate saturation"),
    8000
  );
});

it('shows gate-failure toast for grounding_non_progress_gate_failures', () => {
  const addToast = vi.fn();
  vi.mocked(useLecternStore.getState).mockReturnValue({ addToast } as any);
  processGenerationEvent(
    {
      type: "warning",
      message: "Generation stopped: grounding_non_progress_gate_failures",
      data: { reason: "grounding_non_progress_gate_failures", last_batch_gate_failure_drop_count: 5 },
      timestamp: Date.now(),
    },
    vi.fn()
  );
  expect(addToast).toHaveBeenCalledWith(
    "warning",
    expect.stringContaining("grounding gate failures"),
    8000
  );
});
```

- [ ] **Step 2: Run targeted frontend test**

Run: `cd gui/frontend && npm test -- --run src/tests/generation.test.ts -t "grounding_non_progress"`  
Expected: FAIL

- [ ] **Step 3: Reuse parser helper from Task 2b and keep schema in sync**

```ts
// In generation.ts import and use:
// validateGenerationStoppedDetails from "../schemas/sse"
// Do not redefine local schema to avoid contract drift.
```

- [ ] **Step 4: Use parsed warning details in generation handler**

```ts
if (event.type === 'warning') {
  const data = (event.data as Record<string, unknown> | undefined) ?? {};
  const reason = typeof data.reason === "string" ? data.reason : "";
  const details = validateGenerationStoppedDetails(data);
  if (reason === "grounding_non_progress_duplicates") {
    const drops = details?.last_batch_duplicate_drop_count ?? 0;
    addToast("warning", `Generation stopped: duplicate saturation (${drops} duplicate drops).`, 8000);
    return;
  }
  if (reason === "grounding_non_progress_gate_failures") {
    const drops = details?.last_batch_gate_failure_drop_count ?? 0;
    addToast("warning", `Generation stopped: grounding gate failures (${drops} failures).`, 8000);
    return;
  }
}
```

- [ ] **Step 5: Re-run targeted frontend tests**

Run: `cd gui/frontend && npm test -- --run src/tests/generation.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gui/frontend/src/schemas/sse.ts gui/frontend/src/logic/generation.ts gui/frontend/src/tests/generation.test.ts
git commit -m "feat: handle grounding non-progress warning details in frontend"
```

### Task 7: Update AI pipeline docs

**Files:**
- Modify: `docs/AI_PIPELINE.md`

- [ ] **Step 1: Update loop description to match implementation**

```md
### 2. Batched Generation + Grounding Gate
- Generate candidates
- Run targeted grounding repair for weak provenance cards
- Promote only grounded cards
```

- [ ] **Step 2: Sanity-check doc consistency**

Run: `rg "Reflection Pass|Batched Generation" docs/AI_PIPELINE.md -n`  
Expected: shows updated section headers/text only once.

- [ ] **Step 3: Commit**

```bash
git add docs/AI_PIPELINE.md
git commit -m "docs: describe grounding-first generation loop"
```

### Task 8: Full verification and integration commit

**Files:**
- Verify: backend and frontend test suites relevant to changed areas

- [ ] **Step 1: Run backend targeted suite**

Run:
`pytest tests/test_generation_grounding_gate.py tests/test_generation_loop_decoupled.py tests/test_generation_phase.py tests/test_pipeline_phases.py tests/test_config.py -v`

Expected: PASS

- [ ] **Step 2: Run explicit edge-case reruns for non-progress classification**

Run:
`pytest tests/test_generation_loop_decoupled.py -k "non_progress_reason_prefers_duplicates_when_dominant or non_progress_reason_prefers_gate_failures_on_tie" -v`

Expected: PASS and tie case resolves to `grounding_non_progress_gate_failures`.

- [ ] **Step 3: Run backend full suite**

Run: `pytest tests/ -v`  
Expected: PASS (no regressions).

- [ ] **Step 4: Run frontend targeted + lint/tests**

Run:
`cd gui/frontend && npm run lint && npm test -- --run`

Expected: lint clean, tests PASS.

- [ ] **Step 5: Verify git diff scope**

Run: `BASE="$(git merge-base HEAD origin/main)" && git --no-pager status && git --no-pager diff --name-only "$BASE"..HEAD`  
Expected: changed files are limited to planned files in this document; no unrelated paths.

- [ ] **Step 6: Run representative grounding-metric before/after check**

Run the same representative PDF through Draft Mode on the candidate branch and save NDJSON:
`curl -sN -F "pdf_file=@/absolute/path/to/representative.pdf" -F "deck_name=GroundingEval" -F "skip_export=true" http://127.0.0.1:4173/generate > files/grounding-candidate.ndjson`

Then compare baseline vs candidate with inline Python:

```bash
python - <<'PY'
import json
from pathlib import Path

def read_ndjson(path: str):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]

def extract_cards_and_rubric(path: str):
    events = read_ndjson(path)
    done = next((e for e in reversed(events) if e.get("type") == "done"), {})
    done_data = done.get("data") or {}
    cards = done_data.get("cards") or []
    if not cards:
        cards = [
            (e.get("data") or {}).get("card")
            for e in events
            if e.get("type") == "card"
        ]
        cards = [c for c in cards if isinstance(c, dict)]
    rubric = done_data.get("rubric_summary") or {}
    return cards, rubric

def missing_rate(cards, flag: str) -> float:
    if not cards:
        return 0.0
    misses = sum(1 for c in cards if flag in (c.get("quality_flags") or []))
    return misses / len(cards)

base_cards, base_rub = extract_cards_and_rubric("files/grounding-baseline.ndjson")
cand_cards, cand_rub = extract_cards_and_rubric("files/grounding-candidate.ndjson")

base_excerpt = missing_rate(base_cards, "missing_source_excerpt")
cand_excerpt = missing_rate(cand_cards, "missing_source_excerpt")
base_rationale = missing_rate(base_cards, "missing_rationale")
cand_rationale = missing_rate(cand_cards, "missing_rationale")
base_avg = float(base_rub.get("avg_quality") or 0.0)
cand_avg = float(cand_rub.get("avg_quality") or 0.0)

print(json.dumps({
    "baseline": {
        "cards": len(base_cards),
        "missing_source_excerpt_rate": round(base_excerpt, 4),
        "missing_rationale_rate": round(base_rationale, 4),
        "avg_quality": round(base_avg, 2),
    },
    "candidate": {
        "cards": len(cand_cards),
        "missing_source_excerpt_rate": round(cand_excerpt, 4),
        "missing_rationale_rate": round(cand_rationale, 4),
        "avg_quality": round(cand_avg, 2),
    },
}, indent=2))

assert cand_excerpt <= base_excerpt, "missing_source_excerpt rate regressed"
assert cand_rationale <= base_rationale, "missing_rationale rate regressed"
assert cand_avg >= base_avg - 0.1, "avg rubric quality regressed"
print("Grounding metric comparison passed.")
PY
```

Expected:
- lower `missing_source_excerpt` rate
- lower `missing_rationale` rate
- non-regressing average rubric quality

- [ ] **Step 7: Final commit (if work not already committed per task)**

```bash
git add lectern/ gui/backend/ gui/frontend/ docs/ tests/
git commit -m "feat: enforce grounding-first generation loop with repair gating"
```
