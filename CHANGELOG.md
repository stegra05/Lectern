# Changelog

## 2.0.0 (2026-07-08)

Complete from-scratch rebuild as a Tauri 2 desktop app.

### Added
- **Agentic generation**: Gemini plans its own batches through a tool loop
  (`submit_cards` / `finish_generation`) and receives an updated coverage ledger
  after every batch: which pages, concepts, and relations still lack cards.
- **Grounding gate**: every card must carry provenance (source pages, concepts,
  source excerpt) and pass a quality checklist before it enters the deck.
- **Illuminated filmstrip**: real page thumbnails light up as coverage arrives.
- **Agentic quality pass**: a whole-deck review loop (`update_card` / `add_cards` /
  `remove_cards`) with every edit re-gated.
- **Slide peek**: click a card's page reference to see the exact slide it came from.
- Card review with inline editing, search, page filter, undoable delete.
- Anki sync via AnkiConnect with dry-run preview (create/update/duplicate counts).
- Cost estimation up front and live token/cost usage during generation.
- Gemini API key stored in the OS keychain, never on disk.

### Changed
- No backend: the entire pipeline is TypeScript running in-process. The Python/
  FastAPI/PyWebView stack of v1 (~40k LOC) is replaced by ~6k LOC including tests.
- Distribution is a ~10 MB native bundle instead of a PyInstaller archive.

The v1 app lives on the [`v1`](https://github.com/stegra05/Lectern/tree/v1) branch.
