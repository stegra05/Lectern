# Brief for designers of the "V2" canvas screens

You are drawing screens of Lectern v3 as artboards for a Claude Design canvas. Lectern is a
desktop app that turns a whole course of lecture slides into Anki flashcards for students who
are not technical. Several designers draw different screens in parallel, so the shared kit is
binding and you must not improvise on it.

You only WRITE FILES. The main session publishes them. Do not use the Artifact tool.

## Read first

In the repository `/Users/stef/Projects/study-tools/lectern` (branch `v3`):

1. `design/v3/KIT.md`: tokens, lecture colours, the frame, the map. Binding.
2. `docs/v3/brief.md` and `design/v3/DIRECTION.md`: the product and what the owner decided.
3. `design/v3/samples.md`: the sample course (Course A, Entrepreneurship).

In the canvas project folder
`/private/tmp/claude-501/-Users-stef-Projects-study-tools-lectern/3481f3e4-d8c3-43f4-ac74-fe23851bdf58/scratchpad/lectern-v3-canvas/project/`:

4. `AltLangC1.dc.html` and `AltLangC2.dc.html`: the look of controls, type and materials, and
   the exact artboard file format. `AltLangE1.dc.html`: lecture colours and the track.
5. `Result.dc.html`, `Lecture.dc.html`: the content of the result and lecture screens (the
   decisions, the card list). Take wording and data from them, not their styling.

Then load the `frontend-design` and `apple-design` skills with the Skill tool.

## Output

Write your artboard files into the canvas project folder named above, with exactly the file
names your task gives you. Each is a full window of 1100 by 720.

## The artboard format (every violation fails silently)

Copy the skeleton of `AltLangC1.dc.html` exactly: the doctype, the
`<script src="./support.js"></script>` line, `<x-dc>`, `<helmet>` with only `body{margin:0}`
plus link colours in its `<style>`, one root `<div>` with `height: 100vh`, and the closing
`data-dc-script` block with `$preview` 1100 by 720.

- All styling is inline `style="..."`. No classes that depend on a stylesheet, no CSS variables.
- Close every non-void element, quote every attribute, single quotes for font names inside
  attributes.
- All interface is literal markup. Nothing built by script, no extra `<script>`.
- No `<iframe>`, `<object>`, `<embed>`, no `<img>` with local paths or `data:` URIs, no
  network requests at all (system fonts only). Icons are inline stroke SVG, never emoji.
- Never write double curly braces anywhere.
- Lay out sibling groups with flex or grid plus `gap`.
- Real elements: `<button>`, `<a href>`, `<input>` with `<label>`. A link between artboards is
  `<a href="Target.dc.html">` styled as the control itself. Never a `<button>` inside a link.
  Icon-only buttons get `aria-label`.
- The map may be one inline `<svg>` including its labels.
- Text contrast at least 4.5 to 1 in both light and dark.
- No em-dashes anywhere. Real content from the sample course, never placeholder text.

## Checking your work

You cannot render a `.dc.html`. Make a stripped plain-HTML copy in your own scratch folder
under
`/private/tmp/claude-501/-Users-stef-Projects-study-tools-lectern/3481f3e4-d8c3-43f4-ac74-fe23851bdf58/scratchpad/`
(drop the support.js line, unwrap `<x-dc>` and `<helmet>` so the style applies) and screenshot
it with headless Chrome. Run ONE Chrome at a time, each with its own `--user-data-dir` inside
your scratch folder, and always under a kill timer, because headless Chrome sometimes never
exits:

```
perl -e 'alarm 30; exec @ARGV' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --user-data-dir=<scratch>/chr-1 --window-size=1100,720 --virtual-time-budget=2000 --screenshot=<scratch>/shot.png "file://<scratch>/copy.html"
```

Look at each screenshot with the Read tool and fix what is wrong: overlaps, clutter, weak
hierarchy, anything off the kit. Hold a high bar: the owner called earlier screens "mid" and
earlier maps "not decent". Before you finish, check with `ps` that no headless Chrome of yours
is still running and stop any that is.

## Report

At most 180 words: the files written, where you had to interpret the kit, what is weakest, and
anything that may fail on the canvas.
