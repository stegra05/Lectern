#!/bin/bash
set -e

echo "Building Frontend..."
cd gui/frontend
npm install
npm run build
cd ../..

echo "Building Backend & Packaging..."
pip install pyinstaller
pyinstaller --name Lectern \
    --onefile \
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
    gui/launcher.py

echo "Done! App is at dist/Lectern"
