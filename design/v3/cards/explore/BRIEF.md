# Brief for designers of new card designs

You are designing one new look for the Anki flashcards that Lectern v3 produces. Lectern is a
desktop app that turns a whole course of lecture slides into Anki cards for students. The
product owner wants more card designs to choose from and said: "Let the agents be creative."
Four other designers each make a different design in parallel, so commit fully to yours.

## How the card system works (binding)

Repository `/Users/stef/Projects/study-tools/lectern` (branch `v3`). The card system is in
`design/v3/cards/`:

- `FIELDS.md`: the field contract. `NOTES.md`: how role adaptation, answer-shaped slots, the
  slide print and typed answers work.
- `anki/front.html`, `back.html`, `cloze-front.html`, `cloze-back.html`: the ONE set of
  templates every design shares. A design is a stylesheet and nothing else.
- `anki/style-structure.css` and `anki/style-lamp.css`: the two existing designs. The owner
  likes both. Study them to see every hook a stylesheet must style.
- `gallery.html`, `gallery.src.html`, `build.py`: how the gallery renders the sample cards
  through Anki's real template engine. `shots/`: what the existing designs look like.
- `design/v3/samples.md`: the twelve sample cards.

Then load the `frontend-design` skill with the Skill tool.

Every design must keep what makes these cards work: the answer-shaped slots (the front shows
the shape of the expected answer, the back fills it), the one-line role cue, the key term
mark, the slide print at the foot of the back (thumbnail, source, excerpt, opens the slide),
the typed-answer input and its comparison, the exam weight tag, cloze gaps, formulas, code,
diagrams, and night mode. All twelve sample cards plus the typed variants must look right at
360px wide.

What the owner rejected earlier: a design imitating marked exam paper with red handwriting.
Do not go near it.

## Rules

- Write ONLY new files: your stylesheet `design/v3/cards/anki/style-<name>.css` and everything
  else in your own folder `design/v3/cards/explore/<name>/`. That folder may hold leftovers of
  an interrupted earlier run: reuse or overwrite them.
- Do not modify the shared templates, the two existing stylesheets, `gallery.html`,
  `gallery.src.html` or `build.py`. If your design truly needs a template change, do not make
  it in place: put a patched copy in your folder, render with it, and explain the exact change
  in your notes.
- No JavaScript in cards. Fonts: system stacks, or the font files already bundled in
  `design/v3/cards/anki/`. Do not download any font or other file.
- WCAG AA contrast in light and night mode. No em-dashes anywhere (a hook rejects them).

## Deliverables in your folder

1. `gallery.html`: all sample cards in your design, front and back, light and night, at 360px,
   rendered the same truthful way the existing gallery is (copy the build approach into your
   folder, do not edit the shared one).
2. `overview.png`: one image of exactly 1600 by 1000 pixels that sells the design at a glance:
   the design's name and its idea in one line, at least five different card roles front and
   back (include the contrast card, the cloze list, the formula, the code card and a
   typed-answer card), and at least two card faces in the other colour mode. Faces may be
   scaled down, but text must stay legible.
3. `NOTES.md`: the idea in two sentences, the decisions that define it, what is weakest, and
   anything unverified in real Anki clients.

## Checking your work

Render and look before you finish. Run ONE headless Chrome at a time, each with its own
`--user-data-dir` inside your folder, and always under a kill timer because headless Chrome
sometimes never exits:

```
perl -e 'alarm 40; exec @ARGV' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --user-data-dir=<your folder>/chr-1 --window-size=1600,1000 --virtual-time-budget=5000 --screenshot=<png> "file://<html>"
```

Open screenshots with the Read tool and fix what is wrong. Check every sample card. Before you
finish, check with `ps` that no headless Chrome of yours is still running and stop any that
is, and delete your `chr-*` profile folders.

## Report

At most 150 words: the design's name and idea in one sentence, the three decisions that define
it, what is weakest, anything unverified.
