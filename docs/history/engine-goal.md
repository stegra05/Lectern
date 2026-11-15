Build the first milestone of the headless engine for Lectern v3: a TypeScript package with no interface code that turns a course folder of lecture PDFs into a topic tree and atomic flashcards as plain files, drivable from a command line and fully testable without a paid API call. Purpose: cheap models must reach the quality of hand-made decks, so the method lives in code (validators, card roles, builders) and the model only fills slots.

Context: repo /Users/stef/Projects/study-tools/lectern, branch v3. Read first, in order: docs/brief.md (product, architecture, scope); design/KIT.md (what the interface needs: lecture, topics, concepts; card counts; decisions; slides left out with reasons; run phases; cost and time; an outline with cards); design/cards/FIELDS.md (card field contract); design/DIRECTION.md (decisions and why). The v2 engine in src/engine is reference only: learn its provider quirks, quality gate and coverage ledger, copy nothing blindly.

Done when (all checkable):
1. docs/engine-plan.md exists, written first, at most two pages: package layout, the one API-shaped boundary (commands in, events out), the course folder format, the pipeline phases, how limits and roles are enforced, what is deferred.
2. packages/engine exists, runs in Node, has no UI code. Its tests and typecheck pass with one command each, stated in the report.
3. A CLI command builds a course folder with several PDFs and writes: the course file, per lecture a tree of topics and concepts with slide references, one file per card with every field of FIELDS.md, the decisions taken, the slides left out with a reason each, and cost and duration. While running it emits the real phases (read all lectures, map topics and concepts, write cards, check cards) as JSON lines.
4. Validators are pure functions with tests: front at most 20 words, answer at most 25 words and at most 2 bullets, no yes/no questions, cloze rules, role from a closed set, answer slots filled by code, typed answers only for reverse, case and cloze cards with an answer of at most 3 words, stable card ids that survive rewording.
5. Model access sits behind one port. A scripted fake model drives a whole-pipeline test offline, including a rejected card that is retried with feedback.
6. Adding a lecture PDF and building again creates cards only for the new lecture. Existing card files are byte-identical (tested).
7. A command exports the course as a Markdown outline: lectures, topics, concepts, and under each concept its cards as question and answer.
8. One real provider adapter is implemented and covered by a test that is skipped unless an environment variable is set.
9. The report below is written.

Out of scope for this milestone: sending to Anki, evals against the reference deck, the Electron app, themes across lectures, study plan, quiz, past exams.

Constraints: change only packages/engine/**, docs/engine-*.md and root workspace files needed to add the package. Do not touch design/**, docs/brief.md, src/** or src-tauri/**: another session is working in design/. Commit your own paths locally in small commits, never push, never open a pull request. No paid API calls: use the fake model, and if a live run is needed, ask Steffen first with the expected cost. Choose the simplest implementation that meets the criteria, with no speculative abstraction and no backward compatibility. Prefer established libraries. Use Haiku subagents for research. No em-dashes in prose or copy.

Stop early if: a decision would change the boundary or the folder format in a way that is hard to undo (write it in the plan as an open question and ask), a criterion cannot be met after three honest attempts, or anything needs money, a push or a secret.

Report: docs/engine-report.md with what was built, test results as numbers, decisions taken and why, what failed, what is unverified, and a proposed next milestone.
