---
description: Create and publish a new release with changelog
---

1. **Verification Phase**
   - Run backend tests: `pytest tests/` (root dir)
   - Run frontend tests: `npm test` (in `gui/frontend`)
   - Ensure CI/CD workflow exists: `.github/workflows/build.yml`

2. **Changelog Update**
   - Identify last tag: `git tag -l 'v*' --sort=-v:refname | head -n1`
   - Fetch commit history: `git log <last_tag>..HEAD --pretty=format:"- %s (%h)"`
   - Prepend new version entry to `CHANGELOG.md`:
     ```markdown
     ## [X.Y.Z] - YYYY-MM-DD
     ### Added/Changed/Fixed
     - [Commit message]
     ```
   - Commit the changelog: `git commit -am "docs: update changelog for vX.Y.Z"`

3. **Release Trigger**
   - Run orchestrator: `./release.sh [major|minor|patch]`
     - This script will bump version, commit, tag, and push.
   
4. **Post-Release**
   - Monitor GitHub Actions URL provided by the script output.
