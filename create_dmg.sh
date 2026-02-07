#!/bin/bash
set -e

# Lectern DMG Creator
# Creates a polished drag-to-install disk image

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_PATH="dist/Lectern.app"
DMG_NAME="Lectern.dmg"
VOLUME_NAME="Lectern"

if [ ! -d "$APP_PATH" ]; then
    echo -e "${BOLD}Error:${NC} $APP_PATH not found. Run ./build_app.sh first."
    exit 1
fi

echo -e "${BLUE}📦 Creating DMG...${NC}"

# Check for create-dmg, install if missing
if ! command -v create-dmg &> /dev/null; then
    echo "Installing create-dmg via Homebrew..."
    brew install create-dmg
fi

# Clean previous DMG
rm -f "dist/$DMG_NAME"

# Create DMG with Applications symlink
create-dmg \
    --volname "$VOLUME_NAME" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "Lectern.app" 150 190 \
    --app-drop-link 450 190 \
    --hide-extension "Lectern.app" \
    "dist/$DMG_NAME" \
    "$APP_PATH"

echo -e "${GREEN}✨ Created:${NC} dist/$DMG_NAME"
echo -e "Ready to upload to GitHub Releases!"
