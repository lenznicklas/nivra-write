//! The single native format/schema boundary. No archive or UI version branches.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
pub const CURRENT_VERSION: u64 = 2;
pub const MAX_JSON: usize = 16 * 1024 * 1024;
pub const MAX_PACKAGE: u64 = 128 * 1024 * 1024;
pub const MAX_ASSET: usize = 32 * 1024 * 1024;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetEntry {
    pub path: String,
    pub mime_type: String,
    pub sha256: String,
    pub size: u64,
}
pub type Manifest = BTreeMap<String, AssetEntry>;
pub fn version(value: &Value) -> Result<u64, String> {
    let version = value["formatVersion"]
        .as_u64()
        .ok_or("This is not a valid Nivra Writer document.")?;
    if version > CURRENT_VERSION {
        return Err("This document was created with a newer version of Nivra Writer. Update the application to open it.".into());
    }
    if version == 0 {
        return Err("Unsupported document format version.".into());
    }
    Ok(version)
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
pub fn asset_id(id: &str) -> bool {
    id.strip_prefix("image-").is_some_and(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
pub fn extension(mime: &str) -> Result<&'static str, String> {
    match mime {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        _ => Err("Unsupported image format.".into()),
    }
}
pub fn manifest(value: &Value) -> Result<Manifest, String> {
    let entries: Manifest = serde_json::from_value(value["assets"].clone())
        .map_err(|_| "Invalid document asset manifest.")?;
    if entries.len() > 1024 {
        return Err("The document contains too many assets.".into());
    }
    for (id, entry) in &entries {
        if !asset_id(id)
            || entry.sha256 != id[6..]
            || entry.path != format!("assets/{id}.{}", extension(&entry.mime_type)?)
            || entry.size == 0
            || entry.size > MAX_ASSET as u64
        {
            return Err("Invalid document asset manifest entry.".into());
        }
    }
    Ok(entries)
}
pub fn references(content: &Value) -> Result<BTreeSet<String>, String> {
    let mut refs = BTreeSet::new();
    validate_node(content, 0, None, &mut refs)?;
    Ok(refs)
}
fn validate_node(
    value: &Value,
    depth: usize,
    parent: Option<&str>,
    refs: &mut BTreeSet<String>,
) -> Result<(), String> {
    if depth > 100 {
        return Err("Document nesting exceeds the safety limit.".into());
    }
    let node = value.as_object().ok_or("Invalid document content.")?;
    let kind = node
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Invalid document node.")?;
    let allowed = [
        "doc",
        "paragraph",
        "text",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "horizontalRule",
        "hardBreak",
        "image",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "codeBlock",
        "pageBreak",
    ];
    if !allowed.contains(&kind) {
        return Err(format!("Unsupported document node: {kind}"));
    }
    if parent.is_none() && kind != "doc" || parent.is_some() && kind == "doc" {
        return Err("Invalid document root.".into());
    }
    let inline = matches!(kind, "text" | "hardBreak");
    let valid_parent = match parent {
        None => true,
        Some("paragraph" | "heading" | "codeBlock") => inline,
        Some("bulletList" | "orderedList") => kind == "listItem",
        Some("table") => kind == "tableRow",
        Some("tableRow") => matches!(kind, "tableCell" | "tableHeader"),
        Some("doc" | "blockquote" | "listItem" | "tableCell" | "tableHeader") => {
            !inline && !matches!(kind, "listItem" | "tableRow" | "tableCell" | "tableHeader")
        }
        _ => false,
    };
    if !valid_parent {
        return Err("Invalid document node structure.".into());
    }
    if let Some(attrs) = node.get("attrs") {
        if !attrs.is_object() {
            return Err("Invalid document attributes.".into());
        }
    }
    if kind == "text"
        && !node
            .get("text")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
    {
        return Err("Invalid document text.".into());
    }
    if kind == "heading"
        && !value["attrs"]["level"]
            .as_u64()
            .is_some_and(|n| (1..=6).contains(&n))
    {
        return Err("Invalid heading level.".into());
    }
    if matches!(kind, "tableCell" | "tableHeader") {
        for key in ["colspan", "rowspan"] {
            if let Some(n) = value["attrs"].get(key) {
                if !n.as_u64().is_some_and(|n| (1..=100).contains(&n)) {
                    return Err("Invalid table dimensions.".into());
                }
            }
        }
    }
    if kind == "image" {
        let id = value["attrs"]["src"]
            .as_str()
            .and_then(|s| s.strip_prefix("asset://"))
            .filter(|id| asset_id(id))
            .ok_or("An image has an invalid asset reference.")?;
        refs.insert(id.to_owned());
    }
    if let Some(marks) = node.get("marks") {
        for mark in marks.as_array().ok_or("Invalid document formatting.")? {
            let kind = mark["type"]
                .as_str()
                .ok_or("Invalid document formatting.")?;
            if ![
                "bold",
                "italic",
                "underline",
                "strike",
                "textStyle",
                "highlight",
                "link",
                "code",
            ]
            .contains(&kind)
            {
                return Err("Unsupported document formatting.".into());
            }
            if kind == "link"
                && !mark["attrs"]["href"].as_str().is_some_and(|s| {
                    ["https://", "http://", "mailto:"]
                        .iter()
                        .any(|p| s.to_ascii_lowercase().starts_with(p))
                })
            {
                return Err("The document contains an unsafe link.".into());
            }
        }
    }
    if let Some(children) = node.get("content") {
        for child in children.as_array().ok_or("Invalid document content.")? {
            validate_node(child, depth + 1, Some(kind), refs)?;
        }
    }
    Ok(())
}
pub fn validate(value: &Value) -> Result<Manifest, String> {
    if version(value)? != CURRENT_VERSION {
        return Err("The document must be migrated before validation.".into());
    }
    let metadata = value["metadata"]
        .as_object()
        .ok_or("Invalid document metadata.")?;
    for key in [
        "id",
        "title",
        "createdAt",
        "modifiedAt",
        "author",
        "applicationVersion",
    ] {
        if !metadata.get(key).is_some_and(Value::is_string) {
            return Err("Invalid document metadata.".into());
        }
    }
    if !valid_id(metadata["id"].as_str().unwrap_or_default()) {
        return Err("Invalid document identity.".into());
    }
    let page = &value["pageSettings"];
    if !matches!(page["size"].as_str(), Some("A4" | "Letter"))
        || !matches!(page["orientation"].as_str(), Some("portrait" | "landscape"))
    {
        return Err("Invalid page settings.".into());
    }
    for side in ["top", "right", "bottom", "left"] {
        if !page["margins"][side]
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=70.0).contains(&v))
        {
            return Err("Invalid page margins.".into());
        }
    }
    let manifest = manifest(value)?;
    for id in references(&value["content"])? {
        if !manifest.contains_key(&id) {
            return Err(format!("The document is missing an image asset: {id}"));
        }
    }
    Ok(manifest)
}
