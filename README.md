## Lectern (CLI)

Generate Anki flashcards from PDF lecture slides, guided by examples from an existing Anki deck. Lectern parses your slides, composes a multimodal prompt for Google's Gemini, and creates notes in your running Anki via AnkiConnect.

### Status
- Initial functional skeleton. Safe defaults, clear CLI, and modular architecture.
- Requires: Anki desktop running with the AnkiConnect add‑on, and a Gemini API key.

### Project Structure
```
ankiparse/
  README.md
  lectern/
    main.py            # CLI orchestrator
    config.py          # Env-based configuration
    pdf_parser.py      # Text + image extraction via PyMuPDF
    anki_reader.py     # Read-only .apkg sampler for few-shot examples
    ai_generator.py    # Gemini prompt + generation
    anki_connector.py  # AnkiConnect HTTP helpers
    requirements.txt   # Python dependencies
```

### Prerequisites
- Python 3.9+
- Anki desktop open with AnkiConnect add‑on enabled
  - Default URL: `http://localhost:8765` (configurable via `ANKI_CONNECT_URL`)
- Google Gemini API key exported as `GEMINI_API_KEY`

### Installation
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Configuration
- `GEMINI_API_KEY` (required): Your Google Generative AI API key.
- `ANKI_CONNECT_URL` (optional): Defaults to `http://localhost:8765`.

Example (macOS/Linux):
```bash
export GEMINI_API_KEY="your_api_key"
# export ANKI_CONNECT_URL="http://localhost:8765"  # if non-default
```

You can place these in a local shell profile or a `.env` you source before running.

### Usage
Run the CLI module directly:
```bash
python -m lectern.main \
  --pdf-path /path/to/slides.pdf \
  --deck-name "My Deck" \
  --context-apkg-path /path/to/context.apkg \
  --model-name Basic \
  --tags lectern university
```

Arguments:
- `--pdf-path` (required): Path to the PDF slides.
- `--deck-name` (required): Destination deck in Anki.
- `--context-apkg-path` (optional): An `.apkg` to sample 5 notes for style; improves consistency.
- `--model-name` (optional): Default note type if AI omits it. Default: `Basic`.
- `--tags` (optional): Tags for created notes. Default: `lectern`.

### What it does
1. Checks AnkiConnect availability.
2. Optionally samples a few notes from `--context-apkg-path` to guide style.
3. Extracts text and images from the PDF (original image bytes preserved).
4. Sends a multimodal prompt to Gemini requesting a strict JSON array of cards.
5. Uploads any media specified by the AI and adds notes to Anki.

### Output expectations
The AI is instructed to return a JSON array like:
```json
[
  {
    "model_name": "Basic",
    "fields": { "Front": "Question?", "Back": "Answer." },
    "tags": ["lectern"],
    "media": [ { "filename": "slide-3.png", "data": "<base64>" } ]
  }
]
```

Notes:
- If the response is not valid JSON, Lectern currently skips creating notes (fails safe).
- Images extracted from the PDF are available to the model; it may also return additional media to upload.

### Troubleshooting
- "Could not connect to AnkiConnect":
  - Ensure Anki desktop is open and the AnkiConnect add‑on is installed/enabled.
  - Verify `ANKI_CONNECT_URL` (default `http://localhost:8765`).
- "GEMINI_API_KEY is not set":
  - Export the key in your shell before running.
- No cards created:
  - Check that slides contain extractable text (current version does not OCR).
  - Try providing `--context-apkg-path` for better style guidance.
  - Inspect console output for any API errors.

### Roadmap ideas
- OCR for image-only PDFs (e.g., Tesseract).
- Schema validation for AI output (e.g., Pydantic) and retries on non-JSON.
- Rich logging/verbosity flags and progress bars.
- Tests with mocked AnkiConnect and sample PDFs.

### Safety
- Lectern never writes `.apkg` or `collection.anki2` directly.
- All modifications go through AnkiConnect's API.


