"""Write the lecture palette into packages/engine/anki/style-colours.css and print its contrast table.

The twelve colours are the app's lecture colours (design/KIT.md, "Lecture colours"), in
that order, repeating from lecture 13. Every lecture number Lectern can write (01 to 99)
gets a rule, so no card falls back to grey because the course is long.

The cards use the hue softly: the full colour only for the numeral stop and small accents.
Per lecture: --lc (the colour itself), --lc-tint (light head and answer fill, the colour
mixed into white), --lc-mid (light key term and filled cloze), --lc-edge (light edges, the
colour mixed into ink), --lc-deep (night head and answer fill), --lc-nedge (night edges)
and --lc-nmark (night key term and filled cloze), the last three mixed into the night sheet. The hex values are precomputed so the stylesheet needs no color-mix().

Run:  python3 palette.py
"""

import re
from pathlib import Path

CSS = Path(__file__).parent.parent.parent / "packages" / "engine" / "anki" / "style-colours.css"
KIT = ["#FFC629", "#FF7A33", "#FFA3D1", "#A487FF", "#7FD0FF", "#FF6B6B",
       "#B6E33A", "#1FB5B0", "#56E0B0", "#7B93FF", "#DDB3FF", "#E8C39E"]
INK = "#1D1D1F"          # numerals and text on a colour fill, both modes (KIT)
NIGHT_INK = "#F2F2F7"
NIGHT_GROUND = "#1C1C1E"
NIGHT_SHEET = "#2C2C2E"
TINT, MID, EDGE, DEEP, NEDGE, NMARK = 0.20, 0.55, 0.50, 0.24, 0.62, 0.82  # share of the lecture colour in each mix


def rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def hexs(c):
    return "#" + "".join(f"{round(v):02X}" for v in c)


def mix(a, b, t):
    return hexs([x * t + y * (1 - t) for x, y in zip(rgb(a), rgb(b))])


def lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main():
    rows, worst = [], {}
    for i, c in enumerate(KIT):
        tint, mid = mix(c, "#FFFFFF", TINT), mix(c, "#FFFFFF", MID)
        edge, deep = mix(c, INK, EDGE), mix(c, NIGHT_SHEET, DEEP)
        nedge, nmark = mix(c, NIGHT_SHEET, NEDGE), mix(c, NIGHT_SHEET, NMARK)
        checks = {
            "ink on colour": cr(INK, c),
            "ink on light fill": cr(INK, tint),
            "ink on light mark": cr(INK, mid),
            "light edge on white": cr(edge, "#FFFFFF"),
            "light edge on light fill": cr(edge, tint),
            "night text on night fill": cr(NIGHT_INK, deep),
            "colour on night ground": cr(c, NIGHT_GROUND),
            "night edge on night ground": cr(nedge, NIGHT_GROUND),
            "ink on night mark": cr(INK, nmark),
            "label on light fill": cr("#3A3A3C", tint),
            "label on night fill": cr("#E5E5EA", deep),
        }
        for k, v in checks.items():
            worst[k] = min(worst.get(k, 99), v)
        rows.append((i + 1, c, tint, mid, edge, deep, nedge, nmark, checks))
    lines = []
    for n in range(1, 100):
        _, c, tint, mid, edge, deep, nedge, nmark, _ = rows[(n - 1) % 12]
        lines.append(f".lc.lec-{n:02d} {{ --lc: {c}; --lc-tint: {tint}; --lc-mid: {mid}; --lc-edge: {edge}; "
                     f"--lc-deep: {deep}; --lc-nedge: {nedge}; --lc-nmark: {nmark}; }}")
    block = "/* palette:start (written by design/cards/palette.py) */\n" + "\n".join(lines) + "\n/* palette:end */"
    s = CSS.read_text()
    s = re.sub(r"/\* palette:start.*?/\* palette:end \*/", lambda m: block, s, flags=re.S)
    CSS.write_text(s)
    print("| Lecture | Colour | Light fill / mark / edge | Night fill / mark / edge | Ink on colour | Ink on light fill / mark | Light edge on white | Night text on fill | Ink on night mark | Night edge on ground |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for n, c, tint, mid, edge, deep, nedge, nmark, k in rows:
        print(f"| {n:02d}, {n + 12} | `{c}` | `{tint}` `{mid}` `{edge}` | `{deep}` `{nmark}` `{nedge}` | {k['ink on colour']:.1f} | "
              f"{k['ink on light fill']:.1f} / {k['ink on light mark']:.1f} | {k['light edge on white']:.1f} | "
              f"{k['night text on night fill']:.1f} | {k['ink on night mark']:.1f} | {k['night edge on night ground']:.1f} |")
    print("\nworst:", {k: round(v, 1) for k, v in worst.items()})


if __name__ == "__main__":
    main()
