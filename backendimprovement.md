# Backend Architecture Refactor: Strangle the Monolith

Here are the complete, ready-to-paste Jira tickets. They are written for a senior or mid-level backend engineer, providing the exact architectural boundaries needed to execute this refactor without breaking the delicate SSE contracts your React frontend relies on.

---

### **Ticket 1: Extract `PipelineEmitter` (Remove Generator Boilerplate)**

**Type:** Tech Debt / Refactor
**Story Points:** 3

**Context:**
Currently, `LecternGenerationService._generate_stream` routes all progress and snapshot updates through a massive, nested `async for ev in _yield_with_snapshot(...)` generator pattern. This forces the core business logic to act as a low-level event router, suffocating the actual application flow and making the service untestable.

**Task:**
Extract the snapshot and event yielding logic into a dedicated, injectable `PipelineEmitter` class. The service layer should not yield directly; it should call awaitable methods on the emitter.

**Acceptance Criteria:**
* Create a `PipelineEmitter` (or `SessionEventEmitter`) class that encapsulates the `SnapshotTracker`.
* The class exposes explicit semantic methods (e.g., `await emitter.step_start("Extracting text")`, `await emitter.emit_progress(current, total)`).
* The core `_generate_stream` loop is stripped of the `_yield_with_snapshot` boilerplate. It simply awaits the emitter methods.
* **Crucial:** The SSE payload shape (`ServiceEvent`) and the snapshot timestamp logic must remain *exactly* the same so the React frontend does not break.
* Unit tests for `LecternGenerationService` can now simply inject a `MockEmitter` to verify events are fired without managing async generators.

---

### **Ticket 2: Define `SessionContext` & `PipelinePhase` Interfaces**

**Type:** Tech Debt / Refactor
**Story Points:** 2

**Context:**
State in the generation run (file paths, concept maps, token counts, target caps) is currently passed around as loose local variables within a single 400-line method. To break this apart, we need a unified state container.

**Task:**
Create a strict data structure to hold the generation state and define the abstract interface for our new pipeline phases.

**Acceptance Criteria:**
* Create a `SessionContext` dataclass/Pydantic model. It must hold: configurations (deck name, tags), extracted metadata (page count, chars), AI context (concept map, examples), and the accumulated payload (generated cards, final coverage).
* Create an abstract base class `PipelinePhase`.
* `PipelinePhase` must enforce a single method signature: `async def execute(self, context: SessionContext, emitter: PipelineEmitter, ai_client: LecternAIClient) -> None`
* Any mutation of the run state must happen explicitly by updating the `SessionContext` object.

---

### **Ticket 3: Isolate `InitializationPhase` & `ConceptMappingPhase`**

**Type:** Tech Debt / Refactor
**Story Points:** 5

**Context:**
The first half of the generation script mixes local file I/O, Anki REST polling, PDF extraction, and Gemini multimodal concept mapping. If the concept map logic fails, it tangles with the file validation logic.

**Task:**
Implement the first two pipeline phases and migrate the top half of the monolith into them.

**Acceptance Criteria:**
* Create `InitializationPhase` inheriting from `PipelinePhase`. Move PDF validation, file sizing, early metadata extraction (PyMuPDF), and Anki connection sanity checks here.
* Create `ConceptMappingPhase` inheriting from `PipelinePhase`. Move style example sampling, PDF uploading to Gemini, and the `ai.concept_map_from_file` logic here.
* Both phases update the `SessionContext` with their results (e.g., `context.actual_pages`, `context.concept_map`).
* `LecternGenerationService` now instantiates these two classes and calls `.execute()` sequentially.

---

### **Ticket 4: Fortify `SessionOrchestrator` (`GenerationPhase`)**

**Type:** Tech Debt / Refactor
**Story Points:** 5

**Context:**
We built a `SessionOrchestrator` to be the single source of truth for the generation loop, but it relies on the service layer to pre-compute pacing targets, density caps, and initial coverage gaps before it starts.

**Task:**
Wrap the `SessionOrchestrator` in a `GenerationPhase` implementation. Push all the pre-computation (the heuristic math) into the orchestrator's domain.

**Acceptance Criteria:**
* Create `GenerationPhase` inheriting from `PipelinePhase`.
* Move the logic for `derive_effective_target`, `estimate_card_cap`, and the initial `compute_coverage_data` *into* this phase (or directly into the `SessionOrchestrator` setup).
* The phase maps the orchestrator's output (`DomainEvent` objects) to the `PipelineEmitter` to maintain the SSE stream.
* Once generation and reflection complete, the phase attaches the final `all_cards` array to the `SessionContext`.

---

### **Ticket 5: Isolate `ExportPhase` & Finalize Runner**

**Type:** Tech Debt / Refactor
**Story Points:** 3

**Context:**
The final step—syncing the session state to the database and exporting notes via AnkiConnect—is currently hardcoded at the bottom of the service. This makes simulating a successful run impossible without a live Anki instance.

**Task:**
Extract the final data persistence and Anki sync logic into the final pipeline phase.

**Acceptance Criteria:**
* Create `ExportPhase` inheriting from `PipelinePhase`.
* Move the `history_mgr.sync_session_state` and the `export_card_to_anki` loop into this class.
* The class reads the final `all_cards` and `slide_set_name` from the `SessionContext`.
* `LecternGenerationService._generate_stream` is now effectively fully strangled. It should look like a clean, 15-line procedural runner:
  ```python
  phases = [InitPhase(), ConceptPhase(), GenPhase(), ExportPhase()]
  for phase in phases:
      await phase.execute(context, emitter, ai_client)
  ```
* Write one unit test verifying that `ExportPhase` correctly halts or bypasses Anki API calls if `context.config.skip_export` is True.