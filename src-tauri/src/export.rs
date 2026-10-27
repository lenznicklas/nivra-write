#[tauri::command]
pub async fn export_file(path: String, content: String) -> Result<(), String> {
    crate::filesystem::blocking(move || {
        crate::filesystem::atomic_write(std::path::Path::new(&path), content.as_bytes())
    })
    .await
}
#[tauri::command]
pub async fn export_html(
    path: String,
    mut content: String,
    session_id: Option<String>,
    registry: tauri::State<'_, crate::assets::AssetRegistry>,
) -> Result<(), String> {
    use base64::Engine;
    let registry = registry.inner().clone();
    crate::filesystem::blocking(move || {
        if let Some(token) = session_id {
            let session = registry.get(&token)?;
            for (id, entry) in session.manifest()? {
                let pattern = format!("src=\"asset://{id}\"");
                if content.contains(&pattern) {
                    let (bytes, _) = registry.resolve(&token, &id)?;
                    let data = format!(
                        "src=\"data:{};base64,{}\"",
                        entry.mime_type,
                        base64::engine::general_purpose::STANDARD.encode(bytes)
                    );
                    content = content.replace(&pattern, &data);
                }
            }
        }
        if content.contains("src=\"asset://") {
            return Err("HTML export failed because an image asset is unavailable.".into());
        }
        crate::filesystem::atomic_write(std::path::Path::new(&path), content.as_bytes())
    })
    .await
}
