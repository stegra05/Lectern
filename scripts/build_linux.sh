#!/bin/bash
# Lectern Build Script (Linux)
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

header() { echo -e "\n${BOLD}${BLUE}=== $1 ===${NC}\n"; }
success() { echo -e "${GREEN}✔${NC} $1"; }
error() { echo -e "${RED}✖${NC} $1"; exit 1; }

# Pre-flight checks
header "Pre-flight Checks"
command -v node >/dev/null 2>&1 || error "node not found"
command -v npm >/dev/null 2>&1 || error "npm not found"
command -v python3 >/dev/null 2>&1 || error "python3 not found"
success "All tools found"

# Preparation
header "Preparation"
rm -rf dist gui/frontend/dist
success "Cleaned previous builds"

# Frontend
header "Frontend"
cd gui/frontend
echo "Installing npm dependencies..."
npm install
echo "Building React App..."
npm run build
cd ../..

# Backend
header "Backend"
echo "Installing Python dependencies..."
pip3 install -r requirements.txt
python3 -m pip show pyinstaller >/dev/null 2>&1 || pip3 install pyinstaller

# Packaging
header "Packaging"
echo "Compiling Binary (this may take a while)..."
python3 -m PyInstaller Lectern.linux.spec --noconfirm

# Verify Artifact
if [ -f "dist/Lectern/Lectern" ]; then
    header "✨ Build Complete! ✨"
    echo -e "📂 Artifact: ${GREEN}dist/Lectern/Lectern${NC}"
else
    error "Build finished but dist/Lectern/Lectern was not found."
fi
