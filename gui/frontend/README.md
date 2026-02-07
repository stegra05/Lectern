# Lectern GUI

<div align="center">
  <h3>The Visual Interface for Lectern</h3>
  <p>A modern, glassmorphism-inspired React application for interacting with the Lectern engine.</p>
</div>

---

## Design Philosophy

The GUI is designed to be **atmospheric and focused**. It eschews standard Bootstrap/Material "flat" designs for a more tactile, frosted-glass aesthetic ("Glassmorphism").

- **Dark Mode Default:** The interface is dark-first to reduce eye strain during late-night study sessions.
- **Visual Feedback:** Every action has a transition. Progress is visualized.
- **Simplicity:** The complex configuration of the CLI is abstracted into a guided flow.

## Tech Stack

- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS + Custom CSS Variables (for the glass effects)
- **Icons:** Lucide React
- **Animation:** Framer Motion
- **State Management:** React Hooks (local state, as the app is a simple flow)

## Project Structure

```
src/
├── api.ts              # Typed API client for the Python backend
├── App.tsx             # Main layout and routing logic
├── assets/             # Static assets (images, SVGs)
├── components/         # UI Components
│   ├── FilePicker.tsx  # Drag-and-drop PDF uploader
│   ├── GlassCard.tsx   # Base container component with glass effect
│   ├── HomeView.tsx    # Main dashboard view
│   ├── ProgressView.tsx # Generation progress + live preview
│   └── SettingsModal.tsx # Global settings (API keys, etc.)
└── main.tsx            # Entry point
```

## Development

The frontend is served by the Python backend in production, but for development, you run it as a standalone Vite server that proxies requests to the backend.

### 1. Start the Backend

From the repository root:

```bash
# Ensure venv is active
uvicorn gui.backend.main:app --reload --port 8000
# Backend runs on http://localhost:8000
```

### 2. Start the Frontend

From this directory (`gui/frontend`):

```bash
npm install
npm run dev
# Frontend runs on http://localhost:5173
```

## API Integration

The frontend communicates with the backend via `src/api.ts`. All heavy lifting (PDF parsing, AI generation) happens on the server. The frontend listens for Server-Sent Events (SSE) or NDJSON streams to show real-time progress.

## Building for Production

The build artifact (`dist/`) is meant to be embedded into the Python application (via PyWebView or serving static files).

```bash
npm run build
```

This populates `gui/frontend/dist`, which the Python `build_app.sh` script picks up.

## Testing

Run the test suite with:

```bash
npm test
```