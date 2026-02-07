#!/bin/bash
set -e

# Colors and Formatting
BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Logging Functions
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✔${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✖${NC} $1"; }
header() { echo -e "\n${BOLD}${BLUE}=== $1 ===${NC}\n"; }

# Check for required tools
check_tool() {
    if ! command -v $1 &> /dev/null; then
        error "$1 is not installed or not in PATH."
        exit 1
    fi
}

# Warn-only tool check (non-fatal)
warn_tool() {
    if ! command -v $1 &> /dev/null; then
        warn "$1 not found. Some PDF features may be unavailable."
    fi
}

# Spinner Function
spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='|/-\'
    while kill -0 $pid 2>/dev/null; do
        local temp=${spinstr#?}
        printf " [%c] " "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b"
    done
    printf "    \b\b\b\b"
}

# Run command with spinner and log
run_step() {
    local msg="$1"
    local cmd="$2"
    
    echo -ne "${BOLD}→${NC} $msg... "
    
    # Run command in background
    # We use a subshell to capture exit code correctly
    (eval "$cmd") >> "$LOG_FILE" 2>&1 &
    local pid=$!
    
    # Show spinner
    spinner $pid
    
    # Wait and capture exit code without 'set -e' killing the script
    set +e
    wait $pid
    local exit_code=$?
    set -e
    
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}DONE${NC}"
    else
        echo -e "${RED}FAILED${NC}"
        error "Check build.log for details."
        echo -e "${DIM}Last 10 lines of build.log:${NC}"
        tail -n 10 "$LOG_FILE"
        exit 1
    fi
}

# Start
clear
echo -e "${BOLD}🚀 Lectern Build System${NC}"
echo -e "${DIM}Starting build process...${NC}\n"

# Initialize absolute log
PROJECT_ROOT=$(pwd)
LOG_FILE="$PROJECT_ROOT/build.log"
echo "Build started at $(date)" > "$LOG_FILE"

start_time=$(date +%s)

# Pre-flight checks
header "Pre-flight Checks"
check_tool "node"
check_tool "npm"
check_tool "python"
warn_tool "pdftoppm"
warn_tool "tesseract"
success "All tools found"

# Preparation
header "Preparation"
# Unmount any mounted Lectern DMGs first (prevents "Directory not empty" errors)
for vol in /Volumes/Lectern*; do
    [ -d "$vol" ] && hdiutil detach "$vol" -quiet 2>/dev/null || true
done
# Keep build/ for PyInstaller cache to speed up subsequent builds
run_step "Cleaning previous builds" "rm -rf dist gui/frontend/dist"

# Frontend
header "Frontend"
cd gui/frontend
run_step "Installing npm dependencies" "npm install"
run_step "Building React App" "npm run build"
cd ../..

# Backend
header "Backend"
if ! python -m pip show pyinstaller > /dev/null 2>&1; then
    run_step "Installing PyInstaller" "python -m pip install pyinstaller"
else
    info "PyInstaller already installed"
fi
run_step "Installing Python dependencies" "python -m pip install -r requirements.txt"

# Icons
header "Assets"
if [ -f "icon.png" ]; then
    run_step "Generating App Icons" "
        mkdir -p icon.iconset &&
        sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png &&
        sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png &&
        sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png &&
        sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png &&
        sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png &&
        sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png &&
        sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png &&
        sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png &&
        sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png &&
        sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png &&
        iconutil -c icns icon.iconset &&
        rm -rf icon.iconset
    "
else
    warn "No icon.png found, skipping icon generation"
fi

# Packaging
header "Packaging"

PYINSTALLER_CMD="python -m PyInstaller Lectern.spec --noconfirm"

run_step "Compiling Binary - this may take a while" "$PYINSTALLER_CMD"

# Verify Artifact
if [ -d "dist/Lectern.app" ]; then
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    echo -e "\n${GREEN}${BOLD}✨ Build Complete! ✨${NC}"
    echo -e "📂 App Bundle: ${BOLD}dist/Lectern.app${NC}"
    echo -e "⏱  Time: ${duration}s"
    echo -e "📝 Log: build.log\n"
else
    error "Build finished but dist/Lectern.app was not found."
    exit 1
fi
