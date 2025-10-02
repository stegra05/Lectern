"""
Read-only utilities for sampling notes from an Anki .apkg file.

This module's purpose is to extract representative examples from a user's deck
to guide the AI's style via few-shot prompting. It never writes to or modifies
the user's collection files.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from typing import Dict, List, Tuple


def unpack_apkg_to_temp(apkg_path: str) -> Tuple[str, str]:
    """Unpack an .apkg archive into a temporary directory.

    Parameters:
        apkg_path: Path to the .apkg file (a zip archive).

    Returns:
        A tuple of (temporary_directory, collection_db_path).

    Raises:
        FileNotFoundError: If the .apkg does not exist.
        RuntimeError: If the collection.anki2 database cannot be located.
    """

    if not os.path.isfile(apkg_path):
        raise FileNotFoundError(f".apkg not found: {apkg_path}")

    temp_dir = tempfile.mkdtemp(prefix="lectern_apkg_")
    with zipfile.ZipFile(apkg_path, "r") as zf:
        zf.extractall(temp_dir)

    # Locate the collection database
    collection_db_path = None
    for root, _dirs, files in os.walk(temp_dir):
        if "collection.anki2" in files:
            collection_db_path = os.path.join(root, "collection.anki2")
            break

    if not collection_db_path:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise RuntimeError("collection.anki2 not found in the provided .apkg")

    return temp_dir, collection_db_path


def _resolve_deck_id(conn: sqlite3.Connection, deck_name: str) -> int:
    """Resolve a deck ID for a given deck name.

    Tries exact match first, then case-insensitive and normalized comparisons.
    Supports modern Anki schemas via the `decks` table and provides a fallback
    for legacy schemas by reading from the `col` table JSON.
    """

    def _normalize(name: str) -> str:
        return "::".join(part.strip().lower() for part in name.split("::"))

    target_exact = deck_name
    target_norm = _normalize(deck_name)

    # Preferred: decks table
    try:
        # Exact match
        row = conn.execute(
            "SELECT id FROM decks WHERE name = ? LIMIT 1", (target_exact,)
        ).fetchone()
        if row and isinstance(row[0], int):
            return row[0]

        # Case-insensitive/normalized match across all decks
        rows = conn.execute("SELECT id, name FROM decks").fetchall()
        best_ci_id = None
        best_norm_id = None
        for did, name in rows:
            if isinstance(name, str):
                if name.lower() == target_exact.lower():
                    best_ci_id = did
                if _normalize(name) == target_norm:
                    best_norm_id = did
        if best_ci_id is not None:
            return int(best_ci_id)
        if best_norm_id is not None:
            return int(best_norm_id)
    except sqlite3.Error:
        pass

    # Fallback: decks JSON stored in col table
    try:
        row = conn.execute("SELECT decks FROM col LIMIT 1").fetchone()
        if row and row[0]:
            decks_json = json.loads(row[0])
            # Exact
            for deck in decks_json.values():
                name = str(deck.get("name", ""))
                if name == target_exact:
                    return int(deck["id"])  # type: ignore[arg-type]
            # Case-insensitive / normalized
            for deck in decks_json.values():
                name = str(deck.get("name", ""))
                if name.lower() == target_exact.lower() or _normalize(name) == target_norm:
                    return int(deck["id"])  # type: ignore[arg-type]
    except (sqlite3.Error, json.JSONDecodeError, KeyError, ValueError):
        pass

    # Build helpful error with available deck names
    try:
        names: List[str] = []
        try:
            for (name,) in conn.execute("SELECT name FROM decks"):
                if isinstance(name, str):
                    names.append(name)
        except sqlite3.Error:
            pass
        if not names:
            row = conn.execute("SELECT decks FROM col LIMIT 1").fetchone()
            if row and row[0]:
                decks_json = json.loads(row[0])
                names = [str(d.get("name", "")) for d in decks_json.values()]
        available = ", ".join(sorted(n for n in names if n)) or "<none>"
        raise ValueError(f"Deck not found: {deck_name}. Available: {available}")
    except Exception:
        raise ValueError(f"Deck not found: {deck_name}")


def get_sample_notes(db_path: str, deck_name: str, sample_size: int = 5) -> List[Dict[str, object]]:
    """Retrieve a small sample of notes' fields from a deck.

    Parameters:
        db_path: Path to the collection.anki2 SQLite database.
        deck_name: Exact name of the deck to sample from.
        sample_size: Number of notes to return.

    Returns:
        A list of dictionaries with keys: note_id, model_id, fields (List[str]).

    Notes:
        - This function avoids modifying the database and opens it in read-only
          mode when supported by the OS.
        - Fields in Anki are stored concatenated with a unit separator (\x1f).
    """

    # Open read-only if possible
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        deck_id = _resolve_deck_id(conn, deck_name)

        # Join cards to notes to filter by deck
        query = (
            "SELECT n.id, n.mid, n.flds "
            "FROM cards c JOIN notes n ON c.nid = n.id "
            "WHERE c.did = ? "
            "GROUP BY n.id "
            "LIMIT ?"
        )
        rows = conn.execute(query, (deck_id, sample_size)).fetchall()

        samples: List[Dict[str, object]] = []
        for nid, mid, flds in rows:
            if not isinstance(flds, str):
                continue
            fields_list = flds.split("\x1f")
            samples.append(
                {"note_id": int(nid), "model_id": int(mid), "fields": fields_list}
            )
        return samples
    finally:
        conn.close()


def format_notes_for_examples(notes: List[Dict[str, object]]) -> str:
    """Format a list of sampled notes into a few-shot examples string.

    The resulting text is intended to be prepended to the AI prompt to guide
    style and field usage. Each note is rendered in a compact, human-readable
    form without HTML.
    """

    lines: List[str] = []
    for idx, note in enumerate(notes, start=1):
        fields = [str(f) for f in note.get("fields", [])]  # type: ignore[list-item]
        lines.append(f"Example {idx}:")
        for f_idx, field_value in enumerate(fields, start=1):
            lines.append(f"  Field {f_idx}: {field_value}")
        lines.append("")
    return "\n".join(lines).strip()


def read_examples_from_apkg(apkg_path: str, deck_name: str, sample_size: int = 5) -> str:
    """High-level helper to unpack, sample, format, and clean up.

    Parameters:
        apkg_path: Path to the .apkg file to sample from.
        deck_name: Deck name used to filter notes.
        sample_size: Number of sample notes to include.

    Returns:
        A formatted string suitable for few-shot prompting, or an empty string
        if sampling fails or yields no results.
    """

    temp_dir = None
    try:
        temp_dir, db_path = unpack_apkg_to_temp(apkg_path)
        notes = get_sample_notes(db_path, deck_name=deck_name, sample_size=sample_size)
        if not notes:
            return ""
        return format_notes_for_examples(notes)
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


