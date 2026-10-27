//! Strict bounded ZIP reader/writer. Entry names are validated, never extracted.
use crate::{
    assets::AssetSession,
    format::{self, Manifest},
    migrations,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Seek, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};
pub struct Package {
    pub document: Value,
    pub assets: BTreeMap<String, Vec<u8>>,
    pub metadata: Value,
    pub migrated: bool,
}
fn zip_error(error: impl std::fmt::Display) -> String {
    eprintln!("NWR ZIP error: {error}");
    "The document package is damaged or uses an unsupported archive feature.".into()
}
fn read_entry<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    index: usize,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let file = zip.by_index(index).map_err(zip_error)?;
    if file.size() > limit
        || file.size() > 1024 * 1024
            && file.compressed_size() > 0
            && file.size() / file.compressed_size() > 200
    {
        return Err("The package exceeds archive expansion safety limits.".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(zip_error)?;
    if bytes.len() as u64 > limit {
        return Err("The package exceeds archive expansion safety limits.".into());
    }
    Ok(bytes)
}
pub fn read_zip(path: &Path, decode_images: bool) -> Result<Package, String> {
    let file = File::open(path).map_err(|e| crate::filesystem::io_error("open", path, e))?;
    if file.metadata().map_err(zip_error)?.len() > format::MAX_PACKAGE {
        return Err("Document package exceeds the 128 MB safety limit.".into());
    }
    let mut zip = ZipArchive::new(file).map_err(zip_error)?;
    if zip.len() > 1026 || zip.len() < 2 {
        return Err("Invalid document archive structure.".into());
    }
    let mut entries = BTreeMap::new();
    let mut total = 0_u64;
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(zip_error)?;
        let name = entry.name().map_err(zip_error)?.into_owned();
        let valid_name = name == "document.json"
            || name == "metadata.json"
            || name.strip_prefix("assets/").is_some_and(|part| {
                part.split_once('.').is_some_and(|(id, ext)| {
                    format::asset_id(id) && ["png", "jpg", "webp"].contains(&ext)
                })
            });
        if !valid_name
            || entry.enclosed_name().is_none()
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            || entries.insert(name, i).is_some()
        {
            return Err("The package contains an unsafe or duplicate archive path.".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Invalid package size.")?;
        if total > format::MAX_PACKAGE {
            return Err("The expanded package exceeds the 128 MB safety limit.".into());
        }
    }
    let index = *entries
        .get("document.json")
        .ok_or("The package is missing document.json.")?;
    let document: Value =
        serde_json::from_slice(&read_entry(&mut zip, index, format::MAX_JSON as u64)?)
            .map_err(|_| "The package contains invalid document JSON.")?;
    format::version(&document)?; // refuse future formats before interpreting content/assets
    let manifest = format::validate(&document)?;
    let index = *entries
        .get("metadata.json")
        .ok_or("The package is missing metadata.json.")?;
    let metadata: Value = serde_json::from_slice(&read_entry(&mut zip, index, 1024 * 1024)?)
        .map_err(|_| "The package contains invalid package metadata.")?;
    if metadata["packageVersion"] != 1 || metadata["formatVersion"] != format::CURRENT_VERSION {
        return Err("Unsupported package metadata version.".into());
    }
    if entries.len() != manifest.len() + 2 {
        return Err("The package contains undeclared or missing assets.".into());
    }
    let mut assets = BTreeMap::new();
    for (id, entry) in manifest {
        let index = *entries
            .get(&entry.path)
            .ok_or("An image asset is missing from the package.")?;
        let bytes = read_entry(&mut zip, index, format::MAX_ASSET as u64)?;
        if entry.size != bytes.len() as u64
            || entry.sha256 != format!("{:x}", Sha256::digest(&bytes))
        {
            return Err("An image asset failed its integrity check.".into());
        }
        if decode_images && crate::assets::validate_image(&bytes)? != entry.mime_type {
            return Err("An image MIME type does not match its contents.".into());
        }
        assets.insert(id, bytes);
    }
    Ok(Package {
        document,
        assets,
        metadata,
        migrated: false,
    })
}
pub fn read(path: &Path, session: &AssetSession) -> Result<Package, String> {
    let mut header = [0; 4];
    File::open(path)
        .map_err(|e| crate::filesystem::io_error("open", path, e))?
        .read_exact(&mut header)
        .map_err(zip_error)?;
    if header == *b"PK\x03\x04" {
        let package = read_zip(path, false)?;
        let manifest = format::manifest(&package.document)?;
        for (id, bytes) in &package.assets {
            let imported = session.add(bytes)?;
            if manifest.get(id) != Some(&imported.entry) {
                return Err("An image MIME type does not match its contents.".into());
            }
        }
        return Ok(package);
    }
    let value: Value =
        serde_json::from_slice(&crate::filesystem::read_limited_to(path, 50 * 1024 * 1024)?)
            .map_err(|_| "This is not a valid Nivra Writer document or package.")?;
    let (document, migrated) = migrations::migrate(value, session)?;
    // JSON v2 with no assets remains readable; assets are never resolved externally.
    let manifest = format::validate(&document)?;
    if !manifest.is_empty() && session.manifest()?.len() != manifest.len() {
        return Err("The document is missing its packaged image assets.".into());
    }
    Ok(Package {
        document,
        assets: BTreeMap::new(),
        metadata: json!({"packageVersion":1,"formatVersion":2}),
        migrated,
    })
}
pub fn prepare(
    mut document: Value,
    session: Option<&AssetSession>,
) -> Result<(Value, Manifest), String> {
    let manifest = format::validate(&document)?;
    let refs = format::references(&document["content"])?;
    let manifest: Manifest = manifest
        .into_iter()
        .filter(|(id, _)| refs.contains(id))
        .collect();
    if !manifest.is_empty() {
        let native = session
            .ok_or(
                "The document image session is missing. Save failed without changing the original.",
            )?
            .manifest()?;
        for (id, entry) in &manifest {
            if native.get(id) != Some(entry) {
                return Err(
                    "An image asset is missing or inconsistent. The document has not been saved."
                        .into(),
                );
            }
        }
    }
    document["assets"] = json!(manifest);
    Ok((document, manifest))
}
pub fn write_to(
    file: &mut File,
    document: &Value,
    manifest: &Manifest,
    session: Option<&AssetSession>,
    metadata: &Value,
) -> Result<(), String> {
    let json = serde_json::to_vec(document).map_err(zip_error)?;
    if json.len() > format::MAX_JSON {
        return Err("The document JSON exceeds the 16 MB safety limit.".into());
    }
    let mut zip = ZipWriter::new(file);
    // Raster files are already compressed. Stored entries also bound expansion predictably.
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o600);
    zip.start_file("document.json", options)
        .map_err(zip_error)?;
    zip.write_all(&json).map_err(zip_error)?;
    zip.start_file("metadata.json", options)
        .map_err(zip_error)?;
    zip.write_all(&serde_json::to_vec(metadata).map_err(zip_error)?)
        .map_err(zip_error)?;
    let mut total = json.len() as u64;
    if let Some(session) = session {
        let assets = session.assets.lock().map_err(|e| e.to_string())?;
        for (id, entry) in manifest {
            let asset = assets.get(id).ok_or("Missing document image asset.")?;
            total += entry.size;
            if total > format::MAX_PACKAGE - 1024 * 1024 {
                return Err("The document exceeds the 128 MB package safety limit.".into());
            }
            zip.start_file(&entry.path, options).map_err(zip_error)?;
            std::io::copy(&mut File::open(&asset.file).map_err(zip_error)?, &mut zip)
                .map_err(zip_error)?;
        }
    }
    zip.finish().map_err(zip_error)?;
    Ok(())
}
pub fn save(
    path: &Path,
    document: Value,
    session: Option<&AssetSession>,
    recovery: Option<Value>,
) -> Result<u64, String> {
    let (document, manifest) = prepare(document, session)?;
    let metadata = json!({"packageVersion":1,"formatVersion":2,"applicationVersion":"0.2.0","recovery":recovery});
    crate::filesystem::replace_with(
        path,
        recovery.is_none(),
        |file| write_to(file, &document, &manifest, session, &metadata),
        |temp| read_zip(temp, false).map(|_| ()),
        |_| Ok(()),
    )
}
/// Startup recovery listings inspect only bounded JSON, not every image payload.
/// Full package/asset integrity is checked again before a candidate is restored.
pub fn inspect(path: &Path) -> Result<(Value, Value), String> {
    let file = File::open(path).map_err(zip_error)?;
    if file.metadata().map_err(zip_error)?.len() > format::MAX_PACKAGE {
        return Err("Recovery package exceeds the safety limit.".into());
    }
    let mut zip = ZipArchive::new(file).map_err(zip_error)?;
    if zip.len() > 1026 {
        return Err("Invalid recovery package.".into());
    }
    let document_index = (0..zip.len())
        .find(|i| {
            zip.by_index(*i)
                .is_ok_and(|f| f.name().is_ok_and(|name| name == "document.json"))
        })
        .ok_or("Missing document.json.")?;
    let metadata_index = (0..zip.len())
        .find(|i| {
            zip.by_index(*i)
                .is_ok_and(|f| f.name().is_ok_and(|name| name == "metadata.json"))
        })
        .ok_or("Missing metadata.json.")?;
    let document: Value = serde_json::from_slice(&read_entry(
        &mut zip,
        document_index,
        format::MAX_JSON as u64,
    )?)
    .map_err(zip_error)?;
    format::validate(&document)?;
    let metadata: Value =
        serde_json::from_slice(&read_entry(&mut zip, metadata_index, 1024 * 1024)?)
            .map_err(zip_error)?;
    if metadata["packageVersion"] != 1 || metadata["formatVersion"] != 2 {
        return Err("Unsupported recovery package version.".into());
    }
    Ok((document, metadata))
}
