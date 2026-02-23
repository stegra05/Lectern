#!/usr/bin/env python3
"""Migration script to move data from JSON files to SQLite.

This script is run once to migrate existing data from the legacy
JSON-based storage to the new SQLite database.

Usage:
    python migrate_db.py [--cleanup]

Options:
    --cleanup    Remove old JSON files after successful migration
"""

import argparse
import json
import logging
import shutil
from datetime import datetime
from pathlib import Path

from lectern.utils.path_utils import get_app_data_dir
from lectern.utils.database import DatabaseManager

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def migrate(*, cleanup: bool = False) -> int:
    """Migrate data from JSON files to SQLite.

    Args:
        cleanup: If True, remove old JSON files after successful migration

    Returns:
        Number of entries migrated
    """
    logger.info("Starting migration to SQLite...")
    app_data = get_app_data_dir()
    history_file = app_data / "history.json"
    state_dir = app_data / "state"

    db = DatabaseManager()

    if not history_file.exists():
        logger.info("No history.json found - nothing to migrate.")
        return 0

    # Load history data
    history_data = []
    try:
        with open(history_file, "r", encoding="utf-8") as f:
            history_data = json.load(f)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse history.json: {e}")
        return 0
    except Exception as e:
        logger.warning(f"Failed to read history.json: {e}")
        return 0

    if not history_data:
        logger.info("history.json is empty - nothing to migrate.")
        return 0

    # Migrate entries
    migrated_count = 0
    state_files_migrated: list[Path] = []

    with db.get_connection() as conn:
        for entry in history_data:
            entry_id = entry.get("id")
            session_id = entry.get("session_id")

            if not entry_id:
                logger.warning(f"Skipping entry without id: {entry}")
                continue

            # Extract history fields
            filename = entry.get("filename", "")
            full_path = entry.get("full_path", "")
            deck = entry.get("deck", "")
            date = entry.get("date", "")
            last_modified = entry.get("last_modified", date)
            status = entry.get("status", "draft")
            card_count = entry.get("card_count", 0)

            # Load associated state if exists
            cards = []
            tags = []
            model_name = ""
            slide_set_name = ""

            if session_id:
                state_file = state_dir / f"session-{session_id}.json"
                if state_file.exists():
                    try:
                        with open(state_file, "r", encoding="utf-8") as sf:
                            state_data = json.load(sf)
                            cards = state_data.get("cards", [])
                            tags = state_data.get("tags", [])
                            model_name = state_data.get("model_name", "")
                            slide_set_name = state_data.get("slide_set_name", "")
                            state_files_migrated.append(state_file)
                    except Exception as e:
                        logger.warning(f"Failed to load state file {state_file}: {e}")

            # Check if entry already exists
            row = conn.execute(
                "SELECT id FROM history WHERE id = ?", (entry_id,)
            ).fetchone()

            if not row:
                conn.execute(
                    """
                    INSERT INTO history (
                        id, session_id, filename, full_path, deck, date,
                        last_modified, status, card_count, cards, tags,
                        model_name, slide_set_name
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        entry_id,
                        session_id,
                        filename,
                        full_path,
                        deck,
                        date,
                        last_modified,
                        status,
                        card_count,
                        json.dumps(cards),
                        json.dumps(tags),
                        model_name,
                        slide_set_name,
                    ),
                )
                migrated_count += 1

        conn.commit()

    # Optimize database after bulk insert
    logger.info("Optimizing database...")
    db.vacuum()

    logger.info(f"Successfully migrated {migrated_count} entries to SQLite.")

    # Cleanup old files if requested
    if cleanup and migrated_count > 0:
        logger.info("Cleaning up old JSON files...")

        # Backup before deletion
        backup_dir = app_data / "json_backup" / datetime.now().strftime("%Y%m%d_%H%M%S")

        if history_file.exists():
            backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(history_file, backup_dir / "history.json")
            history_file.unlink()
            logger.info(f"Removed history.json (backup in {backup_dir})")

        for state_file in state_files_migrated:
            if state_file.exists():
                shutil.copy2(state_file, backup_dir / state_file.name)
                state_file.unlink()

        if state_files_migrated:
            logger.info(f"Removed {len(state_files_migrated)} state files")

        # Remove empty state directory
        if state_dir.exists() and not any(state_dir.iterdir()):
            state_dir.rmdir()
            logger.info("Removed empty state directory")

    return migrated_count


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate data from JSON files to SQLite"
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Remove old JSON files after successful migration",
    )
    args = parser.parse_args()

    count = migrate(cleanup=args.cleanup)
    if count > 0:
        logger.info(f"\nMigration complete! {count} entries migrated.")
    else:
        logger.info("\nNo migration needed.")


if __name__ == "__main__":
    main()
