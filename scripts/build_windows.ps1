# Lectern Build Script (Windows)
# Requires: Node.js, Python 3.10+, PowerShell 5.1+

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

function Command-Succeeds {
    param(
        [scriptblock]$Command
    )

    try {
        & $Command *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

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

function Verify-WindowsBundle {
    param(
        [string]$BundleRoot
    )

    Write-Header "Bundle Verification"

    $required = @("Lectern.exe")

    $internalDir = $null
    foreach ($candidate in @("_internal", "Lectern_internal")) {
        $candidatePath = Join-Path $BundleRoot $candidate
        if (Test-Path $candidatePath) {
            $internalDir = $candidate
            break
        }
    }

    if (-not $internalDir) {
        Write-Error-Custom "Missing internal runtime folder (_internal or Lectern_internal)"
    }

    $required += @(
        "$internalDir\pythonnet\runtime\Python.Runtime.dll",
        "$internalDir\webview\lib\Microsoft.Web.WebView2.Core.dll",
        "$internalDir\webview\lib\Microsoft.Web.WebView2.WinForms.dll"
    )

    foreach ($relativePath in $required) {
        $fullPath = Join-Path $BundleRoot $relativePath
        if (-not (Test-Path $fullPath)) {
            Write-Error-Custom "Missing runtime artifact: $relativePath"
        }
    }

    $webview2RuntimePath = Join-Path $BundleRoot "webview2-runtime"
    if (Test-Path $webview2RuntimePath) {
        Write-Success "Optional bundled WebView2 runtime detected"
    } else {
        Write-Host "ℹ Optional bundled WebView2 runtime not found (system runtime required)" -ForegroundColor Yellow
    }

    Write-Success "Windows bundle runtime artifacts verified"
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
if (-not (Command-Succeeds { python -m pip show pyinstaller })) {
    python -m pip install pyinstaller
}

# Packaging
Write-Header "Packaging"
Write-Host "Compiling Binary (this may take a while)..."
python -m PyInstaller specs/Lectern.windows.spec --noconfirm

# Verify Artifact
if (Test-Path dist\Lectern\Lectern.exe) {
    Verify-WindowsBundle -BundleRoot "dist\Lectern"
    Write-Header "✨ Build Complete! ✨"
    Write-Host "📂 Artifact: dist\Lectern\Lectern.exe" -ForegroundColor Green
} else {
    Write-Error-Custom "Build finished but dist\Lectern\Lectern.exe was not found."
}
