use serde_json::Value;
// The native boundary also constrains persisted history; the UI owns ordering.
pub fn normalize(value: Value) -> Result<Value, String> {
    let entries = value.as_array().ok_or("Recent history must be a list")?;
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for entry in entries {
        let path = entry["path"]
            .as_str()
            .ok_or("Invalid recent document path")?;
        if !entry["title"].is_string() || !entry["lastOpened"].is_string() {
            return Err("Invalid recent document metadata".into());
        }
        if seen.insert(path.to_owned()) {
            result.push(entry.clone());
        }
        if result.len() == 12 {
            break;
        }
    }
    Ok(Value::Array(result))
}
#[cfg(test)]
mod tests {
    #[test]
    fn deduplicates_history() {
        let entry = serde_json::json!({"path":"/test","title":"Test","lastOpened":"2026-01-01"});
        assert_eq!(
            super::normalize(serde_json::json!([entry, entry]))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn rejects_invalid_entries() {
        assert!(super::normalize(serde_json::json!([{}])).is_err());
    }
}
#[tauri::command]
pub async fn check_recent_paths(paths: Vec<String>) -> Result<Vec<bool>, String> {
    if paths.len() > 12 {
        return Err("Too many recent paths.".into());
    }
    crate::filesystem::blocking(move || {
        Ok(paths
            .iter()
            .map(|p| std::path::Path::new(p).is_file())
            .collect())
    })
    .await
}
