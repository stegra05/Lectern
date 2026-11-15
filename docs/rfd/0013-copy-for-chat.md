# RFD 13 · Copy for chat

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| **State** | deferred, [#195](https://github.com/stegra05/lectern/issues/195)  |
| **Date**  | 2026-11-14                                                        |
| **Code**  | none; removed from v3.0 until demand is shown                     |

> **In one breath.** Deferred: the demand is unproven. The idea is one button that copies the
> course as text a chat app can study with: the outline, the cards under each concept, and a
> short tutoring prompt.

## The idea

- Export is a menu with a preview. Its main job is text an LLM can read, for further study in
  the student's favourite chat app.
- The content comes from the cards: question and answer under each concept, with lecture and
  topic names so answers can be checked against the course.
- A short tutoring prompt goes with it. First intents: explain a concept from my course, make
  practice questions, quiz me without giving the answer away. A study guide comes last.

## Why it waits

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

- **Building it into v3.0.** The research above does not show that students want it, so the
  outline, the command and the button were removed. It returns with #195 if demand shows.
- **A one-line explanation per concept** as the content. The engine would have had to write
  them; the cards already exist.
