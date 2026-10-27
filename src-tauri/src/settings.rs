use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;
pub fn data_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(name))
}
#[tauri::command]
pub async fn read_state(app: tauri::AppHandle, key: String) -> Result<Option<Value>, String> {
    crate::filesystem::blocking(move || {
        let path = data_path(&app, allowed(&key)?)?;
        if !path.exists() {
            return Ok(None);
        }
        match serde_json::from_slice(&crate::filesystem::read_limited(&path)?) {
            Ok(value) => Ok(Some(value)),
            Err(error) if key == "settings" || key == "recents" => {
                eprintln!("Corrupt {key} reset safely: {error}");
                let quarantine = path.with_extension("corrupt.json");
                std::fs::copy(&path, quarantine).map_err(|e| e.to_string())?;
                Ok(None)
            }
            Err(error) => Err(error.to_string()),
        }
    })
    .await
}
#[tauri::command]
pub async fn write_state(app: tauri::AppHandle, key: String, value: Value) -> Result<(), String> {
    crate::filesystem::blocking(move || {
        let value = if key == "recents" {
            crate::recent::normalize(value)?
        } else {
            value
        };
        crate::filesystem::atomic_write(
            &data_path(&app, allowed(&key)?)?,
            &serde_json::to_vec(&value).map_err(|e| e.to_string())?,
        )
    })
    .await
}
fn allowed(key: &str) -> Result<&str, String> {
    match key {
        "settings" => Ok("settings.json"),
        "recents" => Ok("recents.json"),
        _ => Err("Unknown state key".into()),
    }
}
