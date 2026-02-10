# Lectern Build Script (Windows)
# Requires: Node.js, Python 3.10+, PowerShell 5.1+

$ErrorActionPreference = "Stop"

function Write-Header($msg) {
    Write-Host "`n=== $msg ===`n" -ForegroundColor Cyan -Style Bold
}

function Write-Success($msg) {
    Write-Host "✔ $msg" -ForegroundColor Green
}

function Write-Error-Custom($msg) {
    Write-Host "✖ $msg" -ForegroundColor Red
    exit 1
}

# Pre-flight checks
Write-Header "Pre-flight Checks"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error-Custom "node not found" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Error-Custom "npm not found" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Write-Error-Custom "python not found" }
Write-Success "All tools found"

# Preparation
Write-Header "Preparation"
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
if (Test-Path gui\frontend\dist) { Remove-Item -Recurse -Force gui\frontend\dist }
Write-Success "Cleaned previous builds"

# Frontend
Write-Header "Frontend"
Set-Location gui\frontend
Write-Host "Installing npm dependencies..."
npm install
Write-Host "Building React App..."
npm run build
Set-Location ..\..

# Backend
Write-Header "Backend"
Write-Host "Installing Python dependencies..."
python -m pip install -r requirements.txt
if (-not (python -m pip show pyinstaller)) {
    python -m pip install pyinstaller
}

# Packaging
Write-Header "Packaging"
Write-Host "Compiling Binary (this may take a while)..."
python -m PyInstaller specs/Lectern.windows.spec --noconfirm

# Verify Artifact
if (Test-Path dist\Lectern\Lectern.exe) {
    Write-Header "✨ Build Complete! ✨"
    Write-Host "📂 Artifact: dist\Lectern\Lectern.exe" -ForegroundColor Green
} else {
    Write-Error-Custom "Build finished but dist\Lectern\Lectern.exe was not found."
}
