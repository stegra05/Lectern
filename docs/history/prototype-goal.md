Bring Lectern v3 from its current state to a working base prototype: finish engine milestone 2, then build the Electron app so that a course of lecture PDFs goes end to end from upload to finished cards on screen. Purpose: one stated goal in, a trustworthy course deck out, made by cheap models.

Context: repo /Users/stef/Projects/study-tools/lectern, branch v3, local only. Read first, in order: docs/HANDOFF.md, docs/brief.md, design/DIRECTION.md, design/KIT.md, docs/engine-decisions.md, docs/engine-report.md, docs/engine-plan.md. Screens to build are on the canvas https://claude.ai/artifact/E4ZxyLc4DdB7HK3CgoQ1XE (page "Direction v2"), with a copy in design/canvas/project/ (files V2*.dc.html). The canvas was edited by hand after that copy was made, so read a screen back from the canvas before relying on the copy. Another session may be working in packages/engine on milestone 2: ask Steffen first. If it is, leave that folder alone and start with the app.

Done when (all checkable):
1. packages/engine has no stray uncommitted work. Its tests and typecheck pass, with the commands stated in the report.
2. Engine milestone 2 is in, per engine-decisions.md: one YAML file per lecture, dropped cards listed with concept and reason, an OpenAI adapter, one decisions port (POST /v1/decisions) with a scripted fake, kinds of slide and of fact labelled through that port, code plans the cards and the model fills one form per card, a split step for cards that are too long, a cost estimate before the run and a hard cap, one placeholder preset marked as such. An offline pipeline test covers all of it.
3. One real run on the 11 Entrepreneurship slide decks has completed within the cap, and the report states cards made, cards dropped with reasons, limit violations (must be zero), cost and duration.
4. packages/app exists: an Electron app that talks to the engine only through its one boundary. One command starts it, stated in the report.
5. In the app these base screens work with real engine output, following KIT.md and the canvas: first run (provider and key), courses, files on the course track with the goal question, the run with the engine's real phases, the result with the track, a lecture as rings and its cards in the side panel, and settings with the card design carousel. Light and dark both work.
6. A Playwright test drives the app from creating a course to seeing cards in the side panel, using the fake model, and passes.
7. Screenshots of every base screen in light and dark are saved under docs/shots/, and you have looked at each one.
8. The report below is written.

Out of scope: sending to Anki, the themes view, study plan, quiz, past exams, the feedback loop, the four real profiles, calibration of the decision models, evals on the other two courses, releases.

Constraints: stay on branch v3. Commit locally in small commits, adding files by path. Never push, never open a pull request. Paid API calls only on OpenAI, at most 50 dollars in total, each run preceded by its estimate in the log; anything else that costs money needs Steffen's yes. The key is in the macOS keychain (service Lectern, account openai_api_key): pass it by environment variable, never write it to a file. Do not touch src/, src-tauri/ or design/archive/. Do not change the canvas. Simplest implementation, no backward compatibility, no speculative abstraction, established libraries. Opus subagents for design work, Haiku subagents for research. No em-dashes in prose or copy. Run headless Chrome only under a kill timer.

Stop early if: a criterion fails after three honest attempts, the spend reaches 40 dollars, a decision would contradict engine-decisions.md or KIT.md, or anything needs a push, a secret or a deletion of untracked work. Write down where you stopped and why.

Report: docs/prototype-report.md with what was built, test results as numbers, the real run's figures, what failed, what is unverified, and the next milestone you propose.
