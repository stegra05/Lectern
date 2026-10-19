use keyring::Entry;

// One keychain entry per provider. Gemini's keeps the original Python app's
// service/account, so an existing key carries over.
const KEYCHAIN_SERVICE: &str = "Lectern";

fn keychain_entry(provider: &str) -> Result<Entry, String> {
    let account = match provider {
        "gemini" => "gemini_api_key",
        "openai" => "openai_api_key",
        "anthropic" => "anthropic_api_key",
        other => return Err(format!("unknown provider: {other}")),
    };
    Entry::new(KEYCHAIN_SERVICE, account).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(provider: String) -> Result<Option<String>, String> {
    match keychain_entry(&provider)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keychain_set(provider: String, value: String) -> Result<(), String> {
    keychain_entry(&provider)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_delete(provider: String) -> Result<(), String> {
    match keychain_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            keychain_get,
            keychain_set,
            keychain_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
