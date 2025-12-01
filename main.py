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
import logging
from typing import List, Dict

import config
from anki_connector import add_note, check_connection, store_media_file, sample_examples_from_deck
from pdf_parser import extract_content_from_pdf
from ai_client import LecternAIClient
from utils.cli import StepTimer, set_verbosity, is_quiet, Progress, info, warn, error, success, setup_logging, debug
from utils.tags import build_grouped_tags
from utils.state import load_state, save_state, clear_state
from utils.notify import beep, send_notification


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
    beep()
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
    setup_logging(logging.DEBUG if args.verbose else logging.INFO)

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
        error("--pdf-path and --deck-name are required (or use --interactive).")
        return 2

    # Debug summary of inputs and configuration (mask secrets)
    key_set = bool(config.GEMINI_API_KEY)
    masked_key = "<set>" if key_set else "<missing>"
    if not is_quiet():
        info("Lectern starting...")
        info(f"PDF: {args.pdf_path}")
        info(f"Deck: {args.deck_name}  Model: {args.model_name}")
        info(f"Tags: {', '.join(args.tags)}")
        if getattr(args, "context_deck", ""):
            info(f"Context deck: {args.context_deck}")
        info(f"AnkiConnect: {config.ANKI_CONNECT_URL}")
        info(f"GEMINI_API_KEY: {masked_key}")
        debug(f"(Config) batch={config.MAX_NOTES_PER_BATCH} reflection_rounds={config.REFLECTION_MAX_ROUNDS} reflection_enabled={config.ENABLE_REFLECTION}")

    # Check for resume state
    resume_state = load_state()
    resuming = False
    if resume_state:
        saved_pdf = resume_state.get("pdf_path", "")
        # If interactive or if the PDF matches (or user didn't specify one yet)
        if args.interactive or (args.pdf_path and os.path.abspath(args.pdf_path) == saved_pdf):
            if args.interactive:
                should_resume = _prompt(f"Found unfinished session for {os.path.basename(saved_pdf)}. Resume? (Y/n)", "Y").lower() in ("y", "yes")
            else:
                # Non-interactive: if paths match, maybe auto-resume or warn?
                # Let's auto-resume if paths match exactly, or just log it.
                # For safety, let's only resume if explicitly interactive or if we decide a policy.
                # The user request implies a prompt: "Resume from page 50? [Y/n]"
                # So we should probably only do this in interactive mode or if a flag is set.
                # But let's assume interactive for the prompt as per request.
                should_resume = False
                if args.pdf_path and os.path.abspath(args.pdf_path) == saved_pdf:
                    info(f"Found unfinished session for {saved_pdf}. Use --interactive to resume.")

            if should_resume:
                resuming = True
                args.pdf_path = saved_pdf
                args.deck_name = resume_state.get("deck_name", args.deck_name)
                info(f"Resuming session for {saved_pdf}...")

    # Start total timer
    _run_start = time.perf_counter()

    # Check AnkiConnect availability early
    with StepTimer("Check AnkiConnect") as t:
        if not check_connection():
            error(f"Could not connect to AnkiConnect at {config.ANKI_CONNECT_URL}")
            warn("Ensure Anki is open and the AnkiConnect add-on is installed and enabled.")
            t.fail("AnkiConnect unreachable")
            return 2

    # Validate required config for Gemini
    with StepTimer("Validate configuration") as t:
        try:
            config.assert_required_config()
        except ValueError as exc:
            error(str(exc))
            t.fail("Missing configuration")
            return 2

    # Validate PDF path early
    with StepTimer("Validate inputs") as t:
        if not _validate_pdf_path(args.pdf_path):
            error(f"PDF not found or not readable: {args.pdf_path}")
            warn("Tip: Check the path and permissions; use an absolute path if unsure.")
            t.fail("Invalid PDF path")
            return 2

    examples = ""
    with StepTimer("Sample examples via AnkiConnect") as t:
        try:
            deck_for_examples = (args.context_deck or args.deck_name)
            examples = sample_examples_from_deck(deck_name=deck_for_examples, sample_size=5)
            if examples.strip():
                debug("(Loaded style examples via AnkiConnect)")
            else:
                t.fail("No examples found via AnkiConnect")
        except Exception as exc:
            warn(f"Failed to sample examples via AnkiConnect: {exc}")
            # proceed without examples

    with StepTimer("Parse PDF"):
        pages = extract_content_from_pdf(args.pdf_path)
        debug(f"Parsed {len(pages)} pages", level=1)

    # Start a single chat session
    with StepTimer("Start AI session"):
        ai = LecternAIClient()
        session_log = ai.log_path
        if resuming and resume_state:
            history = resume_state.get("history", [])
            if history:
                ai.restore_history(history)

    # Helpers for dedupe
    def _normalize_card_key(card: Dict[str, str]) -> str:
        fields = card.get("fields") or {}
        value = str(fields.get("Text") or fields.get("Front") or "")
        return " ".join(value.lower().split())

    

    # Phase 0: Concept map in chat
    concept_map: Dict = {}
    if resuming and resume_state and resume_state.get("concept_map"):
        concept_map = resume_state["concept_map"]
        debug("[ConceptMap] Restored from state")
    else:
        with StepTimer("Build global concept map") as t:
            try:
                concept_map = ai.concept_map([p.__dict__ for p in pages])
                obj = concept_map.get("objectives") if isinstance(concept_map, dict) else None
                concept_count = len(concept_map.get("concepts", [])) if isinstance(concept_map, dict) else 0
                debug(f"[ConceptMap] objectives={len(obj) if isinstance(obj, list) else 0} concepts={concept_count}")
            except Exception as exc:
                warn(f"Concept map failed ({exc}); proceeding without it.")
                concept_map = {}

    # Phase 1: Generation turns in chat
    all_cards: List[Dict] = []
    seen_keys = set()
    
    if resuming and resume_state:
        all_cards = resume_state.get("cards", [])
        for card in all_cards:
            key = _normalize_card_key(card)
            if key:
                seen_keys.add(key)
        debug(f"[Resume] Loaded {len(all_cards)} cards from state")

    # Track creation results early so we can surface counts during earlier phases
    created = 0
    failed = 0
    
    # Dynamic parameter calculation based on page count
    page_count = len(pages)
    
    # Dynamically determine batch size: scale with page count but keep reasonable bounds
    dynamic_batch_size = min(50, max(20, page_count // 2))
    max_batch = int(getattr(args, "max_notes_per_batch", dynamic_batch_size))
    
    with StepTimer("Generate cards") as t:
        # Compute total cap based on slides and optional hard cap
        total_cards_cap = int(page_count * getattr(config, "CARDS_PER_SLIDE_TARGET", 1.0))
        hard_cap = int(getattr(config, "MAX_TOTAL_NOTES", 0))
        if hard_cap > 0:
            total_cards_cap = min(total_cards_cap, hard_cap)
        
        # Calculate minimum required cards (enforced threshold)
        min_cards_required = int(page_count * getattr(config, "MIN_CARDS_PER_SLIDE", 0.8))
        
        debug(f"[Gen] Targets: min={min_cards_required} target={total_cards_cap} batch_size={max_batch} pages={page_count}")
        
        # Examples and concept map are already incorporated via dedicated stages
        # Iteratively request more cards until the model indicates done or no additions
        # Make turns cap proportional to desired total cards
        total_turns_cap = max(1, (total_cards_cap + max_batch - 1) // max_batch + 2)
        p = Progress(total=total_turns_cap, label="Generation turns")
        for turn_idx in range(total_turns_cap):  # hard cap to avoid accidental loops
            remaining = max(0, total_cards_cap - len(all_cards))
            if remaining == 0:
                break
            out = ai.generate_more_cards(limit=min(max_batch, remaining))
            additions = 0
            for card in out.get("cards", []) or []:
                key = _normalize_card_key(card)
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    all_cards.append(card)
                    additions += 1
            debug(f"[Gen] Added {additions} unique cards (total {len(all_cards)}) done={bool(out.get('done'))}")
            p.update(turn_idx + 1)
            
            # Save state
            save_state(
                pdf_path=os.path.abspath(args.pdf_path),
                deck_name=args.deck_name,
                cards=all_cards,
                concept_map=concept_map,
                history=ai.get_history(),
                log_path=ai.log_path
            )

            # Surface real-time counts in basic mode
            debug(f"[Gen] Status gen={len(all_cards)} created={created}")
            
            # Only respect "done" signal after meeting minimum requirement
            should_stop = (
                len(all_cards) >= total_cards_cap or 
                additions == 0 or
                (out.get("done") and len(all_cards) >= min_cards_required)
            )
            if should_stop:
                break

    # Phase 2: Reflection
    if getattr(args, "enable_reflection", config.ENABLE_REFLECTION) and len(all_cards) > 0 and len(all_cards) < total_cards_cap:
        with StepTimer("Reflection and improvement") as t:
            try:
                # Dynamically determine reflection rounds based on slide count
                # Small decks (< 20): 1-2 rounds, Medium (20-50): 2-3 rounds, Large (50+): 3-5 rounds
                if page_count < 20:
                    dynamic_reflection_rounds = 2
                elif page_count < 50:
                    dynamic_reflection_rounds = 3
                elif page_count < 100:
                    dynamic_reflection_rounds = 4
                else:
                    dynamic_reflection_rounds = 5
                
                rounds = int(getattr(args, "reflection_rounds", dynamic_reflection_rounds))
                total_rounds = max(0, rounds)
                debug(f"[Reflect] Dynamic rounds: {total_rounds} (for {page_count} pages)")
                p = Progress(total=total_rounds, label="Reflection rounds")
                for round_idx in range(total_rounds):
                    remaining = max(0, total_cards_cap - len(all_cards))
                    if remaining == 0:
                        break
                    out = ai.reflect(limit=min(max_batch, remaining))
                    additions = 0
                    for card in out.get("cards", []) or []:
                        key = _normalize_card_key(card)
                        if key and key not in seen_keys:
                            seen_keys.add(key)
                            all_cards.append(card)
                            additions += 1
                    debug(f"[Reflect] Added {additions} unique cards (total {len(all_cards)}) done={bool(out.get('done'))}")
                    p.update(round_idx + 1)
                    
                    # Save state
                    save_state(
                        pdf_path=os.path.abspath(args.pdf_path),
                        deck_name=args.deck_name,
                        cards=all_cards,
                        concept_map=concept_map,
                        history=ai.get_history(),
                        log_path=ai.log_path
                    )

                    # Surface real-time counts in basic mode
                    debug(f"[Reflect] Status gen={len(all_cards)} created={created}")
                    
                    # Only respect "done" signal after meeting minimum requirement
                    should_stop = (
                        len(all_cards) >= total_cards_cap or 
                        additions == 0 or
                        (out.get("done") and len(all_cards) >= min_cards_required)
                    )
                    if should_stop:
                        break
            except Exception as exc:
                warn(f"Reflection failed: {exc}")

    cards = all_cards
    if not cards:
        warn("No cards were generated.")
        return 0

    # Interactive confirmation before creating notes
    if args.interactive and not is_quiet():
        info(f"Ready to create {len(cards)} notes in deck '{args.deck_name}'.")
        proceed = _prompt("Proceed? (y/N)", "N").lower()
        if proceed not in ("y", "yes"):
            warn("Cancelled before creating notes.")
            return 0

    with StepTimer(f"Create {len(cards)} notes in Anki"):
        created = 0
        failed = 0
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
            
            # Construct deck path for tags: Deck::Slideset (if available)
            slide_topic = str(card.get("slide_topic") or "").strip()
            # If we have a slide topic, append it to the deck name for the tag path
            # User requested: Deck::Slideset::Topic -> but actually just Deck::Slideset as the hierarchy root
            # "It should be Deck::Slideset::Topic, where Slideset is the new tag to be added."
            # "No, just insert the Slideset tag, so it is easy to attribute topics / concepts to the slide set when studying."
            # Interpretation: The tag hierarchy should be DeckName::SlideTopic::ExistingTag
            
            tag_deck_path = args.deck_name
            if slide_topic:
                tag_deck_path = f"{args.deck_name}::{slide_topic}"

            tags = (
                build_grouped_tags(tag_deck_path, merged_tags)
                if getattr(config, "GROUP_TAGS_BY_DECK", False)
                else merged_tags
            )

            # Upload any media provided by the AI before adding the note
            for media in card.get("media", []) or []:
                filename = str(media.get("filename") or f"lectern-{idx}.png")
                data_b64 = str(media.get("data") or "")
                try:
                    import base64 as _b64

                    stored_name = store_media_file(filename, _b64.b64decode(data_b64))
                    debug(f"  Media: uploaded {stored_name}", level=2)
                except Exception as exc:
                    warn(f"  Failed to upload media '{filename}': {exc}")

            try:
                note_id = add_note(
                    deck_name=args.deck_name, model_name=model_name, fields=fields, tags=tags
                )
                created += 1
                success(f"  [{created}/{len(cards)}] Created note {note_id}")
            except Exception as exc:
                failed += 1
                error(f"  Error creating note {idx}: {exc}")
            finally:
                progress.update(created + failed)
                # Surface real-time counts in basic mode
                debug(f"[Create] Status gen={len(cards)} created={created} failed={failed}")
    total_elapsed = time.perf_counter() - _run_start
    if not is_quiet():
        success("Done.")
        summary = f"Summary: pages={len(pages)} generated={len(cards)} created={created} failed={failed} elapsed={total_elapsed:.2f}s"
        info(summary)
        beep()
        send_notification("Lectern Job Complete", f"Created {created} notes from {len(pages)} pages.")
    
    # Clear state on success
    clear_state()
    
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))



