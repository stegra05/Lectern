# CI/CD Guide

This document defines the zero-cost CI/CD strategy for Lectern on a public GitHub repository.

## Goals

- Fast PR feedback for contributors.
- Reliable cross-platform release artifacts.
- Baseline security gates using free tooling.
- Maintainable workflows with clear responsibilities.

## Workflow Topology

| Workflow | Trigger | Purpose | Blocking |
| --- | --- | --- | --- |
| `pr-fast.yml` | PR to `main` | Fast code quality checks (lint, typecheck, unit, OpenAPI sync) | Yes |
| `pr-integration.yml` | PR to `main` | Critical E2E and integrated smoke checks | Yes |
| `security.yml` | PR, push to `main`, weekly cron | Dependency review, secret scan, CodeQL, dependency audits | Mixed |
| `build-release.yml` | Tags `v*`, manual dispatch | Build and publish macOS/Windows/Linux releases | Release only |
| `nightly-quality.yml` | Nightly cron, manual dispatch | Deep non-blocking quality sweeps | No |

## Required PR Checks

Configure branch protection on `main` to require these checks:

- `frontend-quality` (from `pr-fast.yml`)
- `backend-quality` (from `pr-fast.yml`)
- `openapi-sync` (from `pr-fast.yml`)
- `critical-e2e` (from `pr-integration.yml`)
- `integrated-smoke` (from `pr-integration.yml`)
- `dependency-review` (from `security.yml`)
- `secret-scan` (from `security.yml`)

CodeQL rollout policy:

- Week 1 after rollout: advisory only.
- After one stable week: add `codeql` to required checks.

## Free Security Tooling

- Dependency risk: `actions/dependency-review-action`.
- Secret scanning: `gitleaks` with repo config in `.gitleaks.toml`.
- SAST: GitHub CodeQL (`python`, `javascript`) with config in `.github/codeql/codeql-config.yml`.
- Dependency audits (advisory): `pip-audit`, `npm audit`.

## Release Pipeline

`build-release.yml` runs on version tags and:

1. Builds platform artifacts with existing scripts in `scripts/`.
2. Generates SHA-256 checksums for produced archives.
3. Creates build provenance attestations.
4. Generates a release SBOM.
5. Publishes artifacts to GitHub Releases.

## Dependabot Policy

`/.github/dependabot.yml` enables weekly updates for:

- GitHub Actions
- Python dependencies (`requirements.txt`)
- Frontend npm dependencies (`gui/frontend`)

Suggested handling:

- Auto-merge patch updates only when all required checks pass.
- Manually review minor and major updates.

## Local Reproduction Commands

Run locally before pushing large changes:

```bash
# Frontend fast checks
cd gui/frontend
npm ci
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npm test -- --run

# Backend tests
cd ../..
python -m pip install -r requirements.txt
pytest tests/ -q
```

OpenAPI sync check:

```bash
uvicorn gui.backend.main:app --port 8000 --host 127.0.0.1
cd gui/frontend
npm ci
npm run generate-api
git diff -- src/generated/api.ts
```

Integrated smoke check:

```bash
# Terminal 1
uvicorn gui.backend.main:app --port 8000 --host 127.0.0.1

# Terminal 2
cd gui/frontend
VITE_API_URL=http://127.0.0.1:8000 npm run dev -- --host 127.0.0.1 --port 5173

# Terminal 3
cd gui/frontend
npx playwright install --with-deps chromium
npm run test:e2e:integrated
```

## Troubleshooting

- `openapi-sync` fails: regenerate and commit `gui/frontend/src/generated/api.ts`.
- `critical-e2e` fails: inspect Playwright artifacts from workflow run.
- `integrated-smoke` fails quickly: verify backend `/health` and `VITE_API_URL`.
- `secret-scan` fails: remove leaked secret and rotate credential if real.
- `codeql` fails after rule updates: inspect Security tab findings and patch root cause.
