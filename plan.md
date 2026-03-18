I'm using the writing-plans skill to create the implementation plan.

# A-Grade Uplift Roadmap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise Lectern’s weighted quality score from **87.25** to **90+** by reducing provider lock-in, lowering setup friction, decomposing orchestration complexity, and adding quality-regression verification.

**Architecture:** This roadmap keeps the existing FastAPI + service + React/Zustand architecture and introduces incremental seams instead of rewrites. Work is delivered as independent, test-first milestones that can ship separately. Each milestone includes explicit verification and docs updates so quality gains are durable.

**Tech Stack:** Python (FastAPI, Pydantic, pytest), React/TypeScript (Vite, Zustand, Vitest, Playwright), GitHub Actions CI.

---

## Problem Statement

Current score profile:
- Code Quality: 88
- Architecture: 90
- Functionality: 89
- Idea: 82
- Weighted Final: 87.25

To reach 90+, we need improvements that affect both technical quality and product viability signals:
1. AI provider abstraction (reduce Gemini-only coupling).
2. Onboarding/diagnostics improvements (reduce setup friction and failure ambiguity).
3. Orchestration decomposition (reduce service hot-spot complexity).
4. Automated quality regression signals in CI (protect future score).

## Scope and Non-Goals

In scope:
- New provider abstraction with Gemini adapter as first implementation.
- Better prerequisite diagnostics surfaced through backend + UI.
- Small-step extraction of service responsibilities without behavior rewrite.
- New tests and CI checks for card-quality regression signals.
- Documentation updates for new architecture and developer flow.

Out of scope:
- Full multi-provider production rollout with billing/accounting.
- Major UI redesign.
- Replacing core generation prompts/pipeline semantics.

## Score-Lift Targets (Expected)

- Architecture: +1 to +3 (clearer boundaries, dependency inversion).
- Code Quality: +1 to +3 (smaller units, stronger tests).
- Functionality: +1 to +2 (better onboarding reliability and observability).
- Idea: +4 to +8 (reduced lock-in risk, clearer adoption path).

Conservative post-roadmap expectation: **90–92 weighted**.

---

## File Structure Plan (Locked Before Implementation)

### Provider Abstraction
- Create: `lectern/providers/__init__.py` — public provider exports.
- Create: `lectern/providers/base.py` — provider protocol/interface and shared result types.
- Create: `lectern/providers/gemini_provider.py` — Gemini-backed adapter extracted from current client behavior.
- Create: `lectern/providers/factory.py` — provider selection and validation.
- Modify: `lectern/lectern_service.py` — consume provider interface instead of concrete AI client.
- Modify: `lectern/config.py` and `gui/backend/routers/system.py` — optional provider metadata in config/health endpoints.
- Test: `tests/test_provider_factory.py`, `tests/test_gemini_provider.py`, `tests/test_service_provider_integration.py`.

### Onboarding & Diagnostics
- Modify: `gui/backend/routers/system.py` — expand health diagnostics payload (non-breaking additive fields).
- Modify: `gui/frontend/src/schemas/api.ts` and generated client usage as needed.
- Modify: `gui/frontend/src/hooks/useOnboardingFlow.ts` — map diagnostics to explicit states/messages.
- Modify: `gui/frontend/src/components/OnboardingFlow.tsx` — actionable remediation UI.
- Modify: `gui/frontend/src/components/SettingsModal.tsx` and `gui/frontend/src/hooks/useSettingsModal.ts` — preflight hints + retry affordances.
- Test: `gui/frontend/src/tests/OnboardingFlow.test.tsx`, `gui/frontend/src/tests/SettingsModal.test.tsx`, `tests/test_openapi_contracts.py`.

### Service Decomposition
- Create: `lectern/orchestration/pipeline_runner.py` — isolated pipeline orchestration entrypoint.
- Create: `lectern/orchestration/cancellation.py` — cancellation and cleanup helpers.
- Modify: `lectern/lectern_service.py` — become a thinner facade.
- Test: `tests/test_service.py`, `tests/test_pipeline_phases.py`, plus new focused unit tests for runner/cancellation.

### Quality Regression Gates
- Create: `tests/test_card_quality_regressions.py` — deterministic scoring checks for generated-card quality invariants.
- Modify: `.github/workflows/build.yml` — add quality regression job in gate chain.
- Modify: `docs/AI_PIPELINE.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md` — document new checks and contracts.

---

## Verification Baseline (Before Edits)

- [ ] Run backend tests:
  - Command: `pytest tests/ -v`
  - Expected: pass, no new failures introduced by baseline.

- [ ] Run frontend lint + unit tests:
  - Command: `cd gui/frontend && npm run lint && npm test -- --run`
  - Expected: pass, no lint/type regressions.

- [ ] Run critical E2E:
  - Command: `cd gui/frontend && npm run test:e2e:critical`
  - Expected: critical paths pass.

---

## Chunk 1: Provider Abstraction (Lock-in Reduction)

### Task 1.1: Introduce provider interface and factory

**Files:**
- Create: `lectern/providers/base.py`
- Create: `lectern/providers/factory.py`
- Create: `tests/test_provider_factory.py`

- [ ] **Step 1: Write failing factory tests first**
  - Add tests for: supported provider selection, unsupported provider error, default provider fallback.
  - Run: `pytest tests/test_provider_factory.py -v`
  - Expected: FAIL for missing modules/symbols.

- [ ] **Step 2: Implement minimal provider protocol + factory**
  - Define provider interface with methods required by orchestration (`build_concept_map`, `generate_cards`, `reflect_cards`, etc.).
  - Implement factory mapping for current Gemini provider.

- [ ] **Step 3: Run targeted tests**
  - Run: `pytest tests/test_provider_factory.py -v`
  - Expected: PASS.

- [ ] **Step 4: Commit**
  - `git add lectern/providers/base.py lectern/providers/factory.py tests/test_provider_factory.py`
  - `git commit -m "feat: add ai provider interface and factory"`

### Task 1.2: Add Gemini provider adapter without behavior drift

**Files:**
- Create: `lectern/providers/gemini_provider.py`
- Modify: `lectern/ai_client.py` (extract/reuse logic, keep compatibility wrapper if needed)
- Create: `tests/test_gemini_provider.py`

- [ ] **Step 1: Write failing adapter parity tests**
  - Validate schema handling, error propagation, and known retry behavior paths.
  - Run: `pytest tests/test_gemini_provider.py -v`
  - Expected: FAIL initially.

- [ ] **Step 2: Implement adapter using existing Gemini logic**
  - Reuse current internals where possible (DRY) and avoid prompt/schema duplication.

- [ ] **Step 3: Re-run targeted tests**
  - Run: `pytest tests/test_gemini_provider.py -v`
  - Expected: PASS.

- [ ] **Step 4: Commit**
  - `git add lectern/providers/gemini_provider.py lectern/ai_client.py tests/test_gemini_provider.py`
  - `git commit -m "refactor: isolate gemini implementation behind provider adapter"`

### Task 1.3: Wire service to provider abstraction

**Files:**
- Modify: `lectern/lectern_service.py`
- Create: `tests/test_service_provider_integration.py`

- [ ] **Step 1: Add failing service integration tests**
  - Assert service consumes provider interface and still emits expected event lifecycle.
  - Run: `pytest tests/test_service_provider_integration.py -v`
  - Expected: FAIL before wiring.

- [ ] **Step 2: Implement service wiring**
  - Inject provider via factory/default config.
  - Preserve external API signatures and event contracts.

- [ ] **Step 3: Run focused + existing service tests**
  - Run: `pytest tests/test_service_provider_integration.py tests/test_service.py -v`
  - Expected: PASS.

- [ ] **Step 4: Commit**
  - `git add lectern/lectern_service.py tests/test_service_provider_integration.py`
  - `git commit -m "refactor: route generation service through provider abstraction"`

### Task 1.4: Expose provider configuration and diagnostics metadata

**Files:**
- Modify: `lectern/config.py`
- Modify: `gui/backend/routers/system.py`
- Create/Modify: `tests/test_system_provider_config.py`
- Modify: `tests/test_openapi_contracts.py`

- [ ] **Step 1: Write failing config/health metadata tests**
  - Assert provider selection config is readable and `/health` includes provider metadata fields.
  - Run: `pytest tests/test_system_provider_config.py tests/test_openapi_contracts.py -v`
  - Expected: FAIL before implementation.

- [ ] **Step 2: Add provider configuration key in backend config**
  - Introduce provider selector with safe default to current Gemini implementation.

- [ ] **Step 3: Add provider metadata to health response**
  - Include active provider identifier and readiness hint fields as additive response keys.

- [ ] **Step 4: Re-run provider metadata tests**
  - Run: `pytest tests/test_system_provider_config.py tests/test_openapi_contracts.py -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add lectern/config.py gui/backend/routers/system.py tests/test_system_provider_config.py tests/test_openapi_contracts.py`
  - `git commit -m "feat: expose ai provider config and health metadata"`

---

## Chunk 2: Onboarding & Diagnostics (Friction Reduction)

### Task 2.1: Extend health/config diagnostics contract

**Files:**
- Modify: `gui/backend/routers/system.py`
- Modify: `tests/test_openapi_contracts.py`
- Create/Modify: `tests/test_system_health.py` (new endpoint-level assertions)

- [ ] **Step 1: Write failing backend contract tests**
  - Add assertions for new additive diagnostics fields and schema presence.
  - Run: `pytest tests/test_openapi_contracts.py tests/test_system_health.py -v`
  - Expected: FAIL before endpoint changes.

- [ ] **Step 2: Implement additive diagnostics in `/health`**
  - Include actionable machine-readable hints (e.g., anki reachability details, api key configured status detail).
  - Keep backward compatibility for existing fields.

- [ ] **Step 3: Re-run backend contract tests**
  - Run: `pytest tests/test_openapi_contracts.py tests/test_system_health.py -v`
  - Expected: PASS.

- [ ] **Step 4: Regenerate frontend OpenAPI client for new contract**
  - Run: `cd gui/frontend && npm run generate-api`
  - Expected: `src/generated/api.ts` updates only when schema changed.

- [ ] **Step 5: Validate generated client drift explicitly**
  - Run: `cd gui/frontend && git diff -- src/generated/api.ts`
  - Expected: diff present only for intended schema additions.

- [ ] **Step 6: Commit**
  - `git add gui/backend/routers/system.py tests/test_openapi_contracts.py tests/test_system_health.py gui/frontend/src/generated/api.ts`
  - `git commit -m "feat: add actionable system diagnostics to health contract"`

### Task 2.2: Update onboarding flow for actionable remediation

**Files:**
- Modify: `gui/frontend/src/hooks/useOnboardingFlow.ts`
- Modify: `gui/frontend/src/components/OnboardingFlow.tsx`
- Modify: `gui/frontend/src/tests/OnboardingFlow.test.tsx`

- [ ] **Step 1: Add failing onboarding tests**
  - Cover specific remediation paths for Anki unavailable, API key missing, retry success transitions.
  - Run: `cd gui/frontend && npm test -- --run OnboardingFlow.test.tsx`
  - Expected: FAIL before implementation.

- [ ] **Step 2: Implement hook-side diagnostic mapping**
  - Map backend diagnostics to explicit step states and retry affordances in `useOnboardingFlow`.

- [ ] **Step 3: Implement presentational messaging updates**
  - Update `OnboardingFlow` copy and actions while keeping container/view split intact.

- [ ] **Step 4: Re-run onboarding tests**
  - Run: `cd gui/frontend && npm test -- --run OnboardingFlow.test.tsx`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add gui/frontend/src/hooks/useOnboardingFlow.ts gui/frontend/src/components/OnboardingFlow.tsx gui/frontend/src/tests/OnboardingFlow.test.tsx`
  - `git commit -m "feat: improve onboarding remediation and diagnostics UX"`

### Task 2.3: Add settings preflight hints and quick-fix affordances

**Files:**
- Modify: `gui/frontend/src/hooks/useSettingsModal.ts`
- Modify: `gui/frontend/src/components/SettingsModal.tsx`
- Modify: `gui/frontend/src/tests/SettingsModal.test.tsx`

- [ ] **Step 1: Add failing settings tests**
  - Validate hints for invalid Anki URL and disconnected states; validate retry/ping behavior.
  - Run: `cd gui/frontend && npm test -- --run SettingsModal.test.tsx`
  - Expected: FAIL before implementation.

- [ ] **Step 2: Implement hook-side preflight state logic**
  - Add any validation/retry/ping orchestration in `useSettingsModal`.

- [ ] **Step 3: Implement presentational hints and actions**
  - Render preflight guidance and user actions in `SettingsModal` without moving business logic into view.

- [ ] **Step 4: Re-run tests**
  - Run: `cd gui/frontend && npm test -- --run SettingsModal.test.tsx`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add gui/frontend/src/hooks/useSettingsModal.ts gui/frontend/src/components/SettingsModal.tsx gui/frontend/src/tests/SettingsModal.test.tsx`
  - `git commit -m "feat: add settings preflight diagnostics and recovery actions"`

---

## Chunk 3: Service Decomposition (Complexity Control)

### Task 3.1: Extract pipeline runner from service facade

**Files:**
- Create: `lectern/orchestration/pipeline_runner.py`
- Modify: `lectern/lectern_service.py`
- Create: `tests/test_pipeline_runner.py`

- [ ] **Step 1: Add failing runner tests**
  - Cover phase sequencing, stop-check behavior, and phase halt handling.
  - Run: `pytest tests/test_pipeline_runner.py -v`
  - Expected: FAIL before extraction.

- [ ] **Step 2: Extract phase loop into runner module**
  - Move only phase sequencing and halt handling first.

- [ ] **Step 3: Move shared context setup into runner entrypoint**
  - Keep event order and payload semantics unchanged.

- [ ] **Step 4: Verify focused tests**
  - Run: `pytest tests/test_pipeline_runner.py tests/test_pipeline_phases.py -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add lectern/orchestration/pipeline_runner.py lectern/lectern_service.py tests/test_pipeline_runner.py`
  - `git commit -m "refactor: extract pipeline runner from generation service"`

### Task 3.2: Extract cancellation/cleanup helpers

**Files:**
- Create: `lectern/orchestration/cancellation.py`
- Modify: `lectern/lectern_service.py`
- Modify/Create: `tests/test_service_cancellation.py`

- [ ] **Step 1: Add failing cancellation tests**
  - Assert background task cancellation and cleanup semantics on stream close.
  - Run: `pytest tests/test_service_cancellation.py -v`
  - Expected: FAIL before extraction.

- [ ] **Step 2: Extract cancellation trigger helper**
  - Move task cancellation start/timeout handling into dedicated helper.

- [ ] **Step 3: Extract cleanup finalizer helper**
  - Move emitter close/final cleanup logic while preserving timeout/error logging behavior.

- [ ] **Step 4: Re-run service tests**
  - Run: `pytest tests/test_service_cancellation.py tests/test_service.py -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add lectern/orchestration/cancellation.py lectern/lectern_service.py tests/test_service_cancellation.py`
  - `git commit -m "refactor: isolate cancellation and cleanup behavior"`

---

## Chunk 4: Quality Regression Gates (Durability)

### Task 4.1: Introduce deterministic quality regression tests

**Files:**
- Create: `tests/test_card_quality_regressions.py`
- Modify (if needed): `lectern/card_quality.py` fixtures/helpers only

- [ ] **Step 1: Add failing regression tests**
  - Encode invariants (atomicity signals, duplication thresholds, malformed field rejection).
  - Run: `pytest tests/test_card_quality_regressions.py -v`
  - Expected: FAIL until fixtures/expectations are aligned.

- [ ] **Step 2: Add minimal support code (if required)**
  - Keep deterministic inputs and explicit expected outputs.

- [ ] **Step 3: Re-run regression tests**
  - Run: `pytest tests/test_card_quality_regressions.py -v`
  - Expected: PASS.

- [ ] **Step 4: Commit**
  - `git add tests/test_card_quality_regressions.py lectern/card_quality.py`
  - `git commit -m "test: add deterministic card-quality regression suite"`

### Task 4.2: Wire regression checks into CI and docs

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `docs/AI_PIPELINE.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT.md`

- [ ] **Step 1: Add failing CI expectation locally**
  - Ensure workflow includes a new `quality-regressions` job in gate sequence.
  - Run local check: `pytest tests/test_card_quality_regressions.py -v`
  - Expected: PASS locally before CI adoption.

- [ ] **Step 2: Update workflow + docs**
  - Add explicit job name `quality-regressions`.
  - Set `quality-regressions` with `needs: lint`.
  - Update `build` job `needs` to include `quality-regressions`.
  - Add developer command guidance in docs.

- [ ] **Step 3: Verify documentation consistency**
  - Run search: `rg "quality regression|test_card_quality_regressions|gate" docs/ .github/workflows/build.yml`
  - Expected: entries consistent and non-conflicting.

- [ ] **Step 4: Commit**
  - `git add .github/workflows/build.yml docs/AI_PIPELINE.md docs/ARCHITECTURE.md docs/DEVELOPMENT.md`
  - `git commit -m "chore: enforce quality regression gate and document workflow"`

---

## Final Verification (Before Merge/PR)

- [ ] Backend full suite:
  - `pytest tests/ -v`
  - Expected: PASS.

- [ ] Frontend lint + unit:
  - `cd gui/frontend && npm run lint && npm test -- --run`
  - Expected: PASS.

- [ ] Frontend critical E2E:
  - `cd gui/frontend && npm run test:e2e:critical`
  - Expected: PASS.

- [ ] Integrated smoke:
  - `cd gui/frontend && npm run test:e2e:integrated`
  - Expected: PASS.

- [ ] API client sync:
  - `cd gui/frontend && npm run generate-api && git diff --exit-code -- src/generated/api.ts`
  - Expected: no diff.

---

## Execution Order and Dependencies

1. Chunk 1 (provider abstraction) must land before idea-score lock-in reduction can be claimed.
2. Chunk 2 (diagnostics/onboarding) can run in parallel with late Chunk 1 testing, but final wiring depends on API contract stability.
3. Chunk 3 (service decomposition) should follow Chunk 1 to avoid parallel edits to `lectern/lectern_service.py`.
4. Chunk 4 (quality gates) should run after Chunk 1–3 so new regression checks capture the stabilized behavior.

## Risk Controls

- Preserve existing endpoint and event contracts; only additive changes unless explicitly versioned.
- No broad silent exception swallowing in new code paths.
- Keep prompts/schemas as single source of truth; no duplication during extraction.
- Prefer small commits per task with clear rollback boundaries.

## Deliverables

1. Merged provider abstraction seam with Gemini adapter.
2. Improved onboarding/settings diagnostics UX and API contract.
3. Thinner service facade with extracted runner/cancellation modules.
4. New quality regression suite enforced in CI.
5. Updated docs reflecting architecture and operational workflow.
