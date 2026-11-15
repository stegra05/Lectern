"""Vitrine exploration: a copy of ../../build.py that reads the shared templates in ../../anki/
and writes gallery.html, overview.html and media/ into this folder only.

Build gallery.html and the mock slides in media/ from the templates in anki/.

The cards are rendered by Anki's own engine (the `anki` package from PyPI), not by an
imitation: a throwaway collection gets the two Lectern note types with the four templates,
every sample becomes a real note, and card.question() / card.answer() produce the HTML.
The typed-answer step is a port of aqt/reviewer.py (typeAnsQuestionFilter and
typeAnsAnswerFilter), and the comparison itself comes from Anki's backend
(col.compare_answer), so the markup matches what the desktop reviewer shows.

Run:  uv run --with anki python build.py
"""

import html
import json
import os
import re
import tempfile
from pathlib import Path

from anki.collection import Collection
from anki.models import MODEL_CLOZE

ROOT = Path(__file__).parent
ANKI = ROOT.parent.parent / "anki"  # the shared templates, unchanged
MEDIA = ROOT / "media"

QA_FIELDS = ["Front", "Back", "Role", "Slots", "Code", "Typed", "Lecture", "Topic", "Source",
             "Asked", "Part", "Extra", "Excerpt", "Slide", "Diagram", "Key"]
CLOZE_FIELDS = ["Text", "Role", "Typed", "Lecture", "Topic", "Source",
                "Asked", "Part", "Extra", "Excerpt", "Slide", "Diagram", "Key"]

# ---------- Mock source slides (stand-ins for rendered PDF pages) ----------


def slide(name, course, lecture, no, title, bullets, accent, box=None):
    rows = "".join(
        f'<circle cx="78" cy="{262 + i * 74}" r="7" fill="{accent}"/>'
        f'<text x="104" y="{274 + i * 74}" font-size="36" fill="#333">{html.escape(b)}</text>'
        for i, b in enumerate(bullets))
    box_svg = ""
    if box:
        y = 250 + len(bullets) * 74
        box_svg = (f'<rect x="64" y="{y}" width="1472" height="150" rx="8" fill="{accent}" '
                   f'fill-opacity="0.09" stroke="{accent}" stroke-width="3"/>'
                   f'<text x="800" y="{y + 95}" font-size="44" text-anchor="middle" fill="#222" '
                   f'font-family="Georgia, serif">{html.escape(box)}</text>')
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900" font-family="Helvetica, Arial, sans-serif">
<rect width="1600" height="900" fill="#ffffff"/>
<rect width="1600" height="14" fill="{accent}"/>
<text x="64" y="150" font-size="64" font-weight="700" fill="#1d2433">{html.escape(title)}</text>
<rect x="64" y="182" width="120" height="6" fill="{accent}"/>
{rows}{box_svg}
<line x1="64" y1="820" x2="1536" y2="820" stroke="#dddddd" stroke-width="2"/>
<text x="64" y="862" font-size="28" fill="#777">{html.escape(course)} · Lecture {lecture}</text>
<text x="1536" y="862" font-size="28" fill="#777" text-anchor="end">{no}</text>
</svg>"""
    (MEDIA / f"{name}.svg").write_text(svg)
    return f'<img src="media/{name}.svg" alt="Lecture {lecture}, slide {no}">'


ENT = dict(course="Entrepreneurship", accent="#1f5fa8")
ANA = dict(course="Analysis 2", accent="#7a2e8c")
ALG = dict(course="Algorithms", accent="#16794f")
BIO = dict(course="Physiology", accent="#b5462f")

# ---------- The Business Model Canvas, drawn to the diagram rule ----------
# Rule: viewBox at most 300 units wide, labels at least 11 units, strokes and text in
# currentColor, emphasis through the class dg-key. The skin bleeds the figure to about
# 330 px on a 360 px phone, so 11 units render at about 12 px.


def bmc():
    cols = [0, 54, 114, 168, 234, 300]
    top, bottom = 150, 206
    cells = [
        (cols[0], 0, cols[1] - cols[0], top, ["Key", "partners"], False),
        (cols[1], 0, cols[2] - cols[1], top / 2, ["Key", "activities"], False),
        (cols[1], top / 2, cols[2] - cols[1], top / 2, ["Key", "resources"], False),
        (cols[2], 0, cols[3] - cols[2], top, ["Value", "propo-", "sitions"], False),
        (cols[3], 0, cols[4] - cols[3], top / 2, ["Customer", "relation-", "ships"], True),
        (cols[3], top / 2, cols[4] - cols[3], top / 2, ["Channels"], True),
        (cols[4], 0, cols[5] - cols[4], top, ["Customer", "segments"], True),
        (0, top, 150, bottom - top, ["Cost structure"], False),
        (150, top, 150, bottom - top, ["Revenue streams"], True),
    ]
    rects, texts = [], []
    for x, y, w, h, label, key in cells:
        cls = "dg-cell dg-key" if key else "dg-cell"
        rects.append(f'<rect class="{cls}" x="{x + 0.5:g}" y="{y + 0.5:g}" width="{w - 1:g}" '
                     f'height="{h - 1:g}" fill="none" stroke="currentColor"/>')
        for i, line in enumerate(label):
            texts.append(f'<text x="{x + 4:g}" y="{y + 16 + i * 13:g}">{line}</text>')
    axis = ('<text class="dg-axis" x="1" y="221">EFFICIENCY</text>'
            '<text class="dg-axis" x="299" y="221" text-anchor="end">VALUE</text>')
    return ('<svg class="dg" viewBox="0 0 300 224" xmlns="http://www.w3.org/2000/svg" role="img" '
            'aria-label="Business Model Canvas with nine fields" font-size="11" fill="currentColor">'
            + "".join(rects) + "".join(texts) + axis + "</svg>")


CODE = """def find(xs, target):
    lo, hi = 0, len(xs) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        if xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1"""

# ---------- The samples ----------
# Each entry: id, kind, model ("qa" or "cloze"), ord (cloze number shown), fields,
# typed (what the student typed, for typed variants), note (gallery caption).


def samples():
    s = {}
    s["l02-s14"] = slide("l02-s14", lecture=2, no=14, title="Risk versus uncertainty (Knight, 1921)",
                         bullets=["Risk: probabilities can be calculated or known",
                                  "Example: opening a hairdresser shop",
                                  "Uncertainty: probabilities cannot be known"], **ENT)
    s["l02-s21"] = slide("l02-s21", lecture=2, no=21, title="Bird in hand",
                         bullets=["Who I am: traits, tastes, abilities",
                                  "What I know: education, experience",
                                  "Whom I know: social and professional network"],
                         box="Start with your means, not with a goal", **ENT)
    s["l02-s25"] = slide("l02-s25", lecture=2, no=25, title="Causation versus effectuation",
                         bullets=["View of risk: expected return vs affordable loss",
                                  "Starting point: goal vs means",
                                  "Attitude to others: competition vs partnership"], **ENT)
    s["l04-s09"] = slide("l04-s09", lecture=4, no=9, title="Filling the canvas",
                         bullets=["1 Customer segments  2 Value propositions",
                                  "3 Channels  4 Customer relationships",
                                  "5 Revenue streams, then the left side"], **ENT)
    s["l02-s20"] = slide("l02-s20", lecture=2, no=20, title="Five principles of effectuation",
                         bullets=["Bird in hand · Affordable loss", "Crazy quilt · Lemonade",
                                  "Pilot in the plane"], **ENT)
    s["l04-s07"] = slide("l04-s07", lecture=4, no=7, title="The Business Model Canvas",
                         bullets=["Nine building blocks on one page",
                                  "Right side: value, customers, revenue",
                                  "Left side: efficiency, resources, cost"], **ENT)
    s["l03-s12"] = slide("l03-s12", lecture=3, no=12, title="Theorem 3.4 (Cauchy-Schwarz)",
                         bullets=["Let V be an inner product space, u, v in V."],
                         box="|⟨u, v⟩| ≤ ‖u‖ ‖v‖", **ANA)
    s["l01-s18"] = slide("l01-s18", lecture=1, no=18, title="Lemma 1.7",
                         bullets=["Every convergent sequence is bounded.",
                                  "Proof: choose ε = 1 in the definition of the limit."], **ANA)
    s["l05-s06"] = slide("l05-s06", lecture=5, no=6, title="Binary search",
                         bullets=["Input: sorted array xs, value target",
                                  "Compare with the middle, discard half",
                                  "Runtime: O(log n) comparisons"], **ALG)
    s["l08-s15"] = slide("l08-s15", lecture=8, no=15, title="Limits of Dijkstra",
                         bullets=["Assumes non-negative edge weights",
                                  "Settled distances are treated as final",
                                  "Negative weights: use Bellman-Ford"], **ALG)
    s["l04-s30"] = slide("l04-s30", lecture=4, no=30, title="Mitosis versus meiosis",
                         bullets=["Divisions: one vs two", "Daughter cells: 2 diploid vs 4 haploid",
                                  "Genetics: identical vs recombined"],
                         **{**BIO, "course": "Cell biology"})
    s["l09-s11"] = slide("l09-s11", lecture=9, no=11, title="Reading a blood gas",
                         bullets=["pH < 7.35: acidosis", "pCO2 > 45 mmHg: respiratory cause",
                                  "HCO3 raised: renal compensation"], **BIO)

    card1 = dict(
        Front="Knight (1921): what is risk?",
        Back="An outcome whose <mark>probability can be calculated or known</mark>, e.g. opening a hairdresser shop.",
        Role="definition", Lecture="02", Topic="Effectuation", Source="Lecture 2, slide 14",
        Asked="4", Part="short answer", Key="risk",
        Extra="Knight sets risk against uncertainty, where the probabilities cannot be known. Effectuation is a method for uncertainty.",
        Excerpt="Risk: the distribution of outcomes is known, either a priori or from statistics of past cases.",
        Slide=s["l02-s14"])
    card2 = dict(
        Front="Which effectual principle says to start from who you are, what you know and whom you know?",
        Back="<mark>Bird in hand</mark>.",
        Role="reverse", Lecture="02", Topic="Effectuation", Source="Lecture 2, slide 21",
        Asked="6", Part="multiple choice", Key="bird in hand",
        Extra="Start from your means, not from a predefined goal.",
        Excerpt="Bird in hand: start with your means. Who I am, what I know, whom I know.",
        Slide=s["l02-s21"])
    card3 = dict(
        Front="Causation versus effectuation: how does each handle risk?",
        Slots="<span>Causation</span><span>Effectuation</span>",
        Back="<ul><li><mark>Expected return</mark></li><li><mark>Affordable loss</mark></li></ul>",
        Role="contrast", Lecture="02", Topic="Effectuation", Source="Lecture 2, slide 25",
        Asked="5", Part="essay", Key="expected return; affordable loss",
        Extra="Causation picks the option with the best expected outcome. Effectuation fixes in advance what it can afford to lose.",
        Excerpt="Causation: maximise expected return. Effectuation: limit downside to what you can afford to lose.",
        Slide=s["l02-s25"])
    card4 = dict(
        Front="BMC fill order: which two blocks follow segments and value propositions?",
        Slots="<span>Customer segments</span><span>Value propositions</span><span></span><span></span>",
        Back="<ul><li><mark>Channels</mark></li><li><mark>Customer relationships</mark></li></ul>",
        Role="chain", Lecture="04", Topic="Business model", Source="Lecture 4, slide 9",
        Key="BMC fill order",
        Excerpt="Fill order: segments, value propositions, channels, relationships, revenue, then the left side.",
        Slide=s["l04-s09"])
    card5 = dict(
        Text="Sarasvathy's effectual principles<ul><li>{{c1::bird in hand}}</li><li>{{c2::affordable loss}}</li>"
             "<li>{{c3::crazy quilt}}</li><li>{{c4::lemonade}}</li><li>{{c5::pilot in the plane}}</li></ul>",
        Role="cloze-list", Lecture="02", Topic="Effectuation", Source="Lecture 2, slide 20",
        Asked="6", Part="multiple choice", Key="effectual principles",
        Extra="Invest only what you can bear to lose, instead of chasing the largest expected return.",
        Excerpt="The five principles of effectuation (Sarasvathy, 2001).",
        Slide=s["l02-s20"])
    card6 = dict(
        Front="Draw the Business Model Canvas and label all nine fields.",
        Back="<mark>Right side is value</mark>, left side is efficiency.",
        Role="diagram", Lecture="04", Topic="Business model", Source="Lecture 4, slide 7",
        Asked="3", Part="short answer", Key="Business Model Canvas",
        Diagram=bmc(),
        Excerpt="The Business Model Canvas (Osterwalder and Pigneur, 2010): nine building blocks.",
        Slide=s["l04-s07"])
    card7 = dict(
        Front=r"State the Cauchy-Schwarz inequality for \(u, v\) in an inner product space.",
        Back=r"\[ \lvert \langle u, v \rangle \rvert \le \lVert u \rVert \, \lVert v \rVert \]"
             r"Equality holds exactly when \(u\) and \(v\) are <mark>linearly dependent</mark>.",
        Role="formula", Lecture="03", Topic="Inner product spaces", Source="Lecture 3, slide 12",
        Asked="4", Part="proof question", Key="Cauchy-Schwarz inequality",
        Excerpt="Theorem 3.4 (Cauchy-Schwarz). For all u, v in V: |⟨u, v⟩| ≤ ‖u‖ ‖v‖.",
        Slide=s["l03-s12"])
    card8 = dict(
        Front="Why is every convergent sequence bounded?",
        Back=r"<ul><li>Beyond some \(N\), all terms lie <mark>within 1 of the limit</mark>.</li>"
             r"<li>The finitely many earlier terms have a maximum.</li></ul>",
        Role="why", Lecture="01", Topic="Sequences", Source="Lecture 1, slide 18",
        Key="convergent implies bounded",
        Extra=r"So for every \(n\): \[ \lvert a_n \rvert \le \max(\lvert a_1 \rvert, \dots, \lvert a_N \rvert, \lvert a \rvert + 1) \]",
        Excerpt="Lemma 1.7. Every convergent sequence is bounded. Proof: choose ε = 1.",
        Slide=s["l01-s18"])
    card9 = dict(
        Front="What does this function return for a sorted array, and in what time?",
        Code=html.escape(CODE, quote=False),
        Slots="<span>Returns</span><span>Time</span>",
        Back="<ul><li>The index of <code>target</code>, or -1</li><li><mark>O(log n)</mark></li></ul>",
        Role="code", Lecture="05", Topic="Searching", Source="Lecture 5, slide 6",
        Asked="2", Part="short answer", Key="binary search",
        Extra="Each pass halves the range from lo to hi.",
        Excerpt="Binary search: compare with the middle element, discard half of the range.",
        Slide=s["l05-s06"])
    card10 = dict(
        Text="Dijkstra's algorithm fails with {{c1::negative edge weights}} because a settled node's distance {{c2::can still decrease}}.",
        Role="cloze", Lecture="08", Topic="Shortest paths", Source="Lecture 8, slide 15",
        Asked="3", Part="multiple choice", Key="Dijkstra, negative weights",
        Extra="Use Bellman-Ford when negative weights can occur.",
        Excerpt="Dijkstra assumes w(e) ≥ 0: once a node is settled, its distance is final.",
        Slide=s["l08-s15"])
    card11 = dict(
        Front="Name two differences between mitosis and meiosis.",
        Back="<ul><li><mark>One division</mark> versus two.</li><li><mark>Identical</mark> versus recombined daughter cells.</li></ul>",
        Role="name-two", Lecture="04", Topic="Cell division", Source="Lecture 4, slide 30",
        Asked="5", Part="short answer", Key="mitosis versus meiosis",
        Excerpt="Mitosis: one division, two identical diploid cells. Meiosis: two divisions, four haploid cells.",
        Slide=s["l04-s30"])
    card12 = dict(
        Front="Arterial pH 7.30 with raised pCO<sub>2</sub>: which disorder?",
        Back="<mark>Respiratory acidosis</mark>.",
        Role="case", Lecture="09", Topic="Acid-base balance", Source="Lecture 9, slide 11",
        Key="respiratory acidosis",
        Extra="Low pH means acidosis; raised pCO<sub>2</sub> points to the lungs. The kidneys compensate by raising HCO<sub>3</sub><sup>-</sup>.",
        Excerpt="pH below 7.35 with pCO2 above 45 mmHg: respiratory acidosis.",
        Slide=s["l09-s11"])

    return [
        dict(id="1", kind="Business", model="qa", f=card1),
        dict(id="2", kind="Business", model="qa", f=card2),
        dict(id="2t", kind="Business", model="qa", f={**card2, "Typed": "bird in hand"},
             typed="bird in the hand", note='Typed. The student typed "bird in the hand".'),
        dict(id="3", kind="Business", model="qa", f=card3),
        dict(id="3x", kind="Business", model="qa",
             f={**card3, "Back": "Causation aims for the <mark>expected return</mark>; effectuation caps the <mark>affordable loss</mark>."},
             note="Fallback. Back is a sentence, not a two-item list."),
        dict(id="4", kind="Business", model="qa", f=card4),
        dict(id="4x", kind="Business", model="qa",
             f={**card4, "Back": "<mark>Channels</mark>, then <mark>customer relationships</mark>."},
             note="Fallback. Back is a sentence, not a two-item list."),
        dict(id="5", kind="Business", model="cloze", ord=2, f=card5, note="Cloze note, card 2 of 5."),
        dict(id="6", kind="Business", model="qa", f=card6),
        dict(id="7", kind="Mathematics", model="qa", f=card7),
        dict(id="8", kind="Mathematics", model="qa", f=card8),
        dict(id="9", kind="Computer science", model="qa", f=card9),
        dict(id="10", kind="Computer science", model="cloze", ord=1, f=card10, note="Cloze note, card 1 of 2."),
        dict(id="10t", kind="Computer science", model="cloze", ord=1, f={**card10, "Typed": "on"},
             typed="negative weights", note='Typed cloze, card 1 of 2. The student typed "negative weights".'),
        dict(id="11", kind="Life science", model="qa", f=card11),
        dict(id="12", kind="Life science", model="qa", f=card12),
        dict(id="12t", kind="Life science", model="qa", f={**card12, "Typed": "respiratory acidosis"},
             typed="respiratory acidosis", note="Typed. The student typed the answer correctly."),
    ]


# ---------- Anki ----------

TYPE_PAT = re.compile(r"\[\[type:(.+?)\]\]")
# Field font and size as Anki stores them by default; the reviewer inlines them.
TYPE_FONT, TYPE_SIZE = "Arial", 20


def note_types(col):
    mm = col.models
    tpl = {k: (ANKI / f"{k}.html").read_text() for k in ["front", "back", "cloze-front", "cloze-back"]}

    qa = mm.new("Lectern Q&A")
    for name in QA_FIELDS:
        mm.add_field(qa, mm.new_field(name))
    t = mm.new_template("Card")
    t["qfmt"], t["afmt"] = tpl["front"], tpl["back"]
    mm.add_template(qa, t)
    qa["css"] = ""
    qa["sortf"] = QA_FIELDS.index("Key")
    mm.add(qa)

    cz = mm.new("Lectern Cloze")
    cz["type"] = MODEL_CLOZE
    for name in CLOZE_FIELDS:
        mm.add_field(cz, mm.new_field(name))
    t = mm.new_template("Cloze")
    t["qfmt"], t["afmt"] = tpl["cloze-front"], tpl["cloze-back"]
    mm.add_template(cz, t)
    cz["css"] = ""
    cz["sortf"] = CLOZE_FIELDS.index("Key")
    mm.add(cz)
    return mm.by_name("Lectern Q&A"), mm.by_name("Lectern Cloze")


def strip_style(text):
    return re.sub(r"^<style>.*?</style>", "", text, flags=re.S).strip()


def type_question(buf):
    """aqt/reviewer.py typeAnsQuestionFilter, for a field that is set."""
    return TYPE_PAT.sub(
        f"""
<center>
<input type=text id=typeans onkeypress="_typeAnsPress();"
   style="font-family: '{TYPE_FONT}'; font-size: {TYPE_SIZE}px;">
</center>
""", buf)


def type_answer(col, buf, expected, typed):
    """aqt/reviewer.py typeAnsAnswerFilter, without the <hr id=answer> branch (unused)."""
    output = col.compare_answer(expected, typed, True)
    return TYPE_PAT.sub(
        lambda m: f"""
<div style="font-family: '{TYPE_FONT}'; font-size: {TYPE_SIZE}px">{output}</div>""", buf)


def render_all(col, qa, cz, items):
    out = []
    for it in items:
        model = cz if it["model"] == "cloze" else qa
        note = col.new_note(model)
        for k, v in it["f"].items():
            note[k] = v
        col.add_note(note, 1)
        cards = note.cards()
        card = cards[it.get("ord", 1) - 1]
        q = strip_style(card.question())
        a = strip_style(card.answer())
        if TYPE_PAT.search(q):
            m = TYPE_PAT.search(q).group(1)
            field = m.rpartition(":")[2]
            if m.startswith("cloze:"):
                expected = col.extract_cloze_for_typing(note[field], card.ord + 1)
            else:
                expected = note[field]
            q = type_question(q)
            a = type_answer(col, a, expected, it.get("typed", ""))
        f = it["f"]
        role = f["Role"]
        weight = f"asked {f['Asked']}×, {f['Part']}" if f.get("Asked") else "core"
        out.append(dict(id=it["id"], ord=card.ord + 1, kind=it["kind"], role=role,
                        model="Lectern Cloze" if it["model"] == "cloze" else "Lectern Q&A",
                        weight=weight, note=it.get("note", ""), front=q, back=a))
    return out


def main():
    MEDIA.mkdir(exist_ok=True)
    items = samples()
    with tempfile.TemporaryDirectory() as d:
        col = Collection(os.path.join(d, "gallery.anki2"))
        qa, cz = note_types(col)
        rendered = render_all(col, qa, cz, items)
        col.close()
    data = json.dumps(rendered, ensure_ascii=False).replace("</", "<\\/")
    for page in ["gallery", "overview"]:
        shell = (ROOT / f"{page}.src.html").read_text()
        (ROOT / f"{page}.html").write_text(shell.replace("/*CARDS*/[]", data))
    print(f"wrote gallery.html and overview.html with {len(rendered)} cards")


if __name__ == "__main__":
    main()
