<div align="center">

# LECTERN

**AI-Powered Anki Card Generator**

[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat-square)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-black?style=flat-square)](https://www.python.org/)
[![Code Style: Black](https://img.shields.io/badge/code%20style-black-black?style=flat-square)](https://github.com/psf/black)

<br>

Lectern transforms PDF lecture slides into high-quality Anki flashcards instantly.  
It parses your slides, composes a multimodal prompt for Google's Gemini, and creates notes in your running Anki instance via AnkiConnect.

[Get Started](#installation) • [Usage](#usage) • [Configuration](#configuration)

</div>

---

## Features

- **Multimodal Analysis**  
  Extracts text and images from slides, preserving context for accurate generation.

- **Smart Generation**  
  Leverages Gemini Pro to create atomic, well-structured cards that adhere to learning best practices.

- **Style Matching**  
  Intelligently samples existing cards to match your deck's aesthetic and formatting.

- **Dual Interface**  
  Includes a robust CLI for power users and a sleek, modern GUI for interactive workflows.

- **Safe Execution**  
  Operates exclusively via the AnkiConnect API, ensuring your collection files remain untouched.

---

## Installation

### Prerequisites

- **Python 3.9+**
- **Anki** with [AnkiConnect](https://ankiweb.net/shared/info/2055492159) installed.
- **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/api-keys).

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/lectern.git
cd lectern

# Create virtual environment
python -m venv .venv && source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### Build from Source

To create a standalone macOS application (`Lectern.app`):

```bash
./build_app.sh
```
The artifact will be available in `dist/Lectern.app`.

---

## Usage

### Graphical Interface

The recommended way to use Lectern. Launches a local web server with a modern UI.

```bash
python gui/launcher.py
```
*Opens automatically at `http://127.0.0.1:8000`*

### Command Line

For automation, batch processing, and headless environments.

```bash
# Basic usage
python main.py --pdf-path /path/to/slides.pdf --deck-name "Target Deck"

# With style matching from another deck
python main.py \
  --pdf-path lecture_01.pdf \
  --deck-name "Biology 101" \
  --context-deck "Biology 101::Previous"
```

---

## Configuration

Configure defaults in `.env` or override via flags.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Required**. Your Google AI API key. | - |
| `ANKI_CONNECT_URL` | URL of AnkiConnect API. | `http://localhost:8765` |
| `BASIC_MODEL_NAME` | Anki Note Type for basic cards. | `prettify-nord-basic` |
| `CLOZE_MODEL_NAME` | Anki Note Type for cloze cards. | `prettify-nord-cloze` |

<br>

<div align="center">
  <sub>Built by Steffen</sub>
</div>
