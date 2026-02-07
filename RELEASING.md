# Releasing Lectern

Manual release workflow for publishing new versions.

## Prerequisites

- Clean working directory (`git status` shows no changes)
- All tests passing
- Anki + AnkiConnect running (for final smoke test)

## Release Steps

### 1. Bump Version

Update version in `config.py` if applicable.

### 2. Build

```bash
./build_app.sh      # Creates dist/Lectern.app
./create_dmg.sh     # Creates dist/Lectern.dmg
```

### 3. Smoke Test

Open `dist/Lectern.app` and verify:
- [ ] App launches without crashes
- [ ] Can load a PDF
- [ ] Generation starts (test with 1-2 slides)
- [ ] Cards appear in Anki

### 4. Tag & Push

```bash
git tag -a v1.X.X -m "Release v1.X.X"
git push origin v1.X.X
```

### 5. Create GitHub Release

1. Go to **Releases** → **Draft a new release**
2. Select the tag you just pushed
3. Title: `Lectern v1.X.X`
4. Attach: `dist/Lectern.dmg`
5. Release notes template:

```markdown
## What's New
- Feature 1
- Fix 2

## Installation
1. Download `Lectern.dmg`
2. Open the DMG and drag Lectern to Applications
3. First launch: Right-click → Open (macOS Gatekeeper)

**Requires:** Anki with [AnkiConnect](https://ankiweb.net/shared/info/2055492159), Poppler (`brew install poppler`)
```

6. Publish!

## Gatekeeper Note

Since the app isn't notarized, users will see a warning on first launch. Instruct them to:
1. Right-click (or Ctrl+click) on Lectern.app
2. Select "Open"
3. Click "Open" in the dialog

This only needs to be done once.
