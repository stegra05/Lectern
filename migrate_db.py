import json
import os
from lectern.utils.path_utils import get_app_data_dir
from lectern.utils.database import DatabaseManager

def migrate():
    print("Starting migration...")
    app_data = get_app_data_dir()
    history_file = app_data / "history.json"
    state_dir = app_data / "state"
    
    db = DatabaseManager()
    
    if not history_file.exists():
        print("No history.json found to migrate.")
        return
        
    with open(history_file, 'r', encoding='utf-8') as f:
        try:
            history_data = json.load(f)
        except:
            history_data = []
            
    conn = db.get_connection()
    count = 0
    
    for entry in history_data:
        entry_id = entry.get("id")
        session_id = entry.get("session_id")
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
        
        state_file = state_dir / f"session-{session_id}.json"
        if state_file.exists():
            try:
                with open(state_file, 'r', encoding='utf-8') as sf:
                    state_data = json.load(sf)
                    cards = state_data.get("cards", [])
                    tags = state_data.get("tags", [])
                    model_name = state_data.get("model_name", "")
                    slide_set_name = state_data.get("slide_set_name", "")
            except:
                pass
                
        # Insert into DB
        row = conn.execute("SELECT id FROM history WHERE id = ?", (entry_id,)).fetchone()
        if not row:
            conn.execute('''
                INSERT INTO history (id, session_id, filename, full_path, deck, date, last_modified, status, card_count, cards, tags, model_name, slide_set_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                entry_id, session_id, filename, full_path, deck, date, last_modified, status, card_count,
                json.dumps(cards), json.dumps(tags), model_name, slide_set_name
            ))
            count += 1
            
    conn.commit()
    conn.close()
    print(f"Migrated {count} entries into SQLite DB.")

if __name__ == "__main__":
    migrate()
