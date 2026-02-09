<div align="center">

# LECTERN

**AI-Powered Anki Card Generator**

[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat-square)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-black?style=flat-square)](https://www.python.org/)
[![Code Style: Black](https://img.shields.io/badge/code%20style-black-black?style=flat-square)](https://github.com/psf/black)

<br>

Lectern transforms PDF lecture slides into high-quality Anki flashcards instantly.  
It parses your slides, composes a multimodal prompt for Google's Gemini, and creates notes in your running Anki instance via AnkiConnect.

[Quick Start](#quick-start) | [Features](#features) | [Configuration](#configuration) | [Advanced](#advanced-usage)

<br>

![Dashboard](docs/screenshots/dashboard.png)

</div>

---

## Quick Start

### 1. Download

**[Download Lectern (macOS / Windows / Linux)](https://github.com/stegra05/lectern/releases/latest)**

### 2. Install

1. Open `Lectern.dmg` and drag Lectern to **Applications**
2. Install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on in Anki

### 3. First Launch

1. **Right-click Lectern.app and select "Open"** (bypasses Gatekeeper warning on first run)
2. Open Settings and enter your [Gemini API Key](https://aistudio.google.com/apikey) (free tier available)
3. Make sure Anki is running
4. Drop a PDF and start generating cards

---

## Features

### Source Selection
Choose between **Slides** (visual), **Script** (dense text), or **Auto** mode to optimize card generation strategy for your content.

### Smart Pacing
Dynamically adjusts generation speed and detail based on content density, ensuring no concept is skipped.

### Multimodal Analysis
Extracts text and images from slides using `pypdf` + `pypdfium2`, preserving context for accurate generation.

### Smart Generation
Leverages **Gemini 3.0 Flash** to create atomic, well-structured cards that adhere to learning best practices.

### Live Preview
Review and edit generated cards before syncing to Anki. Filter by card type, search content, and delete unwanted cards.

### Safe Execution
Operates exclusively via the AnkiConnect API, ensuring your collection files remain untouched.

---

## Configuration

Most settings are configured directly in the **Settings** panel within the application:

| Setting | Description |
| :--- | :--- |
| **Gemini API Key** | Required. Get one free from [Google AI Studio](https://aistudio.google.com/apikey) |
| **AI Model** | Choose between Gemini models (Flash recommended) |
| **Anki Note Types** | Configure which note types to use for Basic and Cloze cards |

### Environment Variables (Optional)

For advanced users, defaults can be set via environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Alternative to GUI setting | - |
| `ANKI_CONNECT_URL` | URL of AnkiConnect API | `http://localhost:8765` |
| `BASIC_MODEL_NAME` | Anki Note Type for basic cards | `Basic` |
| `CLOZE_MODEL_NAME` | Anki Note Type for cloze cards | `Cloze` |

---

## Logs

Lectern writes AI session logs for debugging:

- **macOS:** `~/Library/Application Support/Lectern/logs/`
- **Windows:** `%APPDATA%\Lectern\logs\`
- **Linux:** `~/.config/lectern/logs/`

Contents: Request/response snapshots for concept map, generation, and reflection. Check these if card generation fails or you need to inspect AI prompts.

---

## Advanced Usage

### Tech Stack

- **AI Core:** Google Gemini 3.0 Flash (Multimodal)
- **Backend:** Python, FastAPI, Uvicorn
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Framer Motion
- **Desktop Wrapper:** PyWebView (Cocoa/WebKit)
- **PDF Engine:** pypdf + pypdfium2
- **Security:** Keyring

### Build from Source

#### Prerequisites

- Python 3.9+
- Node.js 18+

#### Setup

```bash
# Clone the repository
git clone https://github.com/stegra05/lectern.git
cd lectern

# Create virtual environment
python -m venv .venv

# Activate venv
# macOS/Linux:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd gui/frontend && npm install && cd ../..
```

#### Run in Development Mode

```bash
python gui/launcher.py
```

#### Build Application Bundle

```bash
# macOS
./build_app.sh      # Creates dist/Lectern.app
./create_dmg.sh     # Creates dist/Lectern.dmg

# Windows (run in PowerShell)
.\build_windows.ps1 # Creates dist/Lectern/Lectern.exe

# Linux
./build_linux.sh    # Creates dist/Lectern (directory)
```

---

## Documentation

- **[System Architecture](docs/ARCHITECTURE.md)** - How Lectern works under the hood
- **[Contributing Guide](CONTRIBUTING.md)** - Guidelines for developers
- **[Frontend Docs](gui/frontend/README.md)** - React GUI documentation
- **[Release Process](RELEASING.md)** - How to publish new versions

<br>

<div align="center">
  <sub>Built by Steffen</sub>
</div>
