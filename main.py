"""
Lectern CLI entry point.

This orchestrates the workflow:
1) Optionally sample few-shot examples from an .apkg deck
2) Parse the PDF into text and images
3) Generate card specifications via Gemini
4) Upload media and add notes via AnkiConnect
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Dict, Any

from . import config
from .anki_connector import add_note, check_connection, store_media_file
from .anki_reader import read_examples_from_apkg
from .pdf_parser import extract_content_from_pdf
from .ai_generator import generate_cards


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lectern: Generate Anki cards from lecture PDFs")
    parser.add_argument("--pdf-path", required=True, help="Path to the lecture PDF")
    parser.add_argument("--deck-name", required=True, help="Destination Anki deck name")
    parser.add_argument(
        "--context-apkg-path",
        required=False,
        default="",
        help="Optional path to an .apkg for few-shot style guidance",
    )
    parser.add_argument(
        "--model-name",
        required=False,
        default="Basic",
        help="Anki note type/model to use when not specified by AI",
    )
    parser.add_argument(
        "--tags",
        nargs="*",
        default=["lectern"],
        help="Tags to apply to created notes",
    )
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    # Check AnkiConnect availability early
    print("Checking AnkiConnect...")
    if not check_connection():
        print("Error: Could not connect to AnkiConnect at", config.ANKI_CONNECT_URL)
        print("Ensure Anki is open and the AnkiConnect add-on is installed and enabled.")
        return 2

    # Validate required config for Gemini
    if not config.GEMINI_API_KEY:
        print("Error: GEMINI_API_KEY is not set in the environment.")
        return 2

    examples = ""
    if args.context_apkg_path:
        print("Sampling examples from .apkg for style guidance...")
        try:
            examples = read_examples_from_apkg(
                apkg_path=args.context_apkg_path, deck_name=args.deck_name, sample_size=5
            )
        except Exception as exc:
            print("Warning: Failed to read examples from .apkg:", exc)

    print("Parsing PDF...")
    pages = extract_content_from_pdf(args.pdf_path)
    print(f"Parsed {len(pages)} pages.")

    print("Generating cards with Gemini (this may take a moment)...")
    try:
        cards = generate_cards(pdf_content=[p.__dict__ for p in pages], examples=examples)
    except Exception as exc:
        print("Error during generation:", exc)
        return 2

    if not cards:
        print("No cards were generated.")
        return 0

    print(f"Creating {len(cards)} notes in Anki...")
    created = 0
    for idx, card in enumerate(cards, start=1):
        model_name = str(card.get("model_name") or args.model_name)
        fields: Dict[str, str] = {
            str(k): str(v) for k, v in (card.get("fields") or {}).items()
        }
        tags = [str(t) for t in (card.get("tags") or args.tags)]

        # Upload any media provided by the AI before adding the note
        for media in card.get("media", []) or []:
            filename = str(media.get("filename") or f"lectern-{idx}.png")
            data_b64 = str(media.get("data") or "")
            try:
                import base64 as _b64

                stored_name = store_media_file(filename, _b64.b64decode(data_b64))
                # Optionally let the user know what was uploaded
                print(f"  Uploaded media: {stored_name}")
            except Exception as exc:
                print(f"  Warning: Failed to upload media '{filename}': {exc}")

        try:
            note_id = add_note(
                deck_name=args.deck_name, model_name=model_name, fields=fields, tags=tags
            )
            created += 1
            print(f"  [{created}/{len(cards)}] Created note {note_id}")
        except Exception as exc:
            print(f"  Error creating note {idx}: {exc}")

    print(f"Done. Created {created} notes.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))



