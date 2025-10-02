## Lectern (CLI)

Generate Anki flashcards from PDF lecture slides, guided by examples from an existing Anki deck. Lectern parses your slides, composes a multimodal prompt for Google's Gemini, and creates notes in your running Anki via AnkiConnect.

### Status
- Initial functional skeleton. Safe defaults, clear CLI, and modular architecture.
- Requires: Anki desktop running with the AnkiConnect add‑on, and a Gemini API key.

### Disclaimer
- This tool is experimental and currently very untested. It may not work with all Anki or AnkiConnect versions.
- The default note types `prettify-nord-basic` and `prettify-nord-cloze` must exist in your Anki profile. If they don't, either create/import them or override via environment variables (`BASIC_MODEL_NAME`, `CLOZE_MODEL_NAME`) or the `--model-name` flag.

### Project Structure
```
lectern/
  README.md
  main.py            # CLI orchestrator
  config.py          # Env-based configuration
  pdf_parser.py      # Text + image extraction via PyMuPDF
  (no .apkg reader)  # Examples sampled via AnkiConnect only
  ai_generator.py    # Gemini prompt + generation
  utils/             # CLI helpers (colors, timers)
  anki_connector.py  # AnkiConnect HTTP helpers
  requirements.txt   # Python dependencies
  logs/              # Request/response logs (JSON)
```

### Prerequisites
- Python 3.9+
- Anki desktop open with AnkiConnect `https://ankiweb.net/shared/info/2055492159` add‑on enabled
  - Default URL: `http://localhost:8765` (configurable via `ANKI_CONNECT_URL`)
- Google Gemini API key `https://aistudio.google.com/api-keys` exported as `GEMINI_API_KEY`
- Required Anki note types present (by default): `prettify-nord-basic`, `prettify-nord-cloze`.
  - You can change these defaults via `BASIC_MODEL_NAME` and `CLOZE_MODEL_NAME`.
 - Target deck must already exist in Anki with exactly the same name you pass to `--deck-name`. Create the deck in Anki first; it is not created automatically.

### Installation
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
## Optional: auto-load environment variables from a .env file
# pip install python-dotenv
```

### Configuration
- `GEMINI_API_KEY` (required): Your Google Generative AI API key.
- `DEFAULT_GEMINI_MODEL` (optional): Defaults to `gemini-2.5-pro`.
- `ANKI_CONNECT_URL` (optional): Defaults to `http://localhost:8765`.
- `BASIC_MODEL_NAME` (optional): Defaults to `prettify-nord-basic`.
- `CLOZE_MODEL_NAME` (optional): Defaults to `prettify-nord-cloze`.
- `DEFAULT_TAG` (optional): Defaults to `lectern`.
- `ENABLE_DEFAULT_TAG` (optional): `true`/`false` (default `true`).

If `python-dotenv` is installed, `.env` files are auto-loaded from the project root and `~/.env`.

Example (macOS/Linux):
```bash
export GEMINI_API_KEY="your_api_key"
# export ANKI_CONNECT_URL="http://localhost:8765"  # if non-default
```

You can place these in a local shell profile or a `.env` you source before running.

Example `.env` file:
```
GEMINI_API_KEY=your_api_key
# DEFAULT_GEMINI_MODEL=gemini-2.5-pro
# ANKI_CONNECT_URL=http://localhost:8765
# BASIC_MODEL_NAME=prettify-nord-basic
# CLOZE_MODEL_NAME=prettify-nord-cloze
# DEFAULT_TAG=lectern
# ENABLE_DEFAULT_TAG=true
```

### Usage
Run the CLI (minimum required flags):
```bash
python main.py --pdf-path /path/to/slides.pdf --deck-name "My Deck"
```

Note: Ensure a deck named exactly "My Deck" already exists in Anki before running.

With optional parameters:
```bash
python main.py \
  --pdf-path /path/to/slides.pdf \
  --deck-name "My Deck" \
  --model-name prettify-nord-basic \
  --tags exam week1
```

Arguments:
- `--pdf-path` (required): Path to the PDF slides.
- `--deck-name` (required): Destination deck in Anki.
- `--context-deck` (optional): Deck name to sample 5 notes for style via AnkiConnect. Defaults to `--deck-name`.
- `--model-name` (optional): Default note type if AI omits it. Default: `prettify-nord-basic`.
- `--tags` (optional): Space-separated tags to apply (e.g., `--tags exam week1`). Default: `lectern` if `ENABLE_DEFAULT_TAG=true`. To disable auto-tagging, set `ENABLE_DEFAULT_TAG=false`.
- `--max-notes-per-batch` (optional): Max cards requested per turn. Default from config.
- `--reflection-rounds` (optional): Number of post-generation refinement rounds. Default from config.
- `--enable-reflection` (optional): Enable or disable the reflection phase. Default from config.

Quality tip
- Card quality is typically better for existing decks. The app samples up to 5 notes from `--context-deck` (defaults to `--deck-name`) to guide style and structure. If the referenced deck is empty and no `--context-deck` is provided, generation proceeds without style examples.

### What it does
1. Checks AnkiConnect availability.
2. Optionally samples a few notes from `--context-deck` via AnkiConnect to guide style.
3. Extracts text and images from the PDF (original image bytes preserved).
4. Sends a multimodal prompt to Gemini requesting a strict JSON array of cards. The prompt includes definitive guidelines (atomic cards, cloze priority, wording rules, interference avoidance) and prefers `prettify-nord-cloze` then `prettify-nord-basic`.
5. Uploads any media specified by the AI and adds notes to Anki.

### Output expectations
The AI is instructed to return a JSON array like:
```json
[
  {
    "model_name": "prettify-nord-basic",
    "fields": { "Front": "Question?", "Back": "Answer." },
    "tags": ["lectern"],
    "media": [ { "filename": "slide-3.png", "data": "<base64>" } ]
  }
]
```

For cloze deletions:
```json
[
  {
    "model_name": "prettify-nord-cloze",
    "fields": { "Text": "{{c1::Einstein}} developed the theory of {{c2::relativity}}." },
    "tags": ["lectern"]
  }
]
```

Notes:
- If the response is not valid JSON, Lectern skips creating notes (fail-safe).
- Images extracted from the PDF are available to the model; it may also return additional media to upload.
- Model names like `Basic`/`Cloze` are normalized to your configured models.

### Logs & troubleshooting
- Each run writes a JSON log under `logs/session-*.json` capturing request parts and raw response text. Inspect `exchanges[*].request.parts` for the prompts (including any style examples) and `exchanges[*].response_text` for the raw model output.

Troubleshooting
- "Could not connect to AnkiConnect":
  - Ensure Anki desktop is open and the AnkiConnect add‑on is installed/enabled.
  - Verify `ANKI_CONNECT_URL` (default `http://localhost:8765`).
- "GEMINI_API_KEY is not set":
  - Export the key in your shell before running.
- No cards created:
  - Check that slides contain extractable text (current version does not OCR).
  - Try providing `--context-deck` for better style guidance.
  - Inspect console output for any API errors.

### Roadmap ideas
- OCR for image-only PDFs (e.g., Tesseract).
- Schema validation for AI output (e.g., Pydantic) and retries on non-JSON.
- Rich logging/verbosity flags and progress bars.
- Tests with mocked AnkiConnect and sample PDFs.

### Safety
- Lectern never writes Anki collection files directly.
- All modifications go through AnkiConnect's API.

### Defaults & customization quick reference
- Default models: `prettify-nord-basic`, `prettify-nord-cloze` (override via env).
- Default Gemini model: `gemini-2.5-pro` (override via `DEFAULT_GEMINI_MODEL`).
- Default tag: `lectern` (disable by `ENABLE_DEFAULT_TAG=false`).
- Examples: pass `--context-deck` to inject style examples into the prompt.


### Feedback
I’d love to hear your feedback, bug reports, and ideas for improvements. Feel free to open an issue or share thoughts on what works well and what doesn’t.


