use crate::{
    assets::AssetRegistry, documents::LoadedDocument, format, package, settings::data_path,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
fn safe_id(id: &str) -> Result<&str, String> {
    if format::valid_id(id) {
        Ok(id)
    } else {
        Err("Invalid recovery identity.".into())
    }
}
#[derive(Serialize)]
pub struct RecoveryCatalog {
    pub snapshots: Vec<Value>,
    pub issues: Vec<String>,
}
pub fn metadata(snapshot: &Value, document: &Value, id: &str) -> Result<Value, String> {
    safe_id(id)?;
    let revision = snapshot["editRevision"]
        .as_u64()
        .ok_or("Invalid recovery revision.")?;
    let timestamp = snapshot["savedAt"]
        .as_str()
        .filter(|s| s.len() <= 64)
        .ok_or("Invalid recovery timestamp.")?;
    let path = match snapshot.get("path") {
        Some(Value::Null) | None => Value::Null,
        Some(Value::String(path)) if Path::new(path).is_absolute() => json!(path),
        _ => return Err("Invalid recovery original path.".into()),
    };
    Ok(
        json!({"recoveryId":id,"documentId":document["metadata"]["id"],"title":document["metadata"]["title"],"path":path,"savedAt":timestamp,"editRevision":revision}),
    )
}
fn candidate(document: Value, metadata: Value) -> Result<Value, String> {
    let id = metadata["recoveryId"]
        .as_str()
        .ok_or("Invalid recovery identity.")?;
    let mut metadata = self::metadata(&metadata, &document, id)?;
    metadata["originalExists"] = json!(metadata["path"]
        .as_str()
        .is_some_and(|p| Path::new(p).is_file()));
    Ok(metadata)
}
#[tauri::command]
pub async fn save_recovery(
    app: tauri::AppHandle,
    id: String,
    snapshot: Value,
    session_id: Option<String>,
    registry: tauri::State<'_, AssetRegistry>,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    crate::filesystem::blocking(move || {
        let document = snapshot["document"].clone();
        format::validate(&document)?;
        let metadata = metadata(&snapshot, &document, &id)?;
        let session = session_id
            .as_deref()
            .map(|id| registry.get(id))
            .transpose()?;
        let root = data_path(&app, "recovery")?;
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        package::save(
            &root.join(format!("{}.nwr", safe_id(&id)?)),
            document,
            session.as_deref(),
            Some(metadata),
        )
        .map(|_| ())
    })
    .await
}
#[tauri::command]
pub async fn list_recovery(app: tauri::AppHandle) -> Result<RecoveryCatalog, String> {
    crate::filesystem::blocking(move||{
 let root=data_path(&app,"recovery")?;let mut catalog=RecoveryCatalog{snapshots:vec![],issues:vec![]};if !root.exists(){return Ok(catalog);}
 for entry in std::fs::read_dir(root).map_err(|e|e.to_string())? {
   let path=entry.map_err(|e|e.to_string())?.path();let id=path.file_stem().and_then(|s|s.to_str()).unwrap_or_default();
   if !matches!(path.extension().and_then(|s|s.to_str()),Some("json"|"nwr")){continue;}
   let result=(||{
     safe_id(id)?;
     if path.extension().is_some_and(|s|s=="json"){
       let old:Value=serde_json::from_slice(&crate::filesystem::read_limited(&path)?).map_err(|_|"Invalid legacy recovery JSON.")?;
       format::version(&old["document"])?;
       if old["document"]["metadata"]["id"]!=id{return Err("Legacy recovery identity mismatch.".into());}
       // Legacy snapshots are migrated lazily on restore, including their inline assets.
       return Ok(json!({"recoveryId":id,"documentId":id,"title":old["document"]["metadata"]["title"],"path":old["path"],"savedAt":old["savedAt"],"editRevision":0,"originalExists":old["path"].as_str().is_some_and(|p|Path::new(p).is_file()),"legacy":true}));
     }
     let (document,metadata)=package::inspect(&path)?;
     if metadata["recovery"]["recoveryId"]!=id{return Err("Recovery identity mismatch.".into());}
     candidate(document,metadata["recovery"].clone())
   })();
   match result{Ok(value)=>catalog.snapshots.push(value),Err(error)=>catalog.issues.push(format!("Recovery ‘{}’ could not be read: {error}",path.file_name().unwrap_or_default().to_string_lossy()))}
 }
 catalog.snapshots.sort_by(|a,b|b["savedAt"].as_str().cmp(&a["savedAt"].as_str()));Ok(catalog)
 }).await
}
#[tauri::command]
pub async fn restore_recovery(
    app: tauri::AppHandle,
    id: String,
    registry: tauri::State<'_, AssetRegistry>,
) -> Result<LoadedDocument, String> {
    let registry = registry.inner().clone();
    crate::filesystem::blocking(move || {
        let root = data_path(&app, "recovery")?;
        let path = root.join(format!("{}.nwr", safe_id(&id)?));
        let (token, session) = registry.create()?;
        let result = (|| {
            let package = if path.exists() {
                let package = package::read(&path, &session)?;
                if package.metadata["recovery"]["recoveryId"] != id {
                    return Err("Recovery identity mismatch.".into());
                }
                package
            } else {
                let old: Value = serde_json::from_slice(&crate::filesystem::read_limited(
                    &root.join(format!("{id}.json")),
                )?)
                .map_err(|_| "Invalid legacy recovery.")?;
                let (document, migrated) =
                    crate::migrations::migrate(old["document"].clone(), &session)?;
                package::Package {
                    document,
                    assets: Default::default(),
                    metadata: json!({}),
                    migrated,
                }
            };
            Ok(LoadedDocument {
                document: package.document,
                session_id: token.clone(),
                size: 0,
                migrated: package.migrated,
            })
        })();
        if result.is_err() {
            registry.close(&token)?;
        }
        result
    })
    .await
}
#[tauri::command]
pub async fn delete_recovery(app: tauri::AppHandle, id: String) -> Result<(), String> {
    crate::filesystem::blocking(move || {
        for ext in ["nwr", "json"] {
            let path = data_path(&app, "recovery")?.join(format!("{}.{ext}", safe_id(&id)?));
            if path.exists() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })
    .await
}
