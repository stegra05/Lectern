# Changelog

## 2.12.0 (2026-07-25)

### Changed

- **Lectern runs on Gemini 3.6 Flash.** The new Flash is cheaper per output
  token ($7.50 per million against 3.5's $9.00) and writes fewer of them —
  Google measures about 17% fewer — so a typical run costs roughly 5–7% less
  end to end. Most of a run's bill is the lecture PDF being re-read on each
  round, which is why the headline saving lands softer than the price drop.
  It also plans better: it reaches the same deck in fewer tool calls and
  fewer rounds, and edits during review with more precision, so the loop
  spends less time going in circles.
- **A deck you already had keeps the model you already chose — unless that
  model is gone.** A saved setting wins over the built-in default, so
  bumping the default alone would have left every existing install on 3.5
  Flash, quietly paying the older rate forever. Settings now carry a retired
  model forward to the one that replaced it, and a model id Lectern no
  longer offers falls back to the default rather than being sent to the API
  and rejected. Choosing Gemini 3.1 Pro is still your choice to make, and it
  is left alone.
- Gemini 3.6 retires the `temperature`, `top_p` and `top_k` sampling knobs.
  Lectern never used them — card tone and length come from the prompts and
  the quality gate — so nothing about the cards changes here.

## 2.11.0 (2026-07-25)

### Fixed

- **Tags keep the letters of every language.** Tag parts were filtered to
  ASCII, so a German lecture filed itself under `K-nstliche-Intelligenz`,
  `Übungsblatt` lost its first letter entirely, and a CJK topic cleaned to
  nothing at all — which silently collapsed a level of the hierarchy for
  every card in the run. Anki tags are Unicode; only whitespace and quotes
  ever needed handling. A template with a literal space in it no longer
  turns one tag into two, and Title Casing leaves `ReLU` and `kNN` alone.
- **Cloze deletions that Anki would truncate are rejected.** Anki closes a
  deletion at the first `}}`, so `{{c1::\(e^{-x^{2}}\)}}` — math inside a
  deletion, which the prompt itself asks for — reached the student cut in
  half. The gate now catches it, and the formatting rules say how to avoid
  it.
- **Re-sending a card updates its tags, not only its fields.** A renamed
  deck, an edited topic or a changed tag template never reached a note that
  was already in Anki. Clearing a cloze card's "Back Extra" now clears it in
  Anki too, instead of leaving the old hint on the card forever.
- **Editing a card that came from Anki keeps it a card that lives in Anki.**
  The edit used to strip the flag that marks it, which unlocked a Remove
  button that removed nothing from Anki and dropped the edit it was meant to
  carry. Its provenance also stops being rewritten with the current
  lecture's name and no pages.
- **Duplicates are recognized before the send, not during it.** Cards Anki
  already holds are left alone and reported as such, rather than attempted,
  refused, and counted as failures — and every per-card outcome now appears
  in the activity log the send bar points at.
- **A hand edit passes the same gate as a model edit.** The quality badge
  used to freeze at generation time, so a fixed card stayed flagged and a
  card broken by an edit went out looking clean.

### Changed

- **Grounding is checked, not taken on trust.** Lectern already read the
  PDF's text; it now keeps it, and flags a card whose source excerpt is
  absent from the page it cites. Pages the document does not have are
  rejected outright — cards citing page 900 of a 10-page lecture used to
  pass and push page coverage above 100%.
- **The gate checks what the renderer will show.** Markdown, `$…$` math,
  more than two cloze deletions, and an answer that only repeats its
  question are rejected; yes/no fronts and cards that point at the slide
  ("as shown above") are flagged for a second look.
- **The coverage ledger stopped believing the model about the document.** It
  counts against the real page count, a high-importance concept needs a card
  that claims it rather than one that merely cites its page, rephrased
  duplicates are caught before they land, and the question mix is named back
  to the model so a deck of forty definitions is visible while it is being
  written. An extend run can now say it has nothing worth adding, which the
  brief always invited and the gate always refused.
- **The review shows what the student will see.** Cloze cards can be shown as
  asked instead of only as answered, "Back Extra" is rendered, and tables,
  code and ordered lists preview the way Anki renders them. Search reads the
  card rather than its HTML.
- **The deck field says what the name means in Anki** — an existing deck, an
  empty one, a new one it will create, or that Anki cannot be reached to
  answer. The tag template names its placeholders, flags unknown ones, and
  shows the tags a card would carry.
- **Note types survive their own upgrades.** A theme switch no longer
  rewrites card templates, so a `{{Tags}}` line or type-in box added in Anki
  stays; "Apply design to earlier synced cards" keeps fields it has no home
  for instead of dropping them, refuses to make a cloze note out of a note
  with no deletion, and leaves notes whose model makes more cards than the
  target. Card size follows Anki's own styling knob again, and missing fonts
  are re-uploaded rather than assumed.

### Accessibility

- The focus ring is visible on paper (it was 2.05:1), dimmed text on the desk
  meets 4.5:1, error messages and the activity log can be selected and
  copied, the card grid is a listbox that moves focus with the selection, the
  concept sheet behaves like the modal it declares itself to be, the
  filmstrip is one tab stop instead of seventy, and the update notice no
  longer covers the slides it was sitting on.

## 2.10.0 (2026-07-25)

### Added

- **Extend a deck instead of replacing it**: re-run a lecture into a deck
  that already holds cards and Lectern reads them back out of Anki first,
  then generates only what is missing. The deck field offers "Don't repeat
  what this deck already covers", on by default, and the size slider becomes
  "Cards to add" — 40 on top of the 87 you already have, not 40 in total.
- The cards already in the deck appear in the session, dimmed and labelled,
  so a short run explains itself. They are never rewritten or deleted by the
  quality pass — the model is not shown them at all — and they are not
  re-sent to Anki. Editing one by hand opts it back into the next send.
- **Depth instead of a shrug**: extending a deck that already covers the
  whole document used to be able to finish with nothing added, which is
  technically true and useless. Once there is no breadth left, the ledger
  switches to depth — the relations between concepts, pages carrying a
  single card, concepts no card names outright — and the run keeps going
  until it has added what you asked for or genuinely has nothing worth
  adding, which it will say.

### Fixed

- A deck holding several lectures no longer confuses whose pages are whose.
  Page numbers only mean something next to their own document, so cards from
  another lecture keep their place in the duplicate check but do not mark
  this lecture's pages as covered. Matching survives the model rephrasing or
  abbreviating a title between runs, while treating the lecture number as
  decisive — titles within a course are identical apart from it.

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
  formats. _Outline_ produces Markdown with each concept's relations nested
  beneath it, so RemNote, Notion, and Obsidian turn them into child items
  rather than a flat wall of text. _Diagram_ produces a Mermaid graph that
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
