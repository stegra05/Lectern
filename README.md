<div align="center">

# LECTERN

**AI-Powered Anki Card Generator**

[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat-square)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-black?style=flat-square)](https://www.python.org/)

<br>

Lectern transforms PDF lecture slides into high-quality Anki flashcards instantly. It parses your slides, composes a multimodal prompt for Google's Gemini, and creates notes in your running Anki instance via AnkiConnect.

</div>

---

## ⚡️ Quick Start

**[Download Lectern (macOS / Windows / Linux)](https://lectern.steffengrabert.com)**

1. Open the downloaded application. (On macOS, right-click and select "Open" on first launch).
2. Install the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on in Anki.
3. Open Settings and enter your [Gemini API Key](https://aistudio.google.com/apikey).
4. Drop a PDF into Lectern and start generating!

👉 **For full user documentation, troubleshooting, and guides, visit the [Lectern Landing Page](https://lectern.steffengrabert.com).**

---

## 🛠 Developer & AI Agent Guide

Welcome to the codebase! We maintain a comprehensive, centralized Wiki in the `docs/` folder.

- **[System Architecture](docs/ARCHITECTURE.md):** The 10,000-foot view (diagrams, data flow).
- **[Development Guide](docs/DEVELOPMENT.md):** Local setup, running the app, testing, and CI/CD.
- **[Design System](docs/DESIGN_SYSTEM.md):** The UI/UX philosophy and Tailwind conventions.
- **[AI Pipeline](docs/AI_PIPELINE.md):** Gemini integration, the 3-phase loop, and pacing strategy.
- **[Frontend Architecture](docs/FRONTEND.md):** React, Zustand state management, and V2 NDJSON event streaming.
- **[Backend Architecture](docs/BACKEND.md):** FastAPI routing, PyWebView wrapper, and AnkiConnect.

<br>

<div align="center">
  <sub>Built by Steffen</sub>
</div>
