//! Sequential migrations. The loader alone decides when these run.
use crate::{assets::AssetSession, format};
use base64::Engine;
use serde_json::{json, Value};
pub fn migrate(mut value: Value, session: &AssetSession) -> Result<(Value, bool), String> {
    let original = format::version(&value)?;
    let mut version = original;
    while version < format::CURRENT_VERSION {
        match version {
            1 => {
                migrate_v1_images(&mut value["content"], session, 0)?;
                value["assets"] = json!(session.manifest()?);
                value["formatVersion"] = json!(2);
            }
            _ => return Err("No migration is available for this document version.".into()),
        }
        version += 1;
    }
    format::validate(&value)?;
    Ok((value, original != version))
}
fn migrate_v1_images(node: &mut Value, session: &AssetSession, depth: usize) -> Result<(), String> {
    if depth > 100 {
        return Err("Document nesting exceeds the safety limit.".into());
    }
    if node["type"] == "image" {
        let src = node["attrs"]["src"]
            .as_str()
            .ok_or("Invalid legacy image.")?;
        let (prefix, encoded) = src
            .split_once(";base64,")
            .ok_or("Invalid legacy image source.")?;
        let mime = prefix
            .strip_prefix("data:")
            .ok_or("Invalid legacy image source.")?;
        format::extension(mime)?;
        if encoded.len() > format::MAX_ASSET * 4 / 3 + 4 {
            return Err("Legacy image exceeds the safety limit.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid legacy image encoding.")?;
        let asset = session.add(&bytes)?;
        if mime != asset.entry.mime_type {
            return Err("Legacy image MIME type does not match its contents.".into());
        }
        node["attrs"]["src"] = json!(format!("asset://{}", asset.id));
    }
    if let Some(children) = node.get_mut("content").and_then(Value::as_array_mut) {
        for child in children {
            migrate_v1_images(child, session, depth + 1)?;
        }
    }
    Ok(())
}
