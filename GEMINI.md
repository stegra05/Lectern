# Gemini Integration

This document covers how Lectern integrates with Gemini and where to find session logs.

## Session Logging

Lectern records each Gemini session (concept map, generation, reflection) to a JSON log file.

- **Path (macOS):** `~/Library/Application Support/Lectern/logs/session-*.json`
- **When created:** At the start of each AI session.
- **What they contain:** Request/response snapshots for debugging prompt quality and schema errors.
- **When to check:** If generation or reflection fails, or to audit the model output.
# Lectern - AI Lecture to Anki Converter

Lectern is a high-velocity tool designed to transform unstructured lecture slides (PDFs) into structured, high-quality Anki flashcards using Google's Gemini Multimodal AI.

## Project Overview

Lectern follows a modular pipeline architecture to ensure high-yield card generation with minimal user friction:

1.  **PDF Parser (`pdf_parser.py`):** Extracts text and images (converted to base64) from PDF slides using `PyMuPDF`.
2.  **AI Client (`ai_client.py`):** Interfaces with Google's Gemini API. It uses multimodal prompting to "see" slides and builds a **Global Concept Map** to maintain coherence.
3.  **Service Layer (`lectern_service.py`):** The central orchestrator. Manages state, handles "resume" functionality, applies **Pacing Strategies** based on content type (Slides vs Script), and emits events.
4.  **Interfaces:**
    *   **GUI (`gui/`):** A modern desktop application built with React (frontend) and FastAPI (backend), wrapped in `pywebview`.

## Core Technologies

-   **Backend:** Python 3.10+, FastAPI, Uvicorn, PyMuPDF, `google-genai`, `pywebview`, `keyring`.
-   **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Lucide React.
-   **AI:** Google Gemini (Multimodal).
-   **Integration:** AnkiConnect (External REST API for Anki).

## Building and Running

### Prerequisites

-   Anki installed with the [AnkiConnect](https://ankiweb.net/shared/info/2055079234) add-on.
-   A Google Gemini API Key.

### Setup

1.  **Python Environment:**
    ```bash
    python -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    ```
2.  **Frontend Setup (for GUI development):**
    ```bash
    cd gui/frontend
    npm install
    ```
3.  **API Key Setup:**
    Check the App Settings in the GUI.

### Running

-   **CLI Mode:**
    (Removed)
-   **GUI Mode:**
    ```bash
    python gui/launcher.py
    ```
-   **Cost Estimation:**
    (Available via GUI/API)

## Development Conventions

-   **Service Pattern:** Core business logic resides in `lectern_service.py`. The GUI acts as a consumer of the `ServiceEvent` generator.
-   **State Management:** Use `utils/state.py` to persist progress. The application supports resuming interrupted sessions.
-   **AI Pacing:** `ai_pacing.py` manages generation speed and detail based on content density.
-   **Prompt Centralization:** All LLM prompts are centralized in `ai_prompts.py` to ensure consistency and ease of editing.
-   **Multimodal AI:** Always provide both text and images to the AI for better context.
-   **Functional Frontend:** React components are functional and styled with Tailwind CSS. Follow the "Glassmorphism" aesthetic established in `gui/frontend/src/components/GlassCard.tsx`.
-   **Security:** Never store API keys in code or `.env` files. Use `utils/keychain_manager.py` (keyring).
-   **Hardware:** Optimized for Apple Silicon (MPS) if applicable, though primarily CPU/API bound.

## Directory Structure

-   `/gui`: Contains the FastAPI backend and React frontend.
-   `/utils`: Shared utilities for state, history, and Anki integration.
-   `/docs`: Architectural deep-dives and design goals.
-   `lectern_service.py`: The heart of the application logic.
