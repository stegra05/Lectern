# Changelog

## 2.3.0 (2026-07-08)

### Added
- **Concept map graph**: the extracted concepts are now drawn as an interactive
  map. Concepts are sized by importance, connected by the relations Gemini
  found in the lecture, and lit amber as cards cover them. Click a concept to
  see its relations, difficulty, and slides; scroll to zoom, drag to pan.
  The grouped list is still there as a toggle.
- **Concept map card in the sidebar**: a live miniature of the map replaces the
  bare coverage percentage and lights up while cards are generated. Click it to
  open the full map.

## 2.2.0 (2026-07-08)

### Added
- **Lectern card design in Anki**: cards now sync to bundled "Lectern Basic" and
  "Lectern Cloze" note types that Lectern installs into your collection. Every
  card shows its topic, where it came from ("ML Foundations · pp. 23-24"), and
  the exact source excerpt it was graded against, one tap away. Two themes:
  Evening lecture hall (default) and Nord. Switching themes restyles every
  synced card at once.
- **Restyle earlier decks**: a one-click action in Settings moves cards from
  previous syncs onto the new note types without losing review progress.
- **Your edits win**: if you change the note type styling inside Anki, Lectern
  detects it and never overwrites your version.
- Procedure cards: ordered lists where each step is its own cloze card.

### Changed
- Card tiles in the review list match the synced card anatomy (topic line,
  amber answer rule, source excerpt fold).

Prefer the plain Basic/Cloze note types? Turn the design off under
Settings → Card design.

## 2.1.0 (2026-07-08)

### Added
- **Automatic updates**: Lectern now checks for new versions on launch and offers
  to install them in place. Update packages are cryptographically signed and
  verified before anything is replaced. On Linux this applies to the AppImage only.

Installs of 2.0.0 predate the updater, so this last hop is a manual download.

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
