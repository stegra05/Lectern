# Generation Architecture Redesign — Modular Monolith V2

## Problem Statement

Lectern’s generation system has strong building blocks (phases, orchestrator, typed events), but core responsibilities are spread across multiple layers:

- `gui/backend/routers/generation.py` handles transport, session lifecycle behavior, event shaping, and history-sync concerns.
- `lectern/lectern_service.py` manages runtime task behavior and pipeline entry concerns.
- `lectern/orchestration/phases.py` mixes sequencing, policy decisions, and infrastructure interaction details.
- `lectern/orchestration/session_orchestrator.py` owns generation state and loops, but its domain event model is translated into separate service event contracts later.

This creates maintainability friction: changes in one behavior often require touching router + phase + orchestrator + frontend contract handlers.

## Goal (Primary Optimization)

Primary optimization: **clean module boundaries and fewer cross-layer dependencies**.

This design intentionally prioritizes maintainability over short-term implementation convenience.

## Non-Goals

- Replacing Gemini provider/model strategy.
- Rewriting UI workflows or visual design.
- Changing core generation quality policies unless needed to enforce architecture boundaries.
- Big-bang migration that removes all v1 contracts at once.

## Considered Approaches

### A) Modular Monolith V2 (Selected)

Create strict Application/Domain/Infrastructure/Interface boundaries inside one deployable backend process.

Pros:
- Maximum maintainability gain with moderate migration risk.
- Keeps existing operational model (desktop app + FastAPI).
- Enables gradual migration with adapters.

Cons:
- Requires deliberate boundary refactors before feature work.
- Temporary dual-path complexity during v1/v2 transition.

### B) Full Event-Sourced Core

Make generation fully event-sourced with append-only logs and replay as the canonical state.

Pros:
- Excellent debuggability and determinism.
- Strong historical introspection.

Cons:
- Higher complexity and migration cost.
- Overkill for current stated priority.

### C) Thin Pipeline Kernel with Plugins

Generalize phases into a plugin kernel with dynamic strategy loading.

Pros:
- High extensibility.
- Good for many provider/pipeline variants.

Cons:
- Adds abstraction overhead before current boundary problems are solved.

## Recommendation

Adopt **A) Modular Monolith V2** first. It addresses the current pain directly (boundary clarity), reduces coupling, and keeps migration risk controlled.

## Current Architecture (How It Looks)

Current runtime flow (simplified):

`Router -> LecternGenerationService -> Orchestration Phases -> SessionOrchestrator -> DomainEvents -> ServiceEvents -> NDJSON -> Frontend Event Handlers`

Observed structural issues:

1. **Interface leakage:** router owns lifecycle and persistence logic that belongs to application orchestration.
2. **Dual event contracts:** domain events + service event literals + frontend type unions increase drift risk.
3. **Cross-cutting policies in phases:** phase code decides both orchestration behavior and policy/application concerns.
4. **Inconsistent responsibility ownership:** stop/resume/history behavior spans router/service/phase boundaries.

## Target Architecture (How It Should Look)

### Layer Model

#### 1) Interface Layer (`gui/backend/interface_v2/*`)

Responsibilities:
- Parse HTTP/multipart input.
- Start stream response.
- Serialize outbound API events.

Rules:
- No history/session mutation logic.
- No generation policy logic.
- Depends only on Application ports and API DTOs.

#### 2) Application Layer (`lectern/application/*`)

Responsibilities:
- Use-case orchestration (`start_generation`, `resume_generation`, `cancel_generation`, `run_generation_stream`).
- Transaction/lifecycle boundaries.
- Coordination of domain engine + infrastructure ports.

Rules:
- Depends on Domain interfaces and Infra ports (injected), never on router internals.
- Owns migration adapters and backward-compat behavior.

#### 3) Domain Layer (`lectern/domain/generation/*`)

Responsibilities:
- Canonical generation state machine and loop behavior.
- Pure policies: grounding gate, batch sizing, pacing rules, stop criteria.
- Typed immutable `DomainEvent` emission.

Rules:
- Pure business logic where feasible.
- Zero imports from FastAPI, DB implementation, provider SDKs, or Anki adapters.

#### 4) Infrastructure Layer (`lectern/infrastructure/*`)

Responsibilities:
- Provider integrations (`GeminiProviderAdapter`).
- Persistence (`HistoryRepositorySqlite`).
- Runtime session store.
- PDF extraction and Anki gateway adapters.

Rules:
- Implements application/domain ports.
- No orchestration policy.

### Canonical Runtime Data Flow

`RouterV2 -> GenerationAppService -> GenerationEngine -> Ports(PDF/AI/History/Anki) -> DomainEvent stream -> EventTranslator -> APIEventV2 NDJSON`

## Boundary Contracts

### Domain Event Contract (Internal, Stable)

Single internal event model emitted by domain engine.

Properties:
- Typed and immutable.
- Semantically aligned to domain transitions.
- Free of transport-specific fields (`timestamp` formatting, NDJSON concerns).

Canonical event catalog (minimum set):
- `session_started(session_id, mode)`
- `phase_started(phase, sequence_no)`
- `progress_updated(phase, current, total)`
- `card_emitted(card_uid, batch_index, card_payload)`
- `cards_replaced(batch_index, cards, coverage_data)`
- `warning_emitted(code, message, details)`
- `error_emitted(code, message, stage, recoverable)`
- `phase_completed(phase, duration_ms, summary)`
- `session_completed(summary)`
- `session_cancelled(stage, reason)`

Event ordering and idempotency rules:
- `sequence_no` is monotonic and strictly increasing per session.
- `session_started` must be first; `session_completed|session_cancelled|error_emitted(terminal)` must be terminal.
- `card_emitted.card_uid` must be stable and globally unique per session.
- Re-delivery-safe rule: consumers treat `(session_id, sequence_no)` as idempotency key.

### API Event Contract V2 (External, Versioned)

Single outward contract consumed by frontend.

Properties:
- Explicit version marker (e.g., `event_version: 2`).
- Transport-oriented shape (`type`, `message`, `data`, `timestamp`).
- Produced **only** by `EventTranslator`.

Canonical envelope:

```json
{
  "event_version": 2,
  "session_id": "string",
  "sequence_no": 17,
  "type": "phase_started",
  "message": "string",
  "timestamp": 1710000000000,
  "data": {}
}
```

Required v2 event types:
- `session_started`
- `phase_started`
- `progress_updated`
- `card_emitted`
- `cards_replaced`
- `warning_emitted`
- `error_emitted`
- `phase_completed`
- `session_completed`
- `session_cancelled`

Compatibility rule:
- During migration, `/generate` may continue emitting v1 events.
- `/generate-v2` emits only the v2 contract above.
- No mixed-version stream on a single endpoint.

### Translation Rule

`DomainEvent -> EventTranslator -> ApiEventV2`

No other layer may directly craft API event literals.

Translator mapping invariants:
- One-way deterministic mapping from every domain event variant.
- No business logic in translator (format/shape only).
- Translator cannot mutate domain state or call infrastructure.

## Application Port Interfaces (Normative)

`lectern/application/ports.py` must define at least:

```python
class PdfExtractorPort(Protocol):
    async def extract_metadata(self, pdf_path: str) -> PDFMetadata: ...

class AIProviderPort(Protocol):
    async def upload_document(self, pdf_path: str) -> UploadedDocument: ...
    async def build_concept_map(self, file_uri: str, mime_type: str) -> ConceptMapResult: ...
    async def generate_cards(self, *, limit: int, context: GenerationAIContext) -> GenerateResult: ...
    async def reflect_cards(self, *, limit: int, context: ReflectionAIContext) -> ReflectResult: ...
    def drain_warnings(self) -> list[str]: ...

class HistoryRepositoryPort(Protocol):
    async def create_session(self, init: SessionInit) -> None: ...
    async def update_phase(self, session_id: str, phase: str) -> None: ...
    async def append_events(self, session_id: str, events: list[DomainEventRecord]) -> None: ...
    async def sync_state(self, snapshot: SessionSnapshot) -> None: ...
    async def mark_terminal(self, session_id: str, status: str) -> None: ...
    async def get_session(self, session_id: str) -> SessionSnapshot | None: ...
    async def get_events_after(
        self,
        session_id: str,
        *,
        after_sequence_no: int,
        limit: int = 1000,
    ) -> list[DomainEventRecord]: ...

class RuntimeSessionStorePort(Protocol):
    async def start(self, session_id: str, handle: RuntimeHandle) -> None: ...
    async def stop(self, session_id: str) -> bool: ...
    async def get(self, session_id: str) -> RuntimeHandle | None: ...
    async def is_running(self, session_id: str) -> bool: ...

class AnkiGatewayPort(Protocol):
    async def check_ready(self) -> AnkiStatus: ...
    async def export_cards(self, request: ExportRequest) -> ExportResult: ...
```

`GenerationAppService` interface:

```python
class GenerationAppService(Protocol):
    async def run_generation_stream(self, req: StartGenerationRequest) -> AsyncIterator[ApiEventV2]: ...
    async def run_resume_stream(self, req: ResumeGenerationRequest) -> AsyncIterator[ApiEventV2]: ...
    async def replay_stream(
        self,
        req: ReplayStreamRequest,  # includes session_id + after_sequence_no
    ) -> AsyncIterator[ApiEventV2]: ...
    async def cancel(self, req: CancelGenerationRequest) -> CancelResult: ...
```

Normative domain engine interface:

```python
class GenerationEngine(Protocol):
    async def initialize(self, ctx: EngineContext) -> EngineState: ...
    async def run_generation(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...
    async def run_reflection(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...
    async def run_export(self, state: EngineState) -> AsyncIterator[DomainEvent]: ...
    async def cancel(self, state: EngineState, *, reason: str) -> EngineState: ...
```

Engine lifecycle guarantees:
- `initialize` must be called once before other methods.
- `run_*` methods are single-threaded per `session_id`.
- Engine methods only emit `DomainEvent`; they do not write transport envelopes.

Contract guarantees:
- Application service owns orchestration and port calls.
- Routers call only application DTOs/service methods.
- Domain engine never directly imports concrete port implementations.
- Persistence stores domain records, not transport event envelopes.

Normative request DTOs:
- `StartGenerationRequest`: `pdf_path`, `deck_name`, `model_name`, `tags`, `focus_prompt?`, `target_card_count?`, `stream_version=2`.
- `ResumeGenerationRequest`: `session_id`, `pdf_path`, `deck_name`, `model_name`, `stream_version=2`.
- `ReplayStreamRequest`: `session_id`, `after_sequence_no`, `stream_version=2`.
- `CancelGenerationRequest`: `session_id`.

Normative API event `data` payload keys:
- `session_started`: `{ mode }`
- `phase_started`: `{ phase }`
- `progress_updated`: `{ phase, current, total }`
- `card_emitted`: `{ card, batch_index }`
- `cards_replaced`: `{ cards, coverage_data }`
- `warning_emitted`: `{ code, details }`
- `error_emitted`: `{ code, stage, recoverable }`
- `phase_completed`: `{ phase, duration_ms, summary }`
- `session_completed`: `{ summary }`
- `session_cancelled`: `{ stage, reason }`

Replay contract (normative):
- Cursor is `after_sequence_no` (exclusive semantics).
- Returned records are ordered ascending by `sequence_no`.
- Each stream replay chunk is contiguous and gap-free within returned range.
- `replay_stream` maps stored `DomainEventRecord` through `EventTranslator` before emit.
- Cursor validation:
  - `after_sequence_no < 0` -> `invalid_input` (HTTP 400).
  - `after_sequence_no >= latest_sequence_no` -> empty replay stream then graceful close.
  - Gap/corruption detected in persisted sequence -> terminal `error_emitted(code="history_corrupt_sequence")`.

Persist/emit atomicity contract (normative):
- Application uses append-only event outbox semantics:
  1. append domain events to persistence in one atomic write per batch (`append_events`)
  2. update session snapshot (`sync_state`) in same transaction boundary when supported; otherwise apply write-ahead marker + idempotent retry
  3. emit translated API events to stream
- Crash before step 3 is recoverable by replay from persisted sequence.
- Crash after partial emit is recoverable because clients dedupe by `(session_id, sequence_no)`.

## Module Layout (Target)

```text
gui/backend/
  interface_v2/
    routers/generation_v2.py
    serializers/events_v2.py

lectern/
  application/
    generation_app_service.py
    dto.py
    ports.py
    translators/event_translator.py

  domain/generation/
    engine.py
    state.py
    events.py
    policies/
      grounding_gate.py
      batch_sizing.py
      pacing.py
      stop_rules.py

  infrastructure/
    providers/gemini_adapter.py
    persistence/history_repository_sqlite.py
    runtime/session_runtime_store.py
    gateways/anki_gateway.py
    extractors/pdf_extractor.py
```

## Versioned Migration Strategy (Breaking Changes Allowed)

### Phase 1 — Introduce V2 in Parallel

- Add `/generate-v2` endpoint and API Event V2 schema.
- Keep existing `/generate` path active.
- Implement adapter path so v1 can be served from v2 internals where practical.
- Introduce explicit per-session `stream_version` persisted in history/runtime state.

Exit criteria:
- V2 stream runs end-to-end for generate/resume/cancel.
- In-flight v1 sessions continue to completion on v1 path (no mid-session version switch).
- Replay path ready: `replay_stream` + cursor semantics implemented and contract-tested.

### Phase 2 — Frontend V2 Adoption

- Add frontend parser/handlers for Event V2.
- Switch primary generation flow to `/generate-v2`.
- Keep legacy parser behind compatibility flag until stabilized.
- Add reconnect logic using `(session_id, sequence_no)` resume cursor.

Exit criteria:
- UI generation/recovery/cancel behavior validated on v2 only.
- Network disconnect/reconnect tested against v2 stream replay behavior.
- Replay cursor edge-cases validated (`<0`, `>=latest`, sequence-gap detection).

### Phase 3 — Retire V1

- Disable v1 by default via feature flag (`GENERATION_V1_ENABLED=false`), while code remains for one release.
- Delete translation shims that exist only for v1 compatibility.
- Remove v1 schema validators and compatibility code paths in frontend/backend.

Exit criteria:
- Single event contract path remains.
- Rollback playbook verified (temporary re-enable via feature flag during grace window only).

Phase 4 — Remove fallback code

- After one stable release with v1 disabled, delete v1 route/code/flags.

Exit criteria:
- No v1 generation code remains in repository.

### Migration Safety Invariants

- A session has exactly one stream contract version from start to terminal state.
- Resume requests must match persisted `stream_version`; mismatch returns typed error.
- `cancel` is idempotent: repeated cancel requests return success-shaped `already_stopped` result.
- Event replay for reconnect cannot emit out-of-order `sequence_no`.
- Runtime handle ownership is CAS-based: only one active handle per `session_id`.
- Start/resume/cancel transitions must pass explicit state-transition checks.

Concurrency and state-transition table (normative):

| Current state | Operation | Allowed | Result |
|---|---|---|---|
| `idle` | `start` | Yes | `running` |
| `running` | `start` | No | `resume_conflict_already_running` |
| `running` | `resume` | No | `resume_conflict_already_running` |
| `stopped` | `resume` | Yes (version+invariants match) | `running` |
| `error` | `resume` | Yes (version+invariants match) | `running` |
| `completed` | `resume` | No | `invalid_input` |
| `running` | `cancel` | Yes | `cancelled` |
| `cancelled|completed|error` | `cancel` | Yes (idempotent) | `cancel_idempotent_noop` |

## Error Handling Model

### Domain

- Returns typed failures/events.
- No broad catch-and-swallow logic.

### Application

- Applies retry/stop/escalation policy.
- Converts infrastructure exceptions into domain/application error categories.

### Interface

- Maps application outcomes to HTTP + NDJSON shapes.
- No policy decisions.

### Failure Taxonomy (Normative)

Domain/application error codes:
- `invalid_input`
- `pdf_unavailable`
- `provider_upload_failed`
- `provider_generation_failed`
- `provider_reflection_failed`
- `history_persist_failed`
- `history_corrupt_sequence`
- `session_not_found`
- `resume_version_mismatch`
- `resume_conflict_already_running`
- `cancel_idempotent_noop`
- `stream_disconnected`
- `internal_unexpected`

Mapping matrix:

| Error code | Recoverable | HTTP (REST ops) | Stream behavior |
|---|---:|---:|---|
| `invalid_input` | No | 400 | terminal `error_emitted` |
| `pdf_unavailable` | No | 422 | terminal `error_emitted` |
| `provider_upload_failed` | No | 502 | terminal `error_emitted` |
| `provider_generation_failed` | Mixed | 502 | `warning_emitted` or terminal `error_emitted` by policy |
| `provider_reflection_failed` | Yes | 200 | `warning_emitted`, continue with accepted cards |
| `history_persist_failed` | No | 500 | terminal `error_emitted` |
| `history_corrupt_sequence` | No | 500 | terminal `error_emitted` |
| `session_not_found` | No | 404 | terminal `error_emitted` |
| `resume_version_mismatch` | No | 409 | terminal `error_emitted` |
| `resume_conflict_already_running` | No | 409 | terminal `error_emitted` |
| `cancel_idempotent_noop` | Yes | 200 | `session_cancelled` already reached |
| `stream_disconnected` | Yes | n/a | resumable via cursor |
| `internal_unexpected` | No | 500 | terminal `error_emitted` |

Policy ownership:
- Domain classifies domain failures.
- Application decides continue/retry/terminal behavior.
- Interface performs final protocol mapping only.

HTTP vs stream-phase mapping:
- **Pre-stream phase** (before NDJSON headers): failures return HTTP status/body per mapping table.
- **Post-stream phase** (after headers): failures MUST be emitted as `error_emitted`/`warning_emitted` events; HTTP status cannot change.

Deterministic generation-failure policy (`provider_generation_failed`, behavior-preserving codification):
- Retry at most once within current batch when failure kind is transient (`timeout`, `429`, `5xx` provider transport).
- No retry for deterministic input/schema failures.
- If retry succeeds: emit `warning_emitted` with `degraded_recovered=true`, continue.
- If retry fails or non-retriable: emit terminal `error_emitted`.

## Stream Edge Cases (Must-Have Behaviors)

- Disconnect during generation: client reconnects with cursor; server replays from next `sequence_no`.
- Duplicate cancel requests: idempotent outcome, no duplicate terminal transitions.
- Resume while already running: typed conflict outcome, no second runtime handle.
- Partial NDJSON write failure: stream closes, session remains recoverable if non-terminal.
- Out-of-order event attempt: rejected before emit; logged as invariant violation.

Stream-time failure semantics (normative):
- After NDJSON headers are sent, errors are surfaced as stream events, not HTTP status changes.
- Terminal path ordering is:
  1. emit `error_emitted|session_cancelled|session_completed`
  2. flush
  3. close stream
- If flush fails, runtime state remains persisted; reconnect uses replay cursor.
- Cancel race rule: if `cancel` wins before terminal emit, final terminal event is `session_cancelled`; otherwise `cancel_idempotent_noop` on follow-up cancel.

## Testing Strategy

### Domain tests (primary safety net)

- State transitions for generation and reflection loops.
- Policy tests for gating, batch sizing, pacing, stop rules.
- Deterministic event emission expectations.

### Application tests

- Orchestration behavior with mocked ports.
- Start/resume/cancel flow contracts.
- Error-category mapping behavior.

### Interface contract tests

- `/generate-v2` NDJSON schema validation.
- Version marker and event shape stability.
- Backward-compat adapter behavior for v1 during migration.

### Regression guardrails

- Existing generation quality tests remain valid or are re-wired through app/domain boundaries.
- Existing frontend stream-processing tests gain V2 contract coverage.

## Success Criteria (Definition of Done)

1. **Boundary correctness**
   - Domain layer has zero infra/framework imports.
   - Router layer contains no lifecycle/persistence orchestration logic.

2. **Coupling reduction**
   - Typical policy change (e.g., grounding threshold) touches at most domain policy + related tests.
   - Typical transport change (event shape) touches translator/interface + contract tests, not domain.

3. **Contract singularity**
   - One domain event model internally.
   - One API event model externally (V2).

4. **Migration completion**
   - Frontend running on `/generate-v2`.
   - v1 generation route and compatibility glue removed after cutover.

## Risks and Mitigations

- **Risk: migration complexity due to dual-path operation**
  - Mitigation: explicit phase exits and limited migration window.

- **Risk: accidental behavior drift during boundary extraction**
  - Mitigation: characterize current behavior with app-level integration tests before moving modules.

- **Risk: temporary increase in code volume**
  - Mitigation: remove v1 shims immediately after stable V2 rollout.

## Out-of-Scope Follow-Ups

- Event sourcing/replay enhancements can be revisited after boundary stabilization.
- Provider plugin architecture can be revisited if multiple providers become a near-term requirement.

## Summary

This redesign keeps Lectern as a modular monolith, but enforces strict ownership:

- Router = transport only
- Application = orchestration only
- Domain = state + policy only
- Infrastructure = integrations only

With a versioned `/generate-v2` migration, the system can accept breaking cleanup now while preserving delivery safety and reducing long-term change friction.
