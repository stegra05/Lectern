# Releasing Lectern

Manual release workflow for publishing new versions.

## Prerequisites

- Clean working directory (`git status` shows no changes)
- All tests passing
- Anki + AnkiConnect running (for final smoke test)

## Release Steps

### 1. Run Release Script

Everything is automated—building, tagging, and publishing. Run the orchestrator from your macOS terminal:

```bash
# Bumps version, tags, and triggers Cloud CI/CD
./release.sh [major|minor|patch]
```

### 2. Monitor Builds

Monitor the progress on [GitHub Actions](https://github.com/stegra05/Lectern/actions). The script will provide a direct link at the end.

### 3. Verify Release

Once Actions completes (approx. 5-8 minutes), verify the [Releases page](https://github.com/stegra05/Lectern/releases):
- [ ] Tag matches `version.py`
- [ ] Release contains 3 artifacts: `.dmg` (macOS), `.zip` (Windows), `.tar.gz` (Linux)
- [ ] Release notes are automatically generated from commit history


## Gatekeeper Note

Since the app is not notarized, users will see a warning on first launch. Instruct them to:
1. Right-click (or Ctrl+click) on Lectern.app
2. Select "Open"
3. Click "Open" in the dialog

This only needs to be done once.
