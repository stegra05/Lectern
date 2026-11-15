# v3 design direction

Decided by Steffen on 2026-11-13 after reviewing the six explorations in this folder.
Read `docs/brief.md` first. This file says which exploration wins where, and what is new.

## Chosen

| Area | Decision | Source |
|---|---|---|
| App flow and layout | The map and the semester | `flow-map/` |
| Visual identity | The "survey sheet" look of the map flow | `flow-map/` |
| Result screen | The map's result: one screen, decisions pinned to the picture | `flow-map/#result` |
| Onboarding and the questions | The conversation's wording and forms | `flow-conversation/#first-run`, `#questions` |
| Choosing the provider | The desk's way of selecting the provider | `flow-desk/#first-run` |
| Card designs | Structure and Lamp, as two skins | `cards-structure/`, `cards-lamp/` |

Rejected: the corrector card design, and the conversation's result screen (too little
information).

## New requirements from the review

1. **Lectures are clickable.** Clicking a lecture on the map opens its cards. The student can
   read them, see the slide behind each one, edit a card, remove a card, and add a card of
   their own.
2. **Typed answers.** Some cards should make the student type the answer. This does not fit
   every card. Proposal: code decides, per card, and only allows it when the answer is one
   short term (reverse, case anchor, cloze). Never for formulas, diagrams or explanations.
3. **A feedback loop on the result.** The student can tell the app what to change, and the
   app adjusts the deck. See the proposal below.

## The feedback loop (confirmed 2026-11-13: fixed actions, no free text)

Feedback is given on the picture, as closed operations that code can apply. No free text in
the first version.

- On a lecture: more cards, fewer cards, or skip a part of it.
- On a concept: "I know this" (one card, last in the order), "not needed" (no cards),
  "go deeper".
- On a decision: undo it, for example include the guest lecture after all.
- On a card in a lecture's list: "too easy", "not relevant", "wrong", next to edit and remove.

The app shows the effect as numbers before applying it, for example "14 fewer cards in
09 Growth", then rebuilds only what changed. Each change appears in the decisions list as
something the student asked for. Feedback is stored with the course, so later lectures
inherit it.

Before sending, changes are free. After sending, the app still never rewrites delivered cards
on its own. The student may edit or remove their own cards at any time.

Marking a concept as known here is the same gesture as the quiz's map marking, so the quiz
expansion shrinks to the multiple-choice check.

## Scope placement (confirmed 2026-11-13)

- **Base product**: browsing cards per lecture, the slide behind a card, edit, remove, add an
  own card.
- **Expansions, in order**: 1 feedback loop, 2 study plan, 3 past exams and exam weight,
  4 multiple-choice quiz, 5 second card skin and typed answers.

## Second review (2026-11-14, on the canvas)

Steffen's complaints about the base screens, and what he asked for:

- The files screen looks mediocre and its value is unclear.
- He dislikes the blob shapes of the map.
- The map should behave like a map: zoom in and out.
- The run animation is not good enough.
- The layout must not change between before and after generation. The ratio stays constant.
- The concept map is full screen, for the course and inside a lecture.
- Clicking a lecture zooms into that lecture's concepts.
- The concept map is exportable.
- A settings screen is needed, including the choice of card design.
- The general design language should also be explored as alternatives.

He wants more than one alternative for each complaint. They are on the canvas page
"Alternatives", one row per decision, with fixed names:

| Decision | Alternatives |
|---|---|
| Design language | A Survey sheet (current), B Swiss editorial, C Native Mac, D Night blueprint, E Playful |
| Layout | A Sheet, B Drawer, C Rail and popovers |
| Map style | A Graph, B Territories, C Lines |
| Files | A Straight onto the map, B Lecture shelf, C Only what needs you |
| Run | A The map draws itself, B Slides to cards, C Quiet ledger |
| Settings | A Sections, B Sheet over the map, C Card design first |
| Export | A Menu, B Study sheet |

### His picks (2026-11-14)

- **Design language**: C Native Mac, plus the playful elements of E. Which elements is open.
- **Layout**: likes B Drawer, but worries it clashes with the rest of the app. If the whole app
  must follow one layout, then A Sheet.
- **Map**: none of the three looks good enough. Lines is creative but he doubts it is useful or
  intuitive. He leans towards Graph, done differently, as three views: a top graph of how the
  lectures relate, a mind map of the topics inside one lecture, and an alternate view with the
  whole lecture series as one mind map.
- **Files**: A Straight onto the map.
- **Run**: likes A and C. C might not match what really happens in the background.
- **Settings**: A Sections, without the left border on the active tab ("AI slop"). He wants more
  mock designs and a selection carousel.
- **Export**: A Menu, with a preview like B. The main objective in his view is an export an LLM
  can read, for further study in the student's favourite chat app. He is unsure whether users
  want that.

He then asked for an extensive interview to catch the nuances before anything is redrawn.

### Interview, first round (2026-11-14)

**Design language**
- From Language E he wants the colour per lecture and the winding track, plus personality
  through small details. Play lives in the content, not in the controls.
- Native look on each operating system. Dark mode is part of the base product.

**Layout**
- What he likes about the drawer: the map has the full width, and details pull up. He imagines
  pulling up further for more information and statistics.
- The constant frame only has to hold inside a course. Course list, settings and first run are
  separate screens.
- A bottom bar plus a panel that appears on selection "sounds decent" to him as well.

**Map**
- Purposes, in his order: an overview of the lectures, going to a lecture to see what Lectern
  created, seeing how topics relate.
- Shape: a tree growing left to right, or a snake across the screen. The lectures sit along it
  and expand into their mind maps. A second, alternative screen is a mind map of the concepts
  only.
- Depth: lecture, topics, concepts.
- Lines between lectures are mostly for navigation.
- The whole-course mind map opens to the level of topics, not collapsed to lectures.
- A node shows its name and is clickable to see its cards. The map is not for studying from.

**Run**
- Confirmed: a per-lecture ledger would not match the real work, because the engine reads the
  whole course before it writes cards.
- He walks away during the run, but wants to see progress. Map growth plus a plain list of the
  real phases is "perhaps" right.

**Settings and cards**
- "More mock designs" means more card designs. The agents may be creative. Five new designs
  were commissioned in `design/cards/explore/`: native, colours, night, object, poster.
- The carousel shows one card design at a time on a card from the student's own course.

**Export**
- A "Copy for chat" button, most likely carrying the mind map. Uses he named: building study
  material and asking questions. He asked how students use LLMs to study; research was started.

### Interview, second round (2026-11-14)

- The concept-only view groups concepts by **course-wide themes that cut across lectures**.
- The track is a **snake**.
- Lecture colours follow the lecture **onto the cards in Anki**, in designs that support it.
- The card design is chosen **in settings, and offered once before the first send**.
- Drawer or bar plus side panel: he left the call to Claude and asked to check the research.
  Call made, pending that check: a bottom bar that pulls up in three heights for course-level
  content (action, details, statistics), plus an inspector on the right that appears only on
  selection, for cards. Reason: a card list reads better in a tall panel, and wide content
  such as deck bars and statistics suits a bottom panel.
  Research check (2026-11-14, several primary pages only partly readable): guidance treats the
  bottom sheet as a mobile pattern. NN/g defines it for mobile screens, Material moves sheet
  content to a right side sheet on wide windows (from snippets, unverified), LINE's design
  system bans bottom sheets on tablets and PCs, and desktop map and canvas tools (Felt, Figma)
  put details in a right sidebar. So the inspector half of the call is supported. The pull-up
  bar half is not supported by any source: it rests on his preference and on the argument about
  wide content, and at 720px height its details stop costs close to half the map. Keep it
  collapsed by default and judge it on the frames.
  **Final (2026-11-14): "Side panel then."** The bar is a slim strip that never grows, and one
  side panel on the right holds all details: cards of a selection, course details with the tabs
  Decisions and Statistics, the setup before generation, the phases during the run. `KIT.md`
  is updated.
- Statistics: he had no idea what to show. Proposal: cards per lecture, mix of card types,
  what was left out and why, and what the run cost in time and money.
- Personality: he asked Claude to suggest reference apps.

These decisions are written up as a kit in `KIT.md`. The redraw is the canvas page
"Direction v2" (files `V2*.dc.html`), briefed in `V2-BRIEF.md`.

### Direction v2 delivered (2026-11-14)

Canvas page "Direction v2" holds twelve frames drawn to `KIT.md`: the course track, lecture 02
as a mind map with its cards, the themes view, dark mode with course details, files on the
track with the goal, the run with the engine's real phases, statistics, sent, a lecture added
mid-semester, settings with the card carousel, the card choice before the first send, and
"Copy for chat". Canvas page "Card designs" holds five new card designs as pictures: Placard,
Afterglow, Vitrine, Native, Lecture colours. Their stylesheets are in `packages/engine/anki/` and their
galleries in `cards/explore/`.

Open points found while reviewing the renders:

- When the side panel opens, the designers reflowed the track from four stops per row to
  three. So the snake rearranges itself whenever the panel opens or closes. Needs a decision:
  reflow, let the panel cover the right column, or pan.
- "Copy for chat" assumes a one-line explanation per concept, which the engine would have to
  produce.
- The themes view needs the engine to group concepts into course-wide themes.
- "Lecture colours" needs one class token on the card root (`lec-{{Lecture}}`) in the shared
  templates. "Native" would use it too. Not yet applied to the shared templates.
- Topics for lecture 02, the seven themes and all statistics figures are invented samples.
- His reaction to the frames and his pick of personality references (mood board A to J in
  `personality/moodboard.html`) are still open.

### Interview on Direction v2, with the question tool (2026-11-14)

- Verdict: **right direction, needs polish**. The look is fine. The flow and panel screens are
  "okay for now".
- **Mind maps as rings**: a centre piece with branches in all directions. Lecture in the
  centre, topics on an inner ring, concepts on an outer ring. The themes view only had the
  wrong shape; it takes the same rings.
- **The map slides** when the side panel opens. It never reshuffles.
- **Personality** to borrow: calm craft (Things, Craft), colour play in a native app (Amie,
  Arc), small delights (Family, Notion). Not the journey-on-a-path references.
- **Card designs kept**: Afterglow, Vitrine, Native, Lecture colours, Structure, Lamp.
  Placard is dropped. Lecture colours needs softer colours, on the cards only.
- **Default card design**: Native.
- **Themes view**: after the base product.
- **Copy for chat** takes its content from the cards, listed as question and answer under each
  concept.
- **Next**: design and engine in parallel.

`KIT.md` carries all of this.

### Research: how students use chat apps to study (2026-11-14)

Evidence is thinner than the question deserves, and some figures come from secondary coverage.

- Anthropic's education report: 39.3% of student conversations create or improve learning
  material (practice questions, summaries, edits), 33.5% ask for technical explanations or
  solutions.
- HEPI 2025: explaining concepts and summarising are the most common uses. 51% say false
  results put them off.
- Bastani et al., PNAS 2025: an unguarded tutor raised practice scores and cut later unassisted
  exam scores by about 17%. A guarded tutor showed no loss.
- ChatGPT, Claude, Gemini and NotebookLM all shipped study modes in 2025 built on hints,
  questions and quizzes grounded in the student's sources.
- No source says what students paste in as context.

Consequence for "Copy for chat": the copied text should be the outline plus a short tutoring
prompt, and it must carry lecture and topic names so answers can be checked against the course.
First intents: explain a concept from my course, make practice questions, quiz me without
giving the answer away. A study guide comes last.

## Card field contract

Both skins must read exactly the same fields, so a skin is a stylesheet and nothing else.
The contract is defined in `cards/` once the two designs are merged.
