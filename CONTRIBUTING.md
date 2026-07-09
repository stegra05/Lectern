# Contributing to Lectern

Thanks for your interest! Lectern is a small, focused codebase (~6k LOC including
tests). Bug reports, card-quality feedback, and PRs are all welcome.

## Dev setup

Prerequisites: [Node 22+](https://nodejs.org), [pnpm](https://pnpm.io),
[Rust](https://rustup.rs) (for the Tauri shell), and the
[Tauri 2 system dependencies](https://tauri.app/start/prerequisites/) for your platform.

```sh
pnpm install
pnpm tauri dev        # full desktop app
pnpm dev              # browser-only mode (UI work, no keychain/native dialogs)
```

Browser mode falls back gracefully where Tauri APIs are unavailable
(`src/lib/platform.ts`), and exposes the Zustand store as `window.__lectern`
for debugging and UI automation.

## Checks

```sh
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest (offline; live API tests are skipped by default)
pnpm lint             # eslint (typescript-eslint type-aware + react-hooks)
pnpm format           # prettier (no semis, single quotes, printWidth 100)
pnpm format:check     # prettier check only (what CI runs)
```

CI runs lint, format check, tests, the production build, and `cargo fmt`/`clippy`
on every PR. A pre-commit hook (installed automatically by `pnpm install` via the
`prepare` script, see `.githooks/`) checks formatting and lint on exactly the
staged files; bypass a single commit with `git commit -n`.

## Code layout

```
src/engine/    the pipeline (pure TS, no UI imports)
src/state/     one Zustand store; pipeline events land as direct state writes
src/components/  React views
src-tauri/     thin Rust shell: keychain, CORS-free fetch, dialogs
```

Design rules for UI work: colors, type sizes, radii, and shadows come from the
tokens in `src/index.css`; no arbitrary `text-[..px]` or ad-hoc shadows. Sans
(Schibsted Grotesk) is for controls, serif (Source Serif 4) for study content,
mono (IBM Plex Mono) for metadata/provenance.

## Commits

Short conventional-style subjects (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`),
imperative mood, ≤72 chars.

## Reporting bugs

Use the bug report template. For generation-quality issues, include the model,
the document type (slides vs. script), and, if you can share it, the source PDF
or the page in question.
