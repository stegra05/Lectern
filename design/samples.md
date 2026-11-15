# Shared sample content for v3 design explorations

Every exploration in `design/` uses this content, so the results can be compared side by
side. Read `docs/brief.md` first.

## Sample courses (for app flow prototypes)

### Course A: Entrepreneurship (freshly created, all material at once)

- 11 lecture slide decks, 2 scripts, 6 past exams, 3 exercise sheets. 22 files in total.
- Lectures in order: 01 What and who, 02 Effectuation, 03 Opportunity recognition,
  04 Business model, 05 Lean startup, 06 Entrepreneurial marketing, 07 Financing, 08 Teams,
  09 Growth, 10 Legal forms and IP, 11 Corporate entrepreneurship.
- One file the app is unsure about: `EE_WS24_final.pdf` (past exam or exercise sheet).
- Inferred exam format: "90 minutes: multiple choice, six short answers, two essays."
- Answers to the three questions: goal "top grade", ready by 6 February, 20 minutes per day.
- Quiz: the student marks 9 of 58 concepts as known, then answers 6 multiple-choice checks.
- Result: 58 concepts, 412 cards across 11 subdecks. 37 concepts appear in past exams.
- Decisions taken, as examples:
  - "Lean startup got 54 cards because it appears in 5 of 6 past exams."
  - "9 concepts you marked as known come last and get one card each."
  - "No cards for the guest lecture slides in 09 Growth: no exam has asked about them."
  - "Essay topics get outline cards, because the exam has two essays."
- Proposed plan: 9 new cards per day, Sundays off, about 20 minutes per day, everything
  introduced by 20 January, reviews until 6 February.

### Course B: Analysis 2 (mid-semester, returning)

- 5 of 13 lectures delivered so far, 214 cards in Anki, plan running at 7 new cards per day.
- The student adds lecture 6 "Uniform convergence". Result: 38 new cards, plan moves to
  8 new cards per day. Nothing already delivered changes.

### First run

The student needs two things once: an API key from a provider, and the AnkiConnect add-on in
Anki. Both must be explained for someone who has never seen either.

## Sample cards (for card design explorations)

Twelve cards across four kinds of lecture. `==text==` marks the key term in an answer.
Weight is "asked N×" with the exam part, or "core" when no past exam asked it.

| # | Lecture type | Role | Front or text | Answer | Topic | Source | Weight |
|---|---|---|---|---|---|---|---|
| 1 | Business | Definition | Knight (1921): what is risk? | An outcome whose ==probability can be calculated or known==, e.g. opening a hairdresser shop. | 02 · Effectuation | Lecture 2, slide 14 | asked 4×, short answer |
| 2 | Business | Reverse | Which effectual principle says to start from who you are, what you know and whom you know? | ==Bird in hand==. | 02 · Effectuation | Lecture 2, slide 21 | asked 6×, multiple choice |
| 3 | Business | Contrast | Causation versus effectuation: how does each handle risk? | Causation: ==expected return==. Effectuation: ==affordable loss==. (two bullets) | 02 · Effectuation | Lecture 2, slide 25 | asked 5×, essay |
| 4 | Business | Chain | BMC fill order: which two blocks follow segments and value propositions? | ==Channels==, then ==Customer Relationships==. | 04 · Business model | Lecture 4, slide 9 | core |
| 5 | Business | Cloze list | Sarasvathy's effectual principles: {{c1::bird in hand}}, {{c2::affordable loss}}, {{c3::crazy quilt}}, {{c4::lemonade}}, {{c5::pilot in the plane}}. | (five cards, one per deletion) | 02 · Effectuation | Lecture 2, slide 20 | asked 6×, multiple choice |
| 6 | Business | Diagram | Draw the Business Model Canvas and label all nine fields. | The canvas as a diagram, plus one line: "Right side is value, left side is efficiency." | 04 · Business model | Lecture 4, slide 7 | asked 3×, short answer |
| 7 | Mathematics | Formula | State the Cauchy-Schwarz inequality for u, v in an inner product space. | \( \lvert \langle u, v \rangle \rvert \le \lVert u \rVert \, \lVert v \rVert \), with equality exactly when u and v are ==linearly dependent==. | 03 · Inner product spaces | Lecture 3, slide 12 | asked 4×, proof question |
| 8 | Mathematics | Why | Why is every convergent sequence bounded? | Beyond some N all terms lie ==within 1 of the limit==; the finitely many earlier terms have a maximum. | 01 · Sequences | Lecture 1, slide 18 | core |
| 9 | Computer science | Code | What does this function return for a sorted array, and in what time? (shows a 9-line binary search in Python) | The index of `target` or -1, in ==O(log n)==. | 05 · Searching | Lecture 5, slide 6 | asked 2×, short answer |
| 10 | Computer science | Cloze | Dijkstra's algorithm fails with {{c1::negative edge weights}} because a settled node's distance {{c2::can still decrease}}. | (two cards) | 08 · Shortest paths | Lecture 8, slide 15 | asked 3×, multiple choice |
| 11 | Life science | Name two | Name two differences between mitosis and meiosis. | ==One division== versus two. ==Identical== versus recombined daughter cells. | 04 · Cell division | Lecture 4, slide 30 | asked 5×, short answer |
| 12 | Life science | Case anchor | Arterial pH 7.30 with raised pCO2: which disorder? | ==Respiratory acidosis==. | 09 · Acid-base balance | Lecture 9, slide 11 | core |

Each card may also carry: an Extra line (at most 40 words of context), a short excerpt from the
slide, and a thumbnail of the source slide.

Binary search for card 9:

```python
def find(xs, target):
    lo, hi = 0, len(xs) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        if xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

## Rules for all explorations

- Write only inside your own folder under `design/`. Do not change any other file and do
  not run git commands that change state.
- No em-dashes anywhere, in copy, comments or notes. A hook rejects files that contain one.
- Plain language for a student who is not technical. Errors name the fix.
- Each exploration ends with a `NOTES.md`: the idea in two sentences, the key decisions, what
  is weakest, and open questions.
