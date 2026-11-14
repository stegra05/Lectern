"""Master of the Lectern v3 icon: the hand of stops.

Four lecture stops (02 to 05, course order left to right) fan out like a hand of cards behind
the 01 stop, whose face is a card with a cloze gap. Writes into master/:
  lectern-{light,dark,tinted}.svg        1024 canvas, 824 squircle on Apple's macOS grid
  layers/{appearance}-{back,front}.svg   full-bleed, unmasked layers for Icon Composer
export.sh copies the result to every place the repository uses an icon.
"""

import math
from pathlib import Path

OUT = Path(__file__).parent / "master"
(OUT / "layers").mkdir(parents=True, exist_ok=True)

# Lecture colours 02 to 05 of design/v3/KIT.md; 01 is the card stop in front.
STOPS = ["#FF7A33", "#FFA3D1", "#A487FF", "#7FD0FF"]

APPEARANCES = {
    "light": dict(ground="#FFFFFF", face="#FFC629", bar="#1D1D1F", gap="#FFFFFF", tint=False),
    "dark": dict(ground="#1C1C1E", face="#FFC629", bar="#1D1D1F", gap="#FFFFFF", tint=False),
    # The system colours a greyscale glyph, so the stops step through white opacities.
    "tinted": dict(ground="#1C1C1E", face="#F2F2F7", bar="#1C1C1E", gap="#8E8E93", tint=True),
}

# Centred optically: the fan's mass sits a hair above the true centre so the drooping wings
# do not feel low. The edge is the ground-coloured outline that keeps every stop separate.
PIVOT_Y, SIZE, TOP, EDGE = 990, 270, 364, 18
ANGLES = [-23, -11.5, 11.5, 23]


def back(a):
    """The four lecture stops, drawn outside-in so the inner ones overlap the outer."""
    s = ""
    widest = max(map(abs, ANGLES))
    for i in sorted(range(len(ANGLES)), key=lambda i: -abs(ANGLES[i])):
        fill = f'fill="{STOPS[i]}"'
        if a["tint"]:
            fill = f'fill="#FFFFFF" fill-opacity="{0.28 + 0.32 * (1 - abs(ANGLES[i]) / widest):.2f}"'
        s += (f'    <g transform="rotate({ANGLES[i]} 512 {PIVOT_Y})">\n'
              f'      <rect x="{512 - SIZE / 2}" y="{TOP}" width="{SIZE}" height="{SIZE}" rx="{SIZE * 0.27:.1f}" '
              f'{fill} stroke="{a["ground"]}" stroke-width="{EDGE}" paint-order="stroke"/>\n'
              f'    </g>\n')
    return s


def front(a):
    """The 01 stop with its card face, on an edge of ground colour."""
    e = SIZE + EDGE
    k = SIZE / 340
    return (f'    <rect x="{512 - e / 2}" y="{TOP + SIZE / 2 - e / 2}" width="{e}" height="{e}" '
            f'rx="{e * 0.27:.1f}" fill="{a["ground"]}"/>\n'
            f'    <g transform="translate(512 {TOP + SIZE / 2}) scale({k:.4f})">\n'
            f'      <rect x="-170" y="-170" width="340" height="340" rx="92" fill="{a["face"]}"/>\n'
            f'      <rect x="-114" y="-92" width="200" height="34" rx="17" fill="{a["bar"]}"/>\n'
            f'      <rect x="-114" y="-34" width="228" height="58" rx="16" fill="{a["gap"]}"/>\n'
            f'      <rect x="-114" y="48" width="150" height="34" rx="17" fill="{a["bar"]}" opacity="0.45"/>\n'
            f'    </g>\n')


def squircle(cx=512, cy=512, half=412, n=4.6, steps=240):
    """Superellipse close to Apple's continuous-corner icon shape."""
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = cx + half * math.copysign(abs(c) ** (2 / n), c)
        y = cy + half * math.copysign(abs(s) ** (2 / n), s)
        pts.append(f"{x:.2f} {y:.2f}")
    return "M" + " L".join(pts) + " Z"


def svg(body):
    return f'<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">\n{body}</svg>\n'


shape = squircle()
for name, a in APPEARANCES.items():
    (OUT / f"lectern-{name}.svg").write_text(svg(
        f'  <defs><clipPath id="sq"><path d="{shape}"/></clipPath></defs>\n'
        f'  <g clip-path="url(#sq)">\n    <rect width="1024" height="1024" fill="{a["ground"]}"/>\n'
        f'{back(a)}{front(a)}  </g>\n'))
    # Icon Composer masks the whole canvas, so the glyph is scaled from the 824 body to 1024.
    for part, content in [("back", back(a)), ("front", front(a))]:
        (OUT / "layers" / f"{name}-{part}.svg").write_text(svg(
            f'  <g transform="translate(512 512) scale({1024 / 824:.5f}) translate(-512 -512)">\n{content}  </g>\n'))
