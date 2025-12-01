#!/bin/bash
set -e

echo "Building Frontend..."
cd gui/frontend

# Only install if package.json changed or node_modules doesn't exist
if [ package.json -nt node_modules/.package-lock.json ] || [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
    touch node_modules/.package-lock.json
else
    echo "Skipping npm install (dependencies up to date)"
fi

npm run build
cd ../..

echo "Building Backend & Packaging..."

# Only install pyinstaller if not already installed
if ! pip show pyinstaller > /dev/null 2>&1; then
    echo "Installing pyinstaller..."
    pip install pyinstaller
else
    echo "Pyinstaller already installed"
fi

# Generate icon.icns if icon.png exists
if [ -f "icon.png" ]; then
    echo "Generating icon.icns..."
    mkdir -p icon.iconset
    sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png > /dev/null
    sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png > /dev/null
    sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png > /dev/null
    sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png > /dev/null
    sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png > /dev/null
    sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png > /dev/null
    sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png > /dev/null
    sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png > /dev/null
    sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png > /dev/null
    sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png > /dev/null
    iconutil -c icns icon.iconset
    rm -rf icon.iconset
fi

# PyInstaller with noconfirm to skip overwrite prompts
pyinstaller --name Lectern \
    --windowed \
    --icon=icon.icns \
    --add-data "gui/frontend/dist:frontend/dist" \
    --add-data "gui/backend:backend" \
    --paths . \
    --paths gui/backend \
    --hidden-import=uvicorn.logging \
    --hidden-import=uvicorn.loops \
    --hidden-import=uvicorn.loops.auto \
    --hidden-import=uvicorn.protocols \
    --hidden-import=uvicorn.protocols.http \
    --hidden-import=uvicorn.protocols.http.auto \
    --hidden-import=uvicorn.protocols.websockets \
    --hidden-import=uvicorn.protocols.websockets.auto \
    --hidden-import=uvicorn.lifespan \
    --hidden-import=uvicorn.lifespan.on \
    --hidden-import=engineio.async_drivers.aiohttp \
    --hidden-import=pywebview \
    --hidden-import=objc \
    --hidden-import=Cocoa \
    --hidden-import=WebKit \
    --noconfirm \
    gui/launcher.py

echo "Done! App is at dist/Lectern"
