use crate::{assets::AssetRegistry, package};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    pub document: Value,
    pub session_id: String,
    pub size: u64,
    pub migrated: bool,
}
#[derive(Serialize)]
pub struct SaveReceipt {
    pub size: u64,
}
#[tauri::command]
pub async fn read_document(
    path: String,
    registry: tauri::State<'_, AssetRegistry>,
) -> Result<LoadedDocument, String> {
    let registry = registry.inner().clone();
    crate::filesystem::blocking(move || {
        let (token, session) = registry.create()?;
        match package::read(Path::new(&path), &session) {
            Ok(package) => Ok(LoadedDocument {
                document: package.document,
                session_id: token,
                size: std::fs::metadata(&path).map_err(|e| e.to_string())?.len(),
                migrated: package.migrated,
            }),
            Err(error) => {
                registry.close(&token)?;
                Err(error)
            }
        }
    })
    .await
}
#[tauri::command]
pub async fn write_document(
    path: String,
    document: Value,
    session_id: Option<String>,
    registry: tauri::State<'_, AssetRegistry>,
) -> Result<SaveReceipt, String> {
    let registry = registry.inner().clone();
    crate::filesystem::blocking(move || {
        let session = session_id
            .as_deref()
            .map(|id| registry.get(id))
            .transpose()?;
        package::save(Path::new(&path), document, session.as_deref(), None)
            .map(|size| SaveReceipt { size })
    })
    .await
}
