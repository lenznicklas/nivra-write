//! Session-scoped, hash-addressed native assets. Never extract archive filenames.
use crate::format::{self, AssetEntry, Manifest};
use fs2::FileExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
#[derive(Clone)]
pub struct Asset {
    pub entry: AssetEntry,
    pub file: PathBuf,
}
pub struct AssetSession {
    pub assets: Mutex<HashMap<String, Asset>>,
    _directory: tempfile::TempDir,
}
#[derive(Clone)]
pub struct AssetRegistry {
    root: Arc<SessionRoot>,
    sessions: Arc<Mutex<HashMap<String, Arc<AssetSession>>>>,
}
struct SessionRoot {
    _lease: File,
    directory: tempfile::TempDir,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAsset {
    pub id: String,
    pub entry: AssetEntry,
}
impl AssetRegistry {
    pub fn new(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        // Active process directories are leased; never remove another live app's assets.
        for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir()
                || !entry.file_name().to_string_lossy().starts_with("writer-")
            {
                continue;
            }
            if let Ok(lease) = OpenOptions::new()
                .read(true)
                .write(true)
                .open(entry.path().join(".lease"))
            {
                if lease.try_lock_exclusive().is_ok() {
                    drop(lease);
                    if let Err(error) = fs::remove_dir_all(entry.path()) {
                        if error.kind() != std::io::ErrorKind::NotFound {
                            return Err(error.to_string());
                        }
                    }
                }
            }
        }
        let directory = tempfile::Builder::new()
            .prefix("writer-")
            .tempdir_in(root)
            .map_err(|e| e.to_string())?;
        let lease = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(directory.path().join(".lease"))
            .map_err(|e| e.to_string())?;
        lease.lock_exclusive().map_err(|e| e.to_string())?;
        Ok(Self {
            root: Arc::new(SessionRoot {
                directory,
                _lease: lease,
            }),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        })
    }
    pub fn create(&self) -> Result<(String, Arc<AssetSession>), String> {
        let token = uuid::Uuid::new_v4().to_string();
        let directory = tempfile::Builder::new()
            .prefix("document-")
            .tempdir_in(self.root.directory.path())
            .map_err(|e| e.to_string())?;
        let session = Arc::new(AssetSession {
            assets: Mutex::new(HashMap::new()),
            _directory: directory,
        });
        self.sessions
            .lock()
            .map_err(|e| e.to_string())?
            .insert(token.clone(), session.clone());
        Ok((token, session))
    }
    pub fn get(&self, token: &str) -> Result<Arc<AssetSession>, String> {
        self.sessions
            .lock()
            .map_err(|e| e.to_string())?
            .get(token)
            .cloned()
            .ok_or("The document asset session is no longer available.".into())
    }
    pub fn close(&self, token: &str) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|e| e.to_string())?
            .remove(token);
        Ok(())
    }
    pub fn resolve(&self, token: &str, id: &str) -> Result<(Vec<u8>, String), String> {
        if !format::asset_id(id) {
            return Err("Invalid asset reference.".into());
        }
        let session = self.get(token)?;
        let asset = session
            .assets
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .cloned()
            .ok_or("Image asset not found.")?;
        Ok((
            fs::read(asset.file).map_err(|e| e.to_string())?,
            asset.entry.mime_type,
        ))
    }
}
impl AssetSession {
    pub fn add(&self, bytes: &[u8]) -> Result<ImportedAsset, String> {
        if bytes.is_empty() || bytes.len() > format::MAX_ASSET {
            return Err("Choose an image smaller than 32 MB.".into());
        }
        let hash = format!("{:x}", Sha256::digest(bytes));
        let id = format!("image-{hash}");
        if let Some(existing) = self.assets.lock().map_err(|e| e.to_string())?.get(&id) {
            return Ok(ImportedAsset {
                id,
                entry: existing.entry.clone(),
            });
        }
        let mime = validate_image(bytes)?;
        let entry = AssetEntry {
            path: format!("assets/{id}.{}", format::extension(mime)?),
            mime_type: mime.into(),
            sha256: hash,
            size: bytes.len() as u64,
        };
        let mut assets = self.assets.lock().map_err(|e| e.to_string())?;
        if !assets.contains_key(&id) {
            let total: u64 = assets.values().map(|asset| asset.entry.size).sum();
            if total + entry.size > format::MAX_PACKAGE {
                return Err("Working document images exceed the 128 MB safety limit. Save and reopen to release unused undo assets.".into());
            }
            let file = self._directory.path().join(&id);
            crate::filesystem::atomic_write(&file, bytes)?;
            assets.insert(
                id.clone(),
                Asset {
                    entry: entry.clone(),
                    file,
                },
            );
        }
        Ok(ImportedAsset { id, entry })
    }
    pub fn manifest(&self) -> Result<Manifest, String> {
        Ok(self
            .assets
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .map(|(id, a)| (id.clone(), a.entry.clone()))
            .collect())
    }
}
pub fn validate_image(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > format::MAX_ASSET {
        return Err("Choose an image smaller than 32 MB.".into());
    }
    let kind = image::guess_format(bytes)
        .map_err(|_| "Unsupported or corrupted image. Choose PNG, JPEG, or WebP.")?;
    let mime = match kind {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("Choose a PNG, JPEG, or WebP image.".into()),
    };
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), kind);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(|e| {
        eprintln!("Image decode failed: {e}");
        "The image is corrupted or exceeds the image safety limits.".to_string()
    })?;
    Ok(mime)
}
#[tauri::command]
pub async fn create_asset_session(
    registry: tauri::State<'_, AssetRegistry>,
) -> Result<String, String> {
    let registry = registry.inner().clone();
    crate::filesystem::blocking(move || registry.create().map(|(id, _)| id)).await
}
#[tauri::command]
pub async fn close_asset_session(
    session_id: String,
    registry: tauri::State<'_, AssetRegistry>,
) -> Result<(), String> {
    registry.close(&session_id)
}
#[tauri::command]
pub async fn import_image(
    path: String,
    session_id: String,
    registry: tauri::State<'_, AssetRegistry>,
) -> Result<ImportedAsset, String> {
    let registry = registry.inner().clone();
    crate::filesystem::blocking(move || {
        registry
            .get(&session_id)?
            .add(&crate::filesystem::read_limited_to(
                Path::new(&path),
                format::MAX_ASSET as u64,
            )?)
    })
    .await
}
