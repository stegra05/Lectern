"""
Lectern CLI entry point.

This orchestrates the workflow using the shared LecternGenerationService.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import logging
import getpass
from typing import List, Dict

import config
from anki_connector import check_connection
from utils.cli import StepTimer, set_verbosity, is_quiet, Progress, info, warn, error, success, setup_logging, debug
from utils.state import load_state
from utils.notify import beep, send_notification
from utils.keychain_manager import set_gemini_key

# Import shared service
from lectern_service import LecternGenerationService, ServiceEvent

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
    parser.add_argument("--set-key", action="store_true", help="Securely save Gemini API key to system keychain and exit")

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


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    # Set verbosity early
    set_verbosity(0 if args.quiet else (2 if args.verbose else 1))
    setup_logging(logging.DEBUG if args.verbose else logging.INFO)

    # Handle key setup
    if args.set_key:
        print("Securely storing Gemini API Key in system keychain.")
        key = getpass.getpass("Enter Gemini API Key: ").strip()
        if key:
            try:
                set_gemini_key(key)
                success("API Key saved to keychain.")
                print("You can now remove GEMINI_API_KEY from your .env file.")
            except Exception as e:
                error(f"Failed to save key: {e}")
                return 1
        else:
            warn("No key entered. Aborted.")
        return 0

    # Interactive mode: prompt for missing required inputs
    if args.interactive:
        if not args.pdf_path:
            args.pdf_path = _prompt("Path to the lecture PDF")
        if not args.deck_name:
            args.deck_name = _prompt("Destination Anki deck name")
        args.model_name = _prompt("Default Anki model", args.model_name)
        if not args.context_deck:
            args.context_deck = args.deck_name
        tags_str = _prompt("Tags (space-separated)", " ".join(args.tags or []))
        args.tags = [t for t in tags_str.split() if t]

    # Validate required inputs
    if not args.pdf_path or not args.deck_name:
        error("--pdf-path and --deck-name are required (or use --interactive).")
        return 2

    # Debug summary
    key_set = bool(config.GEMINI_API_KEY)
    masked_key = "<set>" if key_set else "<missing>"
    if not is_quiet():
        info("Lectern starting...")
        info(f"PDF: {args.pdf_path}")
        info(f"Deck: {args.deck_name}  Model: {args.model_name}")
        info(f"GEMINI_API_KEY: {masked_key}")

    # Resume logic
    should_resume = False
    resume_state = load_state()
    if resume_state:
        saved_pdf = resume_state.get("pdf_path", "")
        if args.interactive:
            if args.pdf_path and os.path.abspath(args.pdf_path) == saved_pdf:
                 should_resume = _prompt(f"Found unfinished session for {os.path.basename(saved_pdf)}. Resume? (Y/n)", "Y").lower() in ("y", "yes")
        else:
             # In CLI non-interactive, strict auto-resume might be confusing, but per request "State/Resume should be supported"
             # Let's default to False unless interactive, OR check if user provided a specific flag (which we don't have).
             # But we can check if the paths match.
             if args.pdf_path and os.path.abspath(args.pdf_path) == saved_pdf:
                 info(f"Found unfinished session for {saved_pdf}. Use --interactive to resume.")
    
    if should_resume:
        # If we resume, we trust the state's PDF matches args.pdf_path (checked above)
        pass

    # Initialize Service
    service = LecternGenerationService()
    generator = service.run(
        pdf_path=args.pdf_path,
        deck_name=args.deck_name,
        model_name=args.model_name,
        tags=args.tags,
        context_deck=args.context_deck,
        resume=should_resume,
        max_notes_per_batch=args.max_notes_per_batch,
        enable_reflection=args.enable_reflection,
        reflection_rounds=args.reflection_rounds
    )

    # Output Loop
    # We need to manage Rich Progress bars and StepTimers based on events
    current_timer = None
    current_progress = None
    
    try:
        for event in generator:
            if event.type == "step_start":
                # Close previous timer if exists (shouldn't usually happen if nested properly, but flattened here)
                if current_timer:
                    current_timer.__exit__(None, None, None)
                    current_timer = None
                current_timer = StepTimer(event.message)
                current_timer.__enter__()
            
            elif event.type == "step_end":
                if current_timer:
                    # If success is False, we might want to fail the timer
                    if not event.data.get("success", True):
                         # We don't have direct access to .fail() on the instance easily unless we kept the instance
                         # Actually StepTimer context manager handles printing on exit. 
                         # .fail() sets a flag.
                         current_timer.fail(event.message)
                    current_timer.__exit__(None, None, None)
                    current_timer = None
                else:
                    # Just print if no timer active
                    if event.data.get("success", True):
                        success(event.message)
                    else:
                        warn(event.message)

            elif event.type == "info":
                info(event.message)
            
            elif event.type == "status":
                debug(event.message)

            elif event.type == "warning":
                warn(event.message)
            
            elif event.type == "error":
                error(event.message)

            elif event.type == "progress_start":
                # event.data['total'], event.data['label']
                current_progress = Progress(total=event.data.get("total"), label=event.data.get("label", "Progress"))
            
            elif event.type == "progress_update":
                if current_progress:
                    current_progress.update(event.data.get("current", 0))
            
            elif event.type == "card":
                # Card generated
                # Maybe debug output?
                debug(f"Generated card: {event.message}", level=2)
            
            elif event.type == "note":
                # Note created
                pass
            
            elif event.type == "done":
                if current_timer: 
                    current_timer.__exit__(None, None, None)
                summary = f"Created {event.data.get('created')} notes from {event.data.get('total')} cards. Failed: {event.data.get('failed')}"
                success("Done.")
                info(summary)
                beep()
                send_notification("Lectern Job Complete", summary)

    except KeyboardInterrupt:
        warn("Interrupted by user.")
        return 130
    except Exception as e:
        error(f"Unexpected error: {e}")
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))