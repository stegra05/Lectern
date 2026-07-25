# Changelog

## 2.9.0 (2026-07-25)

### Added
- The home view shows the run's estimated token count next to the price.
  The ceiling most people meet first is a quota, not a bill.

### Changed
- **Rate limits are visible instead of silent**: a throttled run used to
  look like a hung one. Every wait now appears in the activity log —
  "Gemini rate limit reached — waiting 30s (retry 1 of 5)" — and the
  server's own retry-after is honoured over Lectern's backoff.

### Fixed
- When the retries run out, the error no longer promises a retry that is
  not coming. It tells apart a spent per-minute limit from an exhausted
  daily quota — waiting only helps for one of them — and says plainly that
  the cards generated so far are kept.

## 2.8.0 (2026-07-25)

### Added
- **Tells you when the deck is ready**: a run that finishes raises a desktop
  notification and bounces the dock, so you can start it and go do something
  else. Only when Lectern is in the background — if you are watching the
  cards land, you already know. Failures notify too, since that is exactly
  what you walked away expecting not to happen. There is an off switch in
  Settings.

## 2.7.0 (2026-07-25)

### Changed
- **Room to write a real brief**: the focus field holds 600 characters
  instead of 180, and the follow-up composer 1000 instead of 500. A counter
  appears once either is more than half full.
- The follow-up composer is now a textarea that grows to fit what you typed
  — a one-line input was hiding requests that ran to a paragraph. Enter
  still sends; Shift+Enter breaks the line.
- Line breaks in a focus note survive as separators instead of being
  flattened to spaces, so a pasted list keeps its item boundaries. They are
  still never sent as newlines, which is what stops a pasted note from
  impersonating an instruction.

## 2.6.0 (2026-07-25)

### Added
- **Copy the concept map**: the map sheet gains a Copy button with two
  formats. *Outline* produces Markdown with each concept's relations nested
  beneath it, so RemNote, Notion, and Obsidian turn them into child items
  rather than a flat wall of text. *Diagram* produces a Mermaid graph that
  renders in the same apps without a plugin, with importance carried in the
  node shape as well as the colour so the ranking survives renderers that
  ignore styling.

### Changed
- **The concept list reads like the outline it exports**: section headings
  stay put while their group scrolls and carry a count, each concept's
  relations sit beneath it in the same wording the export uses, and
  difficulty is a three-rung meter instead of the word "foundational"
  repeated down every row.
- Page references in the list no longer wrap mid-row: they read "p. 12, 13,
  14" with the overflow collapsed into a "+2" and the full list in the
  tooltip.

## 2.5.0 (2026-07-09)

### Added
- **Ask for more cards**: once generation finishes, the activity log grows a
  small composer. Type a request in plain language — "add cards on the trolley
  problem", "emphasize the Rawls slides" — and Lectern adds matching cards to
  the deck. Requests are additions only: cards you already reviewed are never
  edited or removed, new cards pass the same quality gate, and duplicates of
  existing cards are dropped. Your request and the model's reply become part
  of the session minutes.
- **Outside-source cards, honestly labeled**: if a request asks for material
  the lecture doesn't contain, the card is still written but carries an
  "outside source" label and stays out of the Anki send until you include it
  with one click. Page citations are never invented.

### Changed
- After the deck is complete, the sidebar counts the live deck size instead of
  the original generation budget, so follow-up additions show up immediately.
- Batch feedback to the model now names duplicate submissions instead of only
  counting them, and announces truncated lists, so the agent loop stops
  resubmitting the same cards.

### Fixed
- A network blip mid-generation no longer kills the run: dropped connections
  retry like server errors, while unrecoverable client errors (a rejected API
  key, a malformed request) stop immediately instead of retrying for minutes.
- Tighter desktop shell: a strict content-security policy, and file read
  access scoped to PDF files.

## 2.4.0 (2026-07-08)

### Changed
- **Activity log redesigned as session minutes**: every event is stamped with
  the elapsed session time, and the model's own words (the quality review
  summary, the front of a rejected card) appear as quoted excerpts you can
  expand instead of walls of text. Rejection reasons read as plain language.
- The quality review summary can now use simple formatting (bold, italic,
  code, bullet lists) and the log renders it.

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
