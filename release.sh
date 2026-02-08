#!/bin/bash
set -e

# Lectern Release Orchestrator
# Bumps version, tags, and pushes to trigger Cloud CI/CD builds.
# Usage: ./release.sh [major|minor|patch]

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get bump type (default: patch)
BUMP_TYPE="${1:-patch}"

# Get latest tag from git, default to v0.0.0 if none
LATEST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -n1)
if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v0.0.0"
fi

# Parse version numbers
VERSION="${LATEST_TAG#v}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"

# Bump version
case "$BUMP_TYPE" in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
    *)
        echo -e "${YELLOW}Unknown bump type: $BUMP_TYPE. Use major, minor, or patch.${NC}"
        exit 1
        ;;
esac

NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}"

echo -e "${BOLD}🚀 Lectern Cloud Release Orchestrator${NC}"
echo -e "   ${BLUE}From:${NC} $LATEST_TAG"
echo -e "   ${GREEN}To:  ${NC} $NEW_VERSION"
echo ""

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️ You have uncommitted changes.${NC}"
    read -p "Commit version bump and continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Update version.py
echo "__version__ = \"${NEW_VERSION#v}\"" > version.py
git add version.py

# Update gui/backend/main.py
sed -i '' "s/version='[0-9.]*'/version='${NEW_VERSION#v}'/" gui/backend/main.py
git add gui/backend/main.py

# Update gui/frontend/package.json
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"${NEW_VERSION#v}\"/" gui/frontend/package.json
git add gui/frontend/package.json

# Commit and Tag
git commit -m "chore(release): bump version to ${NEW_VERSION#v}"
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"

echo -e "\n${BLUE}📤 Pushing to GitHub...${NC}"
git push origin main
git push origin "$NEW_VERSION"

echo -e "\n${GREEN}✨ Release Triggered! ✨${NC}"
echo -e "GitHub Actions is now building all 3 platforms (macOS, Windows, Linux)."
echo -e "Track progress here: ${BOLD}https://github.com/stegra05/Lectern/actions${NC}"
echo -e "The release will appear at: ${BOLD}https://github.com/stegra05/Lectern/releases/tag/$NEW_VERSION${NC}"
