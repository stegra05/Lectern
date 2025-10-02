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
import time
from typing import List, Dict, Any

import config
from anki_connector import add_note, check_connection, store_media_file
from anki_reader import read_examples_from_apkg
from pdf_parser import extract_content_from_pdf
from ai_generator import generate_cards


# --- Simple color utilities for readable CLI output ---
class _C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"


def _fmt_duration(seconds: float) -> str:
    ms = int((seconds - int(seconds)) * 1000)
    m = int(seconds) // 60
    s = int(seconds) % 60
    if m:
        return f"{m}m {s:02d}s {ms:03d}ms"
    return f"{s}s {ms:03d}ms"


class StepTimer:
    """Context manager to time and report a named step.

    Usage:
        with StepTimer("Parse PDF") as t:
            ...
            if failure:
                t.fail("reason")
                return 2
    """

    def __init__(self, name: str) -> None:
        self.name = name
        self._start = 0.0
        self._failed = False
        self._fail_msg = ""

    def __enter__(self) -> "StepTimer":
        self._start = time.perf_counter()
        print(f"{_C.CYAN}▶ {self.name}{_C.RESET}")
        return self

    def fail(self, message: str) -> None:
        self._failed = True
        self._fail_msg = message

    def __exit__(self, exc_type, exc, tb) -> bool:
        elapsed = _fmt_duration(time.perf_counter() - self._start)
        if exc_type is not None:
            print(f"{_C.RED}✖ {self.name} failed in {elapsed}: {exc}{_C.RESET}")
            return False  # propagate
        if self._failed:
            print(f"{_C.RED}✖ {self.name} failed in {elapsed}: {self._fail_msg}{_C.RESET}")
        else:
            print(f"{_C.GREEN}✔ {self.name} done in {elapsed}{_C.RESET}")
        return False


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
        "--context-deck-name",
        required=False,
        default="",
        help="Optional deck name inside the .apkg; defaults to --deck-name",
    )
    parser.add_argument(
        "--model-name",
        required=False,
        default=config.DEFAULT_BASIC_MODEL,
        help="Anki note type/model to use when not specified by AI",
    )
    parser.add_argument(
        "--tags",
        nargs="*",
        default=([config.DEFAULT_TAG] if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG else []),
        help="Tags to apply to created notes",
    )
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    # Debug summary of inputs and configuration (mask secrets)
    key_set = bool(config.GEMINI_API_KEY)
    masked_key = "<set>" if key_set else "<missing>"
    print(f"{_C.MAGENTA}{_C.BOLD}Lectern starting...{_C.RESET}")
    print(f"{_C.BLUE}PDF:{_C.RESET} {args.pdf_path}")
    print(f"{_C.BLUE}Deck:{_C.RESET} {args.deck_name}  {_C.BLUE}Model:{_C.RESET} {args.model_name}")
    print(f"{_C.BLUE}Tags:{_C.RESET} {', '.join(args.tags)}")
    if args.context_apkg_path:
        print(f"{_C.BLUE}Context .apkg:{_C.RESET} {args.context_apkg_path}")
        if getattr(args, "context_deck_name", ""):
            print(f"{_C.BLUE}Context deck:{_C.RESET} {args.context_deck_name}")
    print(f"{_C.BLUE}AnkiConnect:{_C.RESET} {config.ANKI_CONNECT_URL}")
    print(f"{_C.BLUE}GEMINI_API_KEY:{_C.RESET} {masked_key}")

    # Check AnkiConnect availability early
    with StepTimer("Check AnkiConnect") as t:
        if not check_connection():
            print(
                f"{_C.RED}Error: Could not connect to AnkiConnect at {config.ANKI_CONNECT_URL}{_C.RESET}"
            )
            print(
                f"{_C.YELLOW}Ensure Anki is open and the AnkiConnect add-on is installed and enabled.{_C.RESET}"
            )
            t.fail("AnkiConnect unreachable")
            return 2

    # Validate required config for Gemini
    with StepTimer("Validate configuration") as t:
        try:
            config.assert_required_config()
        except ValueError as exc:
            print(f"{_C.RED}Error: {exc}{_C.RESET}")
            t.fail("Missing configuration")
            return 2

    examples = ""
    if args.context_apkg_path:
        with StepTimer("Sample examples from .apkg") as t:
            try:
                examples = read_examples_from_apkg(
                    apkg_path=args.context_apkg_path,
                    deck_name=(args.context_deck_name or args.deck_name),
                    sample_size=5,
                )
                if examples.strip():
                    print(f"{_C.DIM}(Loaded style examples){_C.RESET}")
                else:
                    print(f"{_C.YELLOW}No examples found in the provided deck.{_C.RESET}")
            except Exception as exc:
                print(f"{_C.YELLOW}Warning: Failed to read examples from .apkg: {exc}{_C.RESET}")
                # Not fatal; proceed without examples

    with StepTimer("Parse PDF"):
        pages = extract_content_from_pdf(args.pdf_path)
        print(f"{_C.DIM}Parsed {len(pages)} pages{_C.RESET}")

    with StepTimer("Generate cards with Gemini") as t:
        try:
            cards = generate_cards(pdf_content=[p.__dict__ for p in pages], examples=examples)
        except Exception as exc:
            print(f"{_C.RED}Error during generation: {exc}{_C.RESET}")
            t.fail("Gemini generation error")
            return 2

    if not cards:
        print(f"{_C.YELLOW}No cards were generated.{_C.RESET}")
        return 0

    with StepTimer(f"Create {len(cards)} notes in Anki"):
        created = 0
        for idx, card in enumerate(cards, start=1):
            model_name = str(card.get("model_name") or args.model_name)
            # Normalize common aliases to configured models
            lower_model = model_name.strip().lower()
            if lower_model in ("basic", config.DEFAULT_BASIC_MODEL.lower()):
                model_name = config.DEFAULT_BASIC_MODEL
            elif lower_model in ("cloze", config.DEFAULT_CLOZE_MODEL.lower()):
                model_name = config.DEFAULT_CLOZE_MODEL
            fields: Dict[str, str] = {
                str(k): str(v) for k, v in (card.get("fields") or {}).items()
            }
            # Merge AI-provided tags with CLI defaults and ensure default tag if enabled
            ai_tags = [str(t) for t in (card.get("tags") or [])]
            merged_tags = list(dict.fromkeys(ai_tags + (args.tags or [])))
            if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG and config.DEFAULT_TAG not in merged_tags:
                merged_tags.append(config.DEFAULT_TAG)
            tags = merged_tags

            # Upload any media provided by the AI before adding the note
            for media in card.get("media", []) or []:
                filename = str(media.get("filename") or f"lectern-{idx}.png")
                data_b64 = str(media.get("data") or "")
                try:
                    import base64 as _b64

                    stored_name = store_media_file(filename, _b64.b64decode(data_b64))
                    print(f"  {_C.BLUE}Media:{_C.RESET} uploaded {stored_name}")
                except Exception as exc:
                    print(f"  {_C.YELLOW}Warning: Failed to upload media '{filename}': {exc}{_C.RESET}")

            try:
                note_id = add_note(
                    deck_name=args.deck_name, model_name=model_name, fields=fields, tags=tags
                )
                created += 1
                print(f"  {_C.GREEN}[{created}/{len(cards)}]{_C.RESET} Created note {note_id}")
            except Exception as exc:
                print(f"  {_C.RED}Error creating note {idx}: {exc}{_C.RESET}")

    print(f"{_C.MAGENTA}{_C.BOLD}Done.{_C.RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))



