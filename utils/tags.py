from __future__ import annotations

import re
from typing import Iterable, List

import config


_NON_ALLOWED = re.compile(r"[^a-z0-9_\-:]+")
_DUP_DASH = re.compile(r"-{2,}")


def _slug_segment(value: str) -> str:
    """Normalize a string for use in Anki tags.

    - lowercase
    - keep ascii letters, digits, underscore, hyphen, and colon (for hierarchy)
    - collapse multiple hyphens
    - trim leading/trailing hyphens and whitespace
    """

    s = (value or "").strip().lower()
    s = _NON_ALLOWED.sub("-", s)
    s = _DUP_DASH.sub("-", s)
    return s.strip("-")


def _deck_path_slug(deck_name: str) -> str:
    """Convert a deck name possibly containing subdecks into a tag path.

    Anki uses '::' for deck hierarchy; we preserve it after slugging segments.
    We also support '/' separators for user convenience.
    """

    parts = re.split(r"::|/", str(deck_name or ""))
    clean = [_slug_segment(p) for p in parts if p and p.strip()]
    return "::".join([p for p in clean if p])


def build_grouped_tags(deck_name: str, tags: Iterable[str]) -> List[str]:
    """Return tags grouped under deck hierarchy, with optional root namespace.

    Examples
    - deck: "Econ::Macro", tag: "gdp" -> "econ::macro::gdp"
    """

    deck_path = _deck_path_slug(deck_name)
    normalized_tags = [_slug_segment(t) for t in tags if isinstance(t, (str, int)) and str(t).strip()]

    if not deck_path:
        return normalized_tags

    prefix = deck_path + "::"
    return [prefix + t for t in normalized_tags]


