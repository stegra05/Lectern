"""Afterglow (night) gallery: the shared build, pointed at this folder.

Imports ../../build.py unchanged, so the cards still come from Anki's own engine and the
shared templates in ../../anki. Only the output moves here: the mock slides go to ./media
and the shells are ./gallery.src.html and ./overview.src.html, which links ../../anki/style-night.css.

Run:  uv run --with anki python build.py
"""

import importlib.util
import json
import os
import tempfile
from pathlib import Path

from anki.collection import Collection

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("shared_build", HERE.parent.parent / "build.py")
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
shared.MEDIA = HERE / "media"


def main():
    shared.MEDIA.mkdir(exist_ok=True)
    items = shared.samples()
    with tempfile.TemporaryDirectory() as d:
        col = Collection(os.path.join(d, "gallery.anki2"))
        qa, cz = shared.note_types(col)
        rendered = shared.render_all(col, qa, cz, items)
        col.close()
    data = json.dumps(rendered, ensure_ascii=False).replace("</", "<\\/")
    for name in ["gallery", "overview"]:
        shell = (HERE / f"{name}.src.html").read_text()
        (HERE / f"{name}.html").write_text(shell.replace("/*CARDS*/[]", data))
    print(f"wrote gallery.html and overview.html with {len(rendered)} cards")


if __name__ == "__main__":
    main()
