<div align="center">

# Lectern

**AI-Powered Anki Card Generator**

[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat-square)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-black?style=flat-square)](https://www.python.org/)

<br>

Lectern transforms PDF lecture slides into high-quality Anki flashcards instantly. It parses your slides, composes a multimodal prompt for Google's Gemini, and creates notes in your running Anki instance via AnkiConnect.

<br>

<img src="docs/screenshots/setup_view.png" alt="Lectern Setup View" width="100%">

</div>

---

## Overview

Lectern is designed for students and professionals who need to rapidly convert structured documents into spaced-repetition material. By leveraging multimodal AI, it goes beyond simple text extraction to understand visual context, ensuring high-quality, concept-driven flashcard generation. The application features a clean, native desktop experience with real-time progress tracking and a dedicated review interface.

---

## Features

### Real-Time Generation
Stream cards directly into the application as they are generated, with dynamic pacing and concept mapping to ensure comprehensive coverage.

<img src="docs/screenshots/generation_progress.png" alt="Generation Progress" width="100%">

### Intelligent Review
Review generated cards, monitor page and concept coverage, and selectively sync them to your Anki database.

<img src="docs/screenshots/review_completed.png" alt="Session Overview and Concept Coverage" width="100%">

### Focused Editing
A clean, minimal interface for editing cards before finalizing them in your collection.

<img src="docs/screenshots/card_editor.png" alt="Beautiful Card Editor" width="100%">

---

## Quick Start

**[Download Lectern (macOS / Windows / Linux)](https://lectern.steffengrabert.com)**

1. Open the downloaded application. (On macOS, right-click and select "Open" on first launch).
2. Install the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on in Anki.
3. Open Settings and enter your [Gemini API Key](https://aistudio.google.com/apikey).
4. Drop a PDF into Lectern and start generating.

For full user documentation, troubleshooting, and guides, visit the [Lectern Landing Page](https://lectern.steffengrabert.com).

---

## Developer Guide

Welcome to the codebase. We maintain a comprehensive, centralized Wiki in the `docs/` folder.

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
