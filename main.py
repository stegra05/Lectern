"""
Lectern CLI entry point.

This orchestrates the workflow:
1) Optionally sample few-shot examples from a live Anki deck via AnkiConnect
2) Parse the PDF into text and images
3) Generate card specifications via Gemini
4) Upload media and add notes via AnkiConnect
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import List, Dict

import config
from anki_connector import add_note, check_connection, store_media_file, sample_examples_from_deck
from pdf_parser import extract_content_from_pdf
from ai_generator import (
    start_single_session,
    chat_concept_map,
    chat_generate_more_cards,
    chat_reflect,
)
from utils.cli import C as _C, StepTimer, set_verbosity, is_quiet, is_verbose, Progress, vprint

# Optional rich progress bars
try:
    from rich.progress import Progress as RichProgress
    from rich.progress import BarColumn, TimeElapsedColumn, TimeRemainingColumn, TextColumn
    _HAS_RICH = True
except Exception:
    _HAS_RICH = False


# CLI helpers are now provided by utils.cli


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lectern: Generate Anki cards from lecture PDFs")
    parser.add_argument("--pdf-path", required=False, default="", help="Path to the lecture PDF")
    parser.add_argument("--deck-name", required=False, default="", help="Destination Anki deck name")
    parser.add_argument(
        "--context-deck",
        required=False,
        default="",
        help="Optional deck name to sample 5 notes via AnkiConnect for style guidance",
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
    parser.add_argument(
        "--max-notes-per-batch",
        type=int,
        default=config.MAX_NOTES_PER_BATCH,
        help="Maximum number of cards generated per turn",
    )
    parser.add_argument(
        "--reflection-rounds",
        type=int,
        default=config.REFLECTION_MAX_ROUNDS,
        help="Maximum number of reflection iterations",
    )
    parser.add_argument(
        "--enable-reflection",
        action="store_true" if config.ENABLE_REFLECTION else "store_false",
        default=config.ENABLE_REFLECTION,
        help="Enable reflection phase after generation",
    )
    verbosity = parser.add_mutually_exclusive_group()
    verbosity.add_argument("--quiet", action="store_true", help="Reduce output to essential errors only")
    verbosity.add_argument("--verbose", action="store_true", help="Increase output with detailed status and AI snippets")
    parser.add_argument("--interactive", action="store_true", help="Prompt for missing inputs and confirmations")

    # Optional: enable argcomplete if installed
    try:
        import argcomplete  # type: ignore

        argcomplete.autocomplete(parser)
    except Exception:
        pass
    return parser.parse_args(argv)


def _prompt(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def _validate_pdf_path(path: str) -> bool:
    try:
        return bool(path) and os.path.isfile(path) and os.access(path, os.R_OK)
    except Exception:
        return False


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    # Set verbosity early
    set_verbosity(0 if args.quiet else (2 if args.verbose else 1))

    # Interactive mode: prompt for missing required inputs
    if args.interactive:
        if not args.pdf_path:
            args.pdf_path = _prompt("Path to the lecture PDF")
        if not args.deck_name:
            args.deck_name = _prompt("Destination Anki deck name")
        # Optional prompts with defaults
        args.model_name = _prompt("Default Anki model", args.model_name)
        if not args.context_deck:
            # default to deck name
            args.context_deck = args.deck_name
        tags_str = _prompt("Tags (space-separated)", " ".join(args.tags or []))
        args.tags = [t for t in tags_str.split() if t]

    # Validate required inputs for non-interactive runs
    if not args.pdf_path or not args.deck_name:
        print(f"{_C.RED}Error: --pdf-path and --deck-name are required (or use --interactive).{_C.RESET}")
        return 2

    # Debug summary of inputs and configuration (mask secrets)
    key_set = bool(config.GEMINI_API_KEY)
    masked_key = "<set>" if key_set else "<missing>"
    if not is_quiet():
        print(f"{_C.MAGENTA}{_C.BOLD}Lectern starting...{_C.RESET}")
        print(f"{_C.BLUE}PDF:{_C.RESET} {args.pdf_path}")
        print(f"{_C.BLUE}Deck:{_C.RESET} {args.deck_name}  {_C.BLUE}Model:{_C.RESET} {args.model_name}")
        print(f"{_C.BLUE}Tags:{_C.RESET} {', '.join(args.tags)}")
        if getattr(args, "context_deck", ""):
            print(f"{_C.BLUE}Context deck:{_C.RESET} {args.context_deck}")
        print(f"{_C.BLUE}AnkiConnect:{_C.RESET} {config.ANKI_CONNECT_URL}")
        print(f"{_C.BLUE}GEMINI_API_KEY:{_C.RESET} {masked_key}")
        print(f"{_C.DIM}(Config) batch={config.MAX_NOTES_PER_BATCH} reflection_rounds={config.REFLECTION_MAX_ROUNDS} reflection_enabled={config.ENABLE_REFLECTION}{_C.RESET}")

    # Start total timer
    _run_start = time.perf_counter()

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

    # Validate PDF path early
    with StepTimer("Validate inputs") as t:
        if not _validate_pdf_path(args.pdf_path):
            print(f"{_C.RED}Error: PDF not found or not readable: {args.pdf_path}{_C.RESET}")
            print(f"{_C.YELLOW}Tip: Check the path and permissions; use an absolute path if unsure.{_C.RESET}")
            t.fail("Invalid PDF path")
            return 2

    examples = ""
    with StepTimer("Sample examples via AnkiConnect") as t:
        try:
            deck_for_examples = (args.context_deck or args.deck_name)
            examples = sample_examples_from_deck(deck_name=deck_for_examples, sample_size=5)
            if examples.strip():
                print(f"{_C.DIM}(Loaded style examples via AnkiConnect){_C.RESET}")
            else:
                t.fail("No examples found via AnkiConnect")
        except Exception as exc:
            print(f"{_C.YELLOW}Warning: Failed to sample examples via AnkiConnect: {exc}{_C.RESET}")
            # proceed without examples

    with StepTimer("Parse PDF"):
        pages = extract_content_from_pdf(args.pdf_path)
        vprint(f"{_C.DIM}Parsed {len(pages)} pages{_C.RESET}", level=1)

    # Start a single chat session
    with StepTimer("Start AI session"):
        chat, session_log = start_single_session()

    # Helpers for dedupe
    def _normalize_card_key(card: Dict[str, str]) -> str:
        fields = card.get("fields") or {}
        value = str(fields.get("Text") or fields.get("Front") or "")
        return " ".join(value.lower().split())

    

    # Phase 0: Concept map in chat
    concept_map: Dict = {}
    with StepTimer("Build global concept map") as t:
        try:
            concept_map = chat_concept_map(chat, [p.__dict__ for p in pages], session_log)
            obj = concept_map.get("objectives") if isinstance(concept_map, dict) else None
            concept_count = len(concept_map.get("concepts", [])) if isinstance(concept_map, dict) else 0
            vprint(f"{_C.DIM}[ConceptMap] objectives={len(obj) if isinstance(obj, list) else 0} concepts={concept_count}{_C.RESET}", level=1)
        except Exception as exc:
            print(f"{_C.YELLOW}Warning: Concept map failed ({exc}); proceeding without it.{_C.RESET}")
            concept_map = {}

    # Phase 1: Generation turns in chat
    all_cards: List[Dict] = []
    seen_keys = set()
    max_batch = int(getattr(args, "max_notes_per_batch", config.MAX_NOTES_PER_BATCH))
    with StepTimer("Generate cards") as t:
        # Prime with examples and concept map before generation
        if examples.strip():
            try:
                chat.send_message([{ "text": f"Style examples to follow:\n{examples}" }])
            except Exception:
                pass
        if concept_map:
            try:
                cm_json = json.dumps(concept_map, ensure_ascii=False)
                chat.send_message([{ "text": f"Global concept map (JSON):\n{cm_json}" }])
            except Exception:
                pass
        # Iteratively request more cards until the model indicates done or no additions
        total_turns_cap = 50
        if _HAS_RICH and not is_quiet():
            with RichProgress(
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                "{task.completed}/" + str(total_turns_cap),
                TimeElapsedColumn(),
                TimeRemainingColumn(),
                transient=True,
            ) as rp:
                task = rp.add_task("Generation", total=total_turns_cap)
                for _ in range(total_turns_cap):
                    out = chat_generate_more_cards(chat, limit=max_batch, log_path=session_log)
                    additions = 0
                    for card in out.get("cards", []) or []:
                        key = _normalize_card_key(card)
                        if key and key not in seen_keys:
                            seen_keys.add(key)
                            all_cards.append(card)
                            additions += 1
                    vprint(f"{_C.DIM}[Gen] Added {additions} unique cards (total {len(all_cards)}) done={bool(out.get('done'))}{_C.RESET}", level=2)
                    rp.advance(task, 1)
                    if out.get("done") or additions == 0:
                        break
        else:
            p = Progress(total=total_turns_cap, label="Generation turns")
            for turn_idx in range(total_turns_cap):  # hard cap to avoid accidental loops
                out = chat_generate_more_cards(chat, limit=max_batch, log_path=session_log)
                additions = 0
                for card in out.get("cards", []) or []:
                    key = _normalize_card_key(card)
                    if key and key not in seen_keys:
                        seen_keys.add(key)
                        all_cards.append(card)
                        additions += 1
                vprint(f"{_C.DIM}[Gen] Added {additions} unique cards (total {len(all_cards)}) done={bool(out.get('done'))}{_C.RESET}", level=1)
                p.update(turn_idx + 1)
                if out.get("done") or additions == 0:
                    break

    # Phase 2: Reflection
    if getattr(args, "enable_reflection", config.ENABLE_REFLECTION):
        with StepTimer("Reflection and improvement") as t:
            try:
                rounds = int(getattr(args, "reflection_rounds", config.REFLECTION_MAX_ROUNDS))
                total_rounds = max(0, rounds)
                if _HAS_RICH and not is_quiet():
                    with RichProgress(
                        TextColumn("[progress.description]{task.description}"),
                        BarColumn(),
                        "{task.completed}/" + str(total_rounds),
                        TimeElapsedColumn(),
                        TimeRemainingColumn(),
                        transient=True,
                    ) as rp:
                        task = rp.add_task("Reflection", total=total_rounds or 1)
                        for round_idx in range(total_rounds):
                            out = chat_reflect(chat, limit=max_batch, log_path=session_log)
                            additions = 0
                            for card in out.get("cards", []) or []:
                                key = _normalize_card_key(card)
                                if key and key not in seen_keys:
                                    seen_keys.add(key)
                                    all_cards.append(card)
                                    additions += 1
                            vprint(f"{_C.DIM}[Reflect] Added {additions} unique cards (total {len(all_cards)}) done={bool(out.get('done'))}{_C.RESET}", level=2)
                            rp.advance(task, 1)
                            if out.get("done") or additions == 0:
                                break
                else:
                    p = Progress(total=total_rounds, label="Reflection rounds")
                    for round_idx in range(total_rounds):
                        out = chat_reflect(chat, limit=max_batch, log_path=session_log)
                        additions = 0
                        for card in out.get("cards", []) or []:
                            key = _normalize_card_key(card)
                            if key and key not in seen_keys:
                                seen_keys.add(key)
                                all_cards.append(card)
                                additions += 1
                        vprint(f"{_C.DIM}[Reflect] Added {additions} unique cards (total {len(all_cards)}) done={bool(out.get('done'))}{_C.RESET}", level=1)
                        p.update(round_idx + 1)
                        if out.get("done") or additions == 0:
                            break
            except Exception as exc:
                print(f"{_C.YELLOW}Warning: Reflection failed: {exc}{_C.RESET}")

    cards = all_cards
    if not cards:
        print(f"{_C.YELLOW}No cards were generated.{_C.RESET}")
        return 0

    # Interactive confirmation before creating notes
    if args.interactive and not is_quiet():
        print(f"{_C.BLUE}Ready to create{_C.RESET} {len(cards)} notes in deck '{args.deck_name}'.")
        proceed = _prompt("Proceed? (y/N)", "N").lower()
        if proceed not in ("y", "yes"):
            print(f"{_C.YELLOW}Cancelled before creating notes.{_C.RESET}")
            return 0

    with StepTimer(f"Create {len(cards)} notes in Anki"):
        created = 0
        failed = 0
        if _HAS_RICH and not is_quiet():
            with RichProgress(
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                "{task.completed}/{task.total}",
                TimeElapsedColumn(),
                TimeRemainingColumn(),
            ) as rp:
                task = rp.add_task("Creating notes", total=len(cards))
                for idx, card in enumerate(cards, start=1):
                    model_name = str(card.get("model_name") or args.model_name)
                    lower_model = model_name.strip().lower()
                    if lower_model in ("basic", config.DEFAULT_BASIC_MODEL.lower()):
                        model_name = config.DEFAULT_BASIC_MODEL
                    elif lower_model in ("cloze", config.DEFAULT_CLOZE_MODEL.lower()):
                        model_name = config.DEFAULT_CLOZE_MODEL
                    fields: Dict[str, str] = {
                        str(k): str(v) for k, v in (card.get("fields") or {}).items()
                    }
                    ai_tags = [str(t) for t in (card.get("tags") or [])]
                    merged_tags = list(dict.fromkeys(ai_tags + (args.tags or [])))
                    if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG and config.DEFAULT_TAG not in merged_tags:
                        merged_tags.append(config.DEFAULT_TAG)
                    tags = merged_tags

                    for media in card.get("media", []) or []:
                        filename = str(media.get("filename") or f"lectern-{idx}.png")
                        data_b64 = str(media.get("data") or "")
                        try:
                            import base64 as _b64
                            stored_name = store_media_file(filename, _b64.b64decode(data_b64))
                            vprint(f"  {_C.BLUE}Media:{_C.RESET} uploaded {stored_name}", level=2)
                        except Exception as exc:
                            print(f"  {_C.YELLOW}Warning: Failed to upload media '{filename}': {exc}{_C.RESET}")

                    try:
                        note_id = add_note(
                            deck_name=args.deck_name, model_name=model_name, fields=fields, tags=tags
                        )
                        created += 1
                        vprint(f"  {_C.GREEN}[{created}/{len(cards)}]{_C.RESET} Created note {note_id}", level=2)
                    except Exception as exc:
                        failed += 1
                        print(f"  {_C.RED}Error creating note {idx}: {exc}{_C.RESET}")
                    finally:
                        rp.advance(task, 1)
        else:
            progress = Progress(total=len(cards), label="Notes")
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
                        vprint(f"  {_C.BLUE}Media:{_C.RESET} uploaded {stored_name}", level=2)
                    except Exception as exc:
                        print(f"  {_C.YELLOW}Warning: Failed to upload media '{filename}': {exc}{_C.RESET}")

                try:
                    note_id = add_note(
                        deck_name=args.deck_name, model_name=model_name, fields=fields, tags=tags
                    )
                    created += 1
                    vprint(f"  {_C.GREEN}[{created}/{len(cards)}]{_C.RESET} Created note {note_id}", level=1)
                except Exception as exc:
                    failed += 1
                    print(f"  {_C.RED}Error creating note {idx}: {exc}{_C.RESET}")
                finally:
                    progress.update(created + failed)
    total_elapsed = time.perf_counter() - _run_start
    if not is_quiet():
        print(f"{_C.MAGENTA}{_C.BOLD}Done.{_C.RESET}")
        print(
            f"{_C.BLUE}Summary:{_C.RESET} pages={len(pages)} generated={len(cards)} created={created} failed={failed} elapsed={total_elapsed:.2f}s"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))



