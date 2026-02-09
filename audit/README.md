# Lectern Code Audit

**Started:** 2026-02-09  
**Author:** Steffen (with AI pair review)

A file-by-file code audit of the Lectern codebase. Each document covers one file (or a sensible group) and organizes findings by theme.

## Legend

| Severity | Meaning |
|----------|---------|
| 🔴 Bug | Incorrect behavior or inconsistency that causes wrong results |
| 🟡 Concern | Code smell, unnecessary complexity, or questionable design |
| 🟢 Note | Observation worth documenting but not actionable now |

| Verdict | Meaning |
|---------|---------|
| **CUT** | Remove this code/config entirely |
| **REFACTOR** | Keep the intent, rewrite the implementation |
| **VERIFY** | Needs testing or external confirmation before deciding |
| **KEEP** | Intentional design, leave as-is |

## Files Audited

| File | Status |
|------|--------|
| [`lectern_service.py`](./lectern_service.md) | ✅ Done |
| [`ai_layer`](./ai_layer.md) | ✅ Done |
| [`gui_backend`](./gui_backend.md) | ✅ Done |
| [`config_parser`](./config_parser.md) | ✅ Done |
| [`anki_integration`](./anki_integration.md) | ✅ Done |
| [`frontend`](./frontend.md) | ✅ Done |
