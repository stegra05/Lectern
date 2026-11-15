# Canvas copies

`project/` is a copy of the design canvas (https://claude.ai/artifact/E4ZxyLc4DdB7HK3CgoQ1XE).
The canvas is the source of truth for screens and was edited by hand after this copy, so read a
screen back from the canvas before trusting its copy here. Pages: "Direction v2" (`V2*.dc.html`,
drawn to [`../KIT.md`](../KIT.md)), "Alternatives" (`Alt*.dc.html`, the options of the second
review), "Card designs" (`Card*.dc.html`). Why each one won or lost:
[RFD 11](../../docs/rfd/0011-app-shape.md) and [RFD 10](../../docs/rfd/0010-card-designs.md).

## Drawing a new artboard

Every violation of the format fails silently on the canvas.

- Copy the skeleton of `AltLangC1.dc.html` exactly: the doctype, the
  `<script src="./support.js"></script>` line, `<x-dc>`, `<helmet>` with only `body{margin:0}`
  and link colours, one root `<div>` at `height: 100vh`, and the closing `data-dc-script` block
  with `$preview` 1100 by 720.
- All styling inline. No CSS variables, no classes that need a stylesheet.
- All interface is literal markup: no extra `<script>`, `<iframe>`, `<object>`, `<embed>`, no
  `<img>` with a local path or `data:` URI, no network request. System fonts only. Icons are
  inline stroke SVG, never emoji.
- Never write double curly braces anywhere.
- Close every element, quote every attribute, single quotes for font names inside attributes.
- A link between artboards is `<a href="Target.dc.html">` styled as the control. Never a
  `<button>` inside a link. Icon-only buttons get `aria-label`.
- Text contrast at least 4.5 to 1 in light and dark. No em-dashes. Real content, never
  placeholder text.

A `.dc.html` cannot be rendered directly. To check one, strip it to plain HTML (drop the
`support.js` line, unwrap `<x-dc>` and `<helmet>`) and screenshot that with headless Chrome under
a kill timer, one Chrome at a time.

## Sample content

Course A, Entrepreneurship: 11 lectures (01 What and who to 11 Corporate entrepreneurship), goal
top grade, ready by 6 February, 20 minutes a day; 58 concepts, 412 cards, 9 new cards a day with
a holiday break from 21 December to 3 January. Exam format line: "90 minutes: multiple choice,
six short answers, two essays." Course B, Analysis 2: 13 lectures, 5 delivered, 214 cards.
Scale test: Human Physiology, 20 lectures, 116 concepts, 800 cards.
