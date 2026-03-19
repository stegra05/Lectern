# Generation Architecture Modular Monolith V2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned `/generate-v2` architecture with strict Interface/Application/Domain/Infrastructure boundaries and replay-safe event streaming.

**Architecture:** Introduce new V2 modules in parallel with the current generation path, then route all V2 transport concerns through a single event translator. Keep existing generation behavior by wrapping current orchestration behind application ports while enforcing domain-first contracts and idempotent replay semantics.

**Tech Stack:** Python (FastAPI, dataclasses, Protocols, pytest), React/TypeScript (Zod, Vitest), NDJSON streaming

---

## Spec Reference

- `docs/superpowers/specs/2026-03-19-generation-architecture-modular-monolith-v2-design.md`

## Scope Check

This is one subsystem (generation runtime architecture + stream contract + frontend consumer migration). Do **not** split into separate sub-project specs.

Execution discipline:
- `@superpowers:test-driven-development`
- `@superpowers:verification-before-completion`
- `@superpowers:subagent-driven-development`

## File Structure Map

### Domain (new canonical business contracts)

- Create: `lectern/domain/generation/events.py`  
  V2 domain event dataclasses + event enums + sequence invariants.

- Create: `lectern/domain/generation/state.py`  
  `EngineState`, lifecycle states (`idle/running/stopped/error/completed/cancelled`), and transition guards.

- Create: `lectern/domain/generation/engine.py`  
  `GenerationEngine` protocol and minimal implementation shell wrapping existing loops safely.

- Create: `lectern/domain/generation/types.py`  
  Typed payloads (`ConceptMapResult`, `DomainEventRecord`, summaries).

### Application (use-case orchestration)

- Create: `lectern/application/dto.py`  
  `StartGenerationRequest`, `ResumeGenerationRequest`, `ReplayStreamRequest`, `CancelGenerationRequest`, `ApiEventV2`.

- Create: `lectern/application/errors.py`  
  Canonical error codes and typed exceptions.

- Create: `lectern/application/ports.py`  
  `PdfExtractorPort`, `AIProviderPort`, `HistoryRepositoryPort`, `RuntimeSessionStorePort`, `AnkiGatewayPort`.

- Create: `lectern/application/translators/event_translator.py`  
  DomainEvent -> ApiEventV2 deterministic mapping.

- Create: `lectern/application/generation_app_service.py`  
  Main orchestration (`run_generation_stream`, `run_resume_stream`, `replay_stream`, `cancel`) with ordering/idempotency rules.

### Infrastructure (adapters)

- Create: `lectern/infrastructure/extractors/pdf_extractor.py`
- Create: `lectern/infrastructure/providers/gemini_adapter.py`
- Create: `lectern/infrastructure/persistence/history_repository_sqlite.py`
- Create: `lectern/infrastructure/runtime/session_runtime_store.py`
- Create: `lectern/infrastructure/gateways/anki_gateway.py`

All adapters implement application ports and wrap existing code in `lectern/*` and `lectern/utils/*`.

### Interface (FastAPI v2 transport)

- Create: `gui/backend/interface_v2/serializers/events_v2.py`  
  NDJSON serializer for `ApiEventV2`.

- Create: `gui/backend/interface_v2/routers/generation_v2.py`  
  `/generate-v2`, `/replay-v2`, `/cancel-v2`.

- Modify: `gui/backend/dependencies.py`  
  Wire V2 app service + adapter factories.

- Modify: `gui/backend/main.py`  
  Mount V2 router.

### Frontend (v2 event consumer)

- Modify: `gui/frontend/src/api.ts`  
  Add V2 request/stream methods + versioned event types.

- Create: `gui/frontend/src/schemas/sse-v2.ts`  
  Zod schema for `ApiEventV2`.

- Modify: `gui/frontend/src/logic/generation.ts`  
  Add V2 event handling branch and replay cursor handling.

- Modify: `gui/frontend/src/tests/generation.test.ts`  
  Add V2 parser/handler tests including cursor replay edge cases.

### Tests (new)

- Create: `tests/domain/test_generation_events_v2.py`
- Create: `tests/domain/test_generation_state_v2.py`
- Create: `tests/application/test_event_translator_v2.py`
- Create: `tests/application/test_generation_app_service_v2.py`
- Create: `tests/interface/test_generation_v2_router.py`

---

## Chunk 1: Domain + Application Contracts

### Task 1: Add canonical DTOs and error taxonomy

**Files:**
- Create: `lectern/application/dto.py`
- Create: `lectern/application/errors.py`
- Test: `tests/application/test_generation_dto_v2.py`

- [ ] **Step 1: Write failing DTO/error tests**

```python
def test_start_generation_request_defaults_stream_version():
    req = StartGenerationRequest(
        pdf_path="/tmp/a.pdf",
        deck_name="Deck",
        model_name="gemini-3-flash",
        tags=[],
    )
    assert req.stream_version == 2

def test_error_code_enum_contains_spec_values():
    assert GenerationErrorCode.RESUME_CONFLICT_ALREADY_RUNNING.value == "resume_conflict_already_running"
    assert GenerationErrorCode.HISTORY_CORRUPT_SEQUENCE.value == "history_corrupt_sequence"
```

- [ ] **Step 2: Run targeted tests to confirm RED**

Run: `pytest tests/application/test_generation_dto_v2.py -v`  
Expected: FAIL (module/file missing)

- [ ] **Step 3: Implement DTOs and error enums minimally**

```python
@dataclass(frozen=True)
class StartGenerationRequest:
    pdf_path: str
    deck_name: str
    model_name: str
    tags: list[str]
    focus_prompt: str | None = None
    target_card_count: int | None = None
    stream_version: int = 2
```

- [ ] **Step 4: Re-run targeted tests to confirm GREEN**

Run: `pytest tests/application/test_generation_dto_v2.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lectern/application/dto.py lectern/application/errors.py tests/application/test_generation_dto_v2.py
git commit -m "feat: add generation v2 DTOs and error taxonomy"
```

### Task 2: Define application port protocols

**Files:**
- Create: `lectern/application/ports.py`
- Test: `tests/application/test_ports_v2.py`

- [ ] **Step 1: Write failing protocol contract tests**

```python
def test_history_repository_port_exposes_replay_method():
    assert "get_events_after" in HistoryRepositoryPort.__dict__
```

- [ ] **Step 2: Run test to verify RED**

Run: `pytest tests/application/test_ports_v2.py -v`  
Expected: FAIL (missing protocol)

- [ ] **Step 3: Add protocol interfaces from spec**

```python
class HistoryRepositoryPort(Protocol):
    async def append_events(self, session_id: str, events: list[DomainEventRecord]) -> None: ...
    async def get_events_after(self, session_id: str, *, after_sequence_no: int, limit: int = 1000) -> list[DomainEventRecord]: ...
```

- [ ] **Step 4: Re-run targeted test for GREEN**

Run: `pytest tests/application/test_ports_v2.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lectern/application/ports.py tests/application/test_ports_v2.py
git commit -m "feat: add generation v2 application port protocols"
```

### Task 3: Add domain events/state/engine contracts

**Files:**
- Create: `lectern/domain/generation/events.py`
- Create: `lectern/domain/generation/state.py`
- Create: `lectern/domain/generation/engine.py`
- Create: `lectern/domain/generation/types.py`
- Test: `tests/domain/test_generation_events_v2.py`
- Test: `tests/domain/test_generation_state_v2.py`

- [ ] **Step 1: Write failing tests for ordering/idempotency primitives**

```python
def test_domain_event_record_requires_monotonic_sequence():
    e1 = DomainEventRecord(session_id="s1", sequence_no=1, event=SessionStarted(...))
    e2 = DomainEventRecord(session_id="s1", sequence_no=2, event=PhaseStarted(...))
    assert e2.sequence_no > e1.sequence_no

def test_state_transition_blocks_duplicate_start():
    st = EngineState(session_id="s1", lifecycle="running")
    with pytest.raises(InvalidStateTransition):
        st.transition("start")
```

- [ ] **Step 2: Run targeted tests to confirm RED**

Run: `pytest tests/domain/test_generation_events_v2.py tests/domain/test_generation_state_v2.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement minimal domain contracts**

```python
class GenerationEngine(Protocol):
    async def initialize(self, ctx: EngineContext) -> EngineState: ...
    async def run_generation(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...
    async def run_reflection(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...
    async def run_export(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...
    async def cancel(self, state: EngineState, *, reason: str) -> EngineState: ...
```

- [ ] **Step 4: Re-run targeted tests for GREEN**

Run: `pytest tests/domain/test_generation_events_v2.py tests/domain/test_generation_state_v2.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lectern/domain/generation/events.py lectern/domain/generation/state.py lectern/domain/generation/engine.py lectern/domain/generation/types.py tests/domain/test_generation_events_v2.py tests/domain/test_generation_state_v2.py
git commit -m "feat: add generation v2 domain contracts"
```

### Task 4: Implement EventTranslator V2

**Files:**
- Create: `lectern/application/translators/event_translator.py`
- Test: `tests/application/test_event_translator_v2.py`

- [ ] **Step 1: Write failing translator tests**

```python
def test_translator_maps_domain_warning_to_api_event_v2():
    evt = WarningEmitted(code="provider_generation_failed", message="retrying", details={})
    api_evt = EventTranslator().to_api_event(evt, session_id="s1", sequence_no=7)
    assert api_evt.event_version == 2
    assert api_evt.type == "warning_emitted"
    assert api_evt.sequence_no == 7
```

- [ ] **Step 2: Run test to verify RED**

Run: `pytest tests/application/test_event_translator_v2.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement deterministic translator**

```python
return ApiEventV2(
    event_version=2,
    session_id=session_id,
    sequence_no=sequence_no,
    type="warning_emitted",
    message=event.message,
    timestamp=int(time.time() * 1000),
    data={"code": event.code, "details": event.details},
)
```

- [ ] **Step 4: Re-run targeted tests for GREEN**

Run: `pytest tests/application/test_event_translator_v2.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lectern/application/translators/event_translator.py tests/application/test_event_translator_v2.py
git commit -m "feat: add domain-to-api v2 event translator"
```

---

## Chunk 2: Infrastructure Adapters + Application Service

### Task 5: Add infrastructure adapters for existing implementations

**Files:**
- Create: `lectern/infrastructure/extractors/pdf_extractor.py`
- Create: `lectern/infrastructure/providers/gemini_adapter.py`
- Create: `lectern/infrastructure/gateways/anki_gateway.py`
- Create: `lectern/infrastructure/persistence/history_repository_sqlite.py`
- Create: `lectern/infrastructure/runtime/session_runtime_store.py`
- Test: `tests/application/test_infra_adapters_v2.py`

- [ ] **Step 1: Write failing adapter tests against port contracts**

```python
@pytest.mark.asyncio
async def test_history_repository_get_events_after_orders_ascending():
    repo = HistoryRepositorySqlite(...)
    events = await repo.get_events_after("s1", after_sequence_no=3)
    assert events == sorted(events, key=lambda e: e.sequence_no)
```

- [ ] **Step 2: Run targeted adapter tests to verify RED**

Run: `pytest tests/application/test_infra_adapters_v2.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement thin adapters around existing modules**

```python
class PdfExtractorAdapter(PdfExtractorPort):
    async def extract_metadata(self, pdf_path: str) -> PDFMetadata:
        data = await asyncio.to_thread(extract_pdf_metadata, pdf_path)
        return PDFMetadata(...)
```

- [ ] **Step 4: Re-run targeted adapter tests for GREEN**

Run: `pytest tests/application/test_infra_adapters_v2.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lectern/infrastructure/extractors/pdf_extractor.py lectern/infrastructure/providers/gemini_adapter.py lectern/infrastructure/gateways/anki_gateway.py lectern/infrastructure/persistence/history_repository_sqlite.py lectern/infrastructure/runtime/session_runtime_store.py tests/application/test_infra_adapters_v2.py
git commit -m "feat: add generation v2 infrastructure adapters"
```

### Task 6: Implement GenerationAppService orchestration

**Files:**
- Create: `lectern/application/generation_app_service.py`
- Modify: `lectern/orchestration/session_orchestrator.py` (only if needed for adapter seam)
- Test: `tests/application/test_generation_app_service_v2.py`

- [ ] **Step 1: Write failing app service tests for start/resume/cancel/replay**

```python
@pytest.mark.asyncio
async def test_run_generation_stream_persists_then_emits_in_sequence():
    events = [e async for e in service.run_generation_stream(req)]
    assert [e.sequence_no for e in events] == sorted(e.sequence_no for e in events)
    history.append_events.assert_awaited()
    history.sync_state.assert_awaited()

@pytest.mark.asyncio
async def test_resume_conflict_returns_typed_error():
    runtime.is_running.return_value = True
    with pytest.raises(GenerationApplicationError) as exc:
        [e async for e in service.run_resume_stream(req)]
    assert exc.value.code == GenerationErrorCode.RESUME_CONFLICT_ALREADY_RUNNING
```

- [ ] **Step 2: Run tests to confirm RED**

Run: `pytest tests/application/test_generation_app_service_v2.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement minimal service with ordering guarantees**

```python
await history.append_events(session_id, domain_records)
await history.sync_state(snapshot)
for rec in domain_records:
    yield translator.to_api_event(rec.event, session_id=session_id, sequence_no=rec.sequence_no)
```

- [ ] **Step 4: Add replay cursor behavior and edge handling**

```python
if req.after_sequence_no < 0:
    raise GenerationApplicationError(GenerationErrorCode.INVALID_INPUT, "after_sequence_no must be >= 0")
records = await history.get_events_after(req.session_id, after_sequence_no=req.after_sequence_no)
for rec in records:
    yield translator.to_api_event(rec.event, session_id=req.session_id, sequence_no=rec.sequence_no)
```

- [ ] **Step 5: Re-run targeted tests for GREEN**

Run: `pytest tests/application/test_generation_app_service_v2.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lectern/application/generation_app_service.py tests/application/test_generation_app_service_v2.py
git commit -m "feat: implement generation v2 application service"
```

### Task 7: Add dependency wiring for V2 stack

**Files:**
- Modify: `gui/backend/dependencies.py`
- Test: `tests/interface/test_generation_v2_dependencies.py`

- [ ] **Step 1: Write failing dependency test**

```python
def test_get_generation_app_service_v2_returns_singleton():
    s1 = get_generation_app_service_v2()
    s2 = get_generation_app_service_v2()
    assert s1 is s2
```

- [ ] **Step 2: Run test to confirm RED**

Run: `pytest tests/interface/test_generation_v2_dependencies.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement dependency provider and adapter wiring**

```python
@lru_cache
def get_generation_app_service_v2() -> GenerationAppService:
    return build_generation_app_service_v2(...)
```

- [ ] **Step 4: Re-run targeted tests for GREEN**

Run: `pytest tests/interface/test_generation_v2_dependencies.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gui/backend/dependencies.py tests/interface/test_generation_v2_dependencies.py
git commit -m "feat: wire generation v2 dependencies"
```

---

## Chunk 3: FastAPI V2 Interface + Frontend Migration + Verification

### Task 8: Implement `/generate-v2` router + serializer

**Files:**
- Create: `gui/backend/interface_v2/serializers/events_v2.py`
- Create: `gui/backend/interface_v2/routers/generation_v2.py`
- Modify: `gui/backend/main.py`
- Test: `tests/interface/test_generation_v2_router.py`

- [ ] **Step 1: Write failing router contract tests**

```python
@pytest.mark.asyncio
async def test_generate_v2_stream_emits_event_version_2(async_client):
    res = await async_client.post("/generate-v2", files=..., data=...)
    first_line = await _read_first_ndjson_line(res)
    assert first_line["event_version"] == 2
```

- [ ] **Step 2: Run router tests to confirm RED**

Run: `pytest tests/interface/test_generation_v2_router.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement v2 router + NDJSON serializer**

```python
@router.post("/generate-v2")
async def generate_v2(...):
    async def stream():
        async for evt in app_service.run_generation_stream(req):
            yield serialize_api_event_v2(evt) + "\n"
    return StreamingResponse(stream(), media_type="application/x-ndjson")
```

- [ ] **Step 4: Implement pre-stream vs post-stream error mapping**

```python
try:
    async for evt in app_service.run_generation_stream(req):
        yield line
except GenerationApplicationError as exc:
    yield serialize_api_event_v2(error_event_from_exc(exc))
```

- [ ] **Step 5: Re-run router tests for GREEN**

Run: `pytest tests/interface/test_generation_v2_router.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gui/backend/interface_v2/serializers/events_v2.py gui/backend/interface_v2/routers/generation_v2.py gui/backend/main.py tests/interface/test_generation_v2_router.py
git commit -m "feat: add generation v2 router and ndjson serializer"
```

### Task 9: Frontend V2 API + schema + handler

**Files:**
- Modify: `gui/frontend/src/api.ts`
- Create: `gui/frontend/src/schemas/sse-v2.ts`
- Modify: `gui/frontend/src/logic/generation.ts`
- Modify: `gui/frontend/src/tests/generation.test.ts`

- [ ] **Step 1: Write failing frontend tests for V2 event parsing**

```ts
it("accepts v2 event envelope and updates sessionId on session_started", () => {
  processGenerationEventV2(
    { event_version: 2, session_id: "s1", sequence_no: 1, type: "session_started", message: "", timestamp: Date.now(), data: { mode: "start" } },
    setMock
  );
  expect(setMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run frontend test to verify RED**

Run: `cd gui/frontend && npm test -- --run src/tests/generation.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement v2 schema + API call + handler wiring**

```ts
export const ApiEventV2Schema = z.object({
  event_version: z.literal(2),
  session_id: z.string(),
  sequence_no: z.number(),
  type: z.string(),
  message: z.string(),
  timestamp: z.number(),
  data: z.unknown(),
});
```

- [ ] **Step 4: Add replay cursor handling tests and implementation**

```ts
expect(nextCursor).toBe(lastSequenceNo);
```

- [ ] **Step 5: Re-run frontend targeted tests for GREEN**

Run: `cd gui/frontend && npm test -- --run src/tests/generation.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gui/frontend/src/api.ts gui/frontend/src/schemas/sse-v2.ts gui/frontend/src/logic/generation.ts gui/frontend/src/tests/generation.test.ts
git commit -m "feat: add frontend generation v2 event handling"
```

### Task 10: End-to-end migration verification and docs update

**Files:**
- Modify: `docs/AI_PIPELINE.md`
- Modify: `docs/BACKEND.md`
- (Optional, only if generated): `gui/frontend/src/generated/api.ts`

- [ ] **Step 1: Add failing doc assertion test (if docs test harness exists); otherwise skip and document**

If no docs tests exist, explicitly record “no docs tests available” in PR notes and continue.

- [ ] **Step 2: Update docs for V2 architecture and migration status**

Include:
- `/generate-v2` contract
- event_version 2 envelope
- replay cursor semantics
- pre-stream vs post-stream error behavior

- [ ] **Step 3: Run backend test suite**

Run: `pytest tests/ -v`  
Expected: PASS

- [ ] **Step 4: Run frontend lint + tests**

Run: `cd gui/frontend && npm run lint && npm test -- --run`  
Expected: PASS

- [ ] **Step 5: Final commit**

```bash
git add docs/AI_PIPELINE.md docs/BACKEND.md
git commit -m "docs: document generation v2 architecture and stream contracts"
```

---

## Final Verification Checklist

- [ ] `pytest tests/ -v` passes.
- [ ] `cd gui/frontend && npm run lint && npm test -- --run` passes.
- [ ] `/generate-v2` emits only `event_version: 2` envelope.
- [ ] Replay cursor behavior validated for:
  - `after_sequence_no < 0` -> 400 / typed error
  - `after_sequence_no >= latest_sequence_no` -> empty replay stream
  - corrupted sequence -> terminal `history_corrupt_sequence`
- [ ] Start/resume/cancel race semantics match transition table.

## Handoff Notes for Execution

- Start in dedicated worktree before code changes.
- Do not delete v1 route until Phase 4 task is reached.
- Keep commits small and scoped to one task each.

Plan complete and saved to `docs/superpowers/plans/2026-03-19-generation-architecture-modular-monolith-v2-implementation.md`. Ready to execute?
