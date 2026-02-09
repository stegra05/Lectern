# Audit: `gui/backend/service.py` + `session.py`

**Audited:** 2026-02-09  
**Lines:** 189 + 164 = 353  
**Role:** Bridge between FastAPI routes and `LecternGenerationService`. Session lifecycle management.

## Summary

Both files are **clean and well-structured**. `service.py` is a focused async bridge with a tidy `DraftStore`. `session.py` is a thread-safe in-memory session registry. Only two minor findings — one piece of dead code and one parameter that could be tightened.

**Key actions:** Minimal. One dead code removal.

---

## Findings

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 11 | session | 🟢 | `SESSION_TTL_SECONDS = 60 * 60 * 4` — 4 hours. Desktop app doesn't need "server-style" in-memory pruning. The cards are on disk; memory impact is trivial. The only value is cleaning up `/tmp` PDFs. | **REFACTOR** — remove TTL-based pruning. Clean up temp files explicitly on session completion/failure. |
| 153-161 | session | 🟡 | `_get_runtime_or_404` fallback: `hasattr(session, "draft_store")` checks attributes that `SessionState` (a dataclass) never has. `draft_store` and `generation_service` live on `SessionRuntime`, not `SessionState`. This fallback is **always False** — dead defensive code. | **CUT** — simplify to just raise 404 if no runtime found. |
| 34-47 | service | 🟢 | `DraftStore._persist_state` spreads entire state cache minus `"cards"` as kwargs to `update_cards()`. Works but is fragile — if state dict gains a key that doesn't match a parameter name, it'd crash. | **KEEP** — minor fragility, not worth refactoring now. |
| 139-140 | service | 🟢 | `skip_export=True` and `resume=True` are hardcoded. Confirms findings from `lectern_service.md` audit: GUI always uses draft mode and always attempts resume. The resume concern (new session IDs won't match old state files) remains a **VERIFY** from the service audit. | **KEEP** — no action here, tracked in `lectern_service.md`. |

---

## Resolved Questions from Prior Audits

| Original Finding | Resolution |
|-----------------|------------|
| `lectern_service.md` Theme 2: "Is `skip_export` dead code?" | **No.** `service.py:140` hardcodes `skip_export=True`. This is the primary GUI path. Confirmed used. |
| `lectern_service.md` Theme 2: "Is resume logic used?" | **Partially.** `service.py:139` passes `resume=True`, but `create_session` (session.py:49) generates a fresh `uuid4().hex` every time. The resume logic in `lectern_service.py` loads state by `session_id`, which won't match a previous run's ID. **Resume is effectively dead in the GUI flow.** |
