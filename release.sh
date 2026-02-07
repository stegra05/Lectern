#!/bin/bash
set -e

# Lectern Release Script
# Usage: ./release.sh [major|minor|patch]
# Default: patch

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get bump type (default: patch)
BUMP_TYPE="${1:-patch}"

# Get latest tag, default to v0.0.0 if none
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

echo -e "${BOLD}🚀 Lectern Release${NC}"
echo -e "   ${BLUE}Previous:${NC} $LATEST_TAG"
echo -e "   ${GREEN}New:${NC}      $NEW_VERSION"
echo ""

# Confirm
read -p "Proceed? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}Warning: You have uncommitted changes.${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Build
echo -e "\n${BLUE}📦 Building...${NC}"
./build_app.sh

echo -e "\n${BLUE}💿 Creating DMG...${NC}"
./create_dmg.sh

# Tag
echo -e "\n${BLUE}🏷  Tagging $NEW_VERSION...${NC}"
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"
git push origin "$NEW_VERSION"

# Create GitHub Release
echo -e "\n${BLUE}📤 Creating GitHub Release...${NC}"

RELEASE_NOTES="## What's New

- See commit history for changes since $LATEST_TAG

## Installation

1. Download \`Lectern.dmg\` below
2. Open the DMG and drag Lectern to **Applications**
3. **First launch:** Right-click → Open (bypasses Gatekeeper)

## Requirements

- [Anki](https://apps.ankiweb.net/) with [AnkiConnect](https://ankiweb.net/shared/info/2055492159)
- Poppler: \`brew install poppler\`
- [Gemini API Key](https://aistudio.google.com/apikey) (free tier available)"

gh release create "$NEW_VERSION" \
    --title "Lectern $NEW_VERSION" \
    --notes "$RELEASE_NOTES" \
    dist/Lectern.dmg

echo -e "\n${GREEN}✨ Released $NEW_VERSION!${NC}"
echo -e "   https://github.com/stegra05/Lectern/releases/tag/$NEW_VERSION"
