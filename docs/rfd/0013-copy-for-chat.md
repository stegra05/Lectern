# RFD 13 · Copy for chat

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| **State** | decided, built                                                    |
| **Date**  | 2026-11-14                                                        |
| **Code**  | `packages/app/src/renderer/src/course/CopyForChat.tsx`            |

> **In one breath.** One button copies the course as text a chat app can study with: the
> outline, the cards under each concept, and a short tutoring prompt.

## Decision

- Export is a menu with a preview. Its main job is text an LLM can read, for further study in
  the student's favourite chat app.
- The content comes from the cards: question and answer under each concept, with lecture and
  topic names so answers can be checked against the course.
- A short tutoring prompt goes with it. First intents: explain a concept from my course, make
  practice questions, quiz me without giving the answer away. A study guide comes last.

## Why

Research on 2026-11-14 (thinner than the question deserves):

- Anthropic's education report: 39.3% of student conversations create or improve learning
  material, 33.5% ask for explanations or solutions.
- HEPI 2025: explaining concepts and summarising are the most common uses; 51% say false
  results put them off.
- Bastani et al., PNAS 2025: an unguarded tutor raised practice scores and cut later
  unassisted exam scores by about 17%. A guarded tutor showed no loss. Hence "without giving
  the answer away".
- ChatGPT, Claude, Gemini and NotebookLM all shipped study modes in 2025, grounded in the
  student's sources.

No source says what students paste in as context. Whether students want this at all is
unproven.

## Given up

- **A one-line explanation per concept** as the content. The engine would have had to write
  them; the cards already exist.
