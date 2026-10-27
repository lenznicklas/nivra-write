use crate::{
    assets::AssetRegistry,
    filesystem::{self, SaveStage},
    format, package,
};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{Cursor, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipWriter};
fn doc() -> Value {
    json!({"formatVersion":2,"metadata":{"id":"document-test","title":"Test","createdAt":"2026-01-01T00:00:00Z","modifiedAt":"2026-01-01T00:00:00Z","author":"","applicationVersion":"0.2.0"},"pageSettings":{"size":"A4","orientation":"portrait","margins":{"top":25,"right":25,"bottom":25,"left":25}},"assets":{},"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original"}]}]}})
}
fn png() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(4, 4)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
fn fixture() -> (tempfile::TempDir, AssetRegistry) {
    let root = tempfile::tempdir().unwrap();
    let registry = AssetRegistry::new(&root.path().join("sessions")).unwrap();
    (root, registry)
}
fn image_doc(session: &crate::assets::AssetSession) -> Value {
    let asset = session.add(&png()).unwrap();
    let mut document = doc();
    document["assets"] = json!({asset.id.clone():asset.entry});
    document["content"]["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"image","attrs":{"src":format!("asset://{}",asset.id)}}));
    document
}
fn write_zip(path: &Path, entries: Vec<(&str, Vec<u8>)>) {
    let mut zip = ZipWriter::new(File::create(path).unwrap());
    for (name, bytes) in entries {
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap();
}
#[test]
fn atomic_package_save_and_bounded_backup_rotation() {
    let (root, registry) = fixture();
    let (_, session) = registry.create().unwrap();
    let path = root.path().join("test.nwr");
    let document = image_doc(&session);
    package::save(&path, document.clone(), Some(&session), None).unwrap();
    let first = fs::read(&path).unwrap();
    let mut newer = document;
    newer["metadata"]["title"] = json!("Newer");
    package::save(&path, newer.clone(), Some(&session), None).unwrap();
    assert_eq!(fs::read(filesystem::backup_path(&path)).unwrap(), first);
    assert_eq!(
        package::read_zip(&path, true).unwrap().document["metadata"]["title"],
        "Newer"
    );
    package::save(&path, newer, Some(&session), None).unwrap();
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 3);
}
#[test]
fn every_precommit_fault_preserves_original_and_cleans_temp() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("fault.nwr");
    fs::write(&path, b"original bytes").unwrap();
    for stage in [
        SaveStage::Created,
        SaveStage::Written,
        SaveStage::Validated,
        SaveStage::BackedUp,
        SaveStage::Replacing,
    ] {
        let result = filesystem::replace_with(
            &path,
            true,
            |f| f.write_all(b"new bytes").map_err(|e| e.to_string()),
            |_| Ok(()),
            |point| {
                if point == stage {
                    Err(format!("Injected failure: {point:?}"))
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original bytes");
        assert!(!fs::read_dir(root.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".nivra-")));
    }
}
#[test]
fn disk_full_and_validation_failure_preserve_original() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("full.nwr");
    fs::write(&path, b"original").unwrap();
    assert!(filesystem::replace_with(
        &path,
        true,
        |f| {
            f.write_all(b"partial").unwrap();
            Err("No space left on device".into())
        },
        |_| Ok(()),
        |_| Ok(())
    )
    .is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original");
    assert!(filesystem::replace_with(
        &path,
        true,
        |f| f.write_all(b"not a zip").map_err(|e| e.to_string()),
        |temp| package::read_zip(temp, false).map(|_| ()),
        |_| Ok(())
    )
    .is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original");
}
#[test]
fn invalid_missing_and_readonly_destinations_fail_safely() {
    let root = tempfile::tempdir().unwrap();
    for path in [
        root.path().join("missing/test.nwr"),
        root.path().to_path_buf(),
    ] {
        assert!(package::save(&path, doc(), None, None).is_err());
    }
    let path = root.path().join("readonly.nwr");
    fs::write(&path, b"original").unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(package::save(&path, doc(), None, None).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original");
}
#[test]
fn corrupted_existing_file_is_preserved_in_backup_on_explicit_replace() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("corrupt.nwr");
    fs::write(&path, b"corrupted existing file").unwrap();
    package::save(&path, doc(), None, None).unwrap();
    assert_eq!(
        fs::read(filesystem::backup_path(&path)).unwrap(),
        b"corrupted existing file"
    );
    assert!(package::read_zip(&path, true).is_ok());
}
#[test]
fn v1_inline_images_migrate_and_remain_portable() {
    use base64::Engine;
    let (root, registry) = fixture();
    let (_, session) = registry.create().unwrap();
    let mut legacy = doc();
    legacy["formatVersion"] = json!(1);
    legacy.as_object_mut().unwrap().remove("assets");
    legacy["content"]["content"].as_array_mut().unwrap().push(json!({"type":"image","attrs":{"src":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(png()))}}));
    let path = root.path().join("legacy.nwr");
    fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let loaded = package::read(&path, &session).unwrap();
    assert!(loaded.migrated);
    assert_eq!(loaded.document["formatVersion"], 2);
    let saved = root.path().join("packaged.nwr");
    package::save(&saved, loaded.document, Some(&session), None).unwrap();
    let moved = root.path().join("moved.nwr");
    fs::rename(&saved, &moved).unwrap();
    assert_eq!(package::read_zip(&moved, true).unwrap().assets.len(), 1);
}
#[test]
fn future_versions_rejected_before_interpretation() {
    let (root, registry) = fixture();
    let (_, session) = registry.create().unwrap();
    let path = root.path().join("future.nwr");
    let mut future = doc();
    future["formatVersion"] = json!(99);
    fs::write(&path, serde_json::to_vec(&future).unwrap()).unwrap();
    assert!(package::read(&path, &session)
        .err()
        .unwrap()
        .contains("newer version"));
}
#[test]
fn corrupt_archives_paths_and_duplicate_entries_rejected() {
    let root = tempfile::tempdir().unwrap();
    for name in [
        "../../escape",
        "/absolute",
        "assets/../escape",
        "assets/image-evil.png",
        "document.json/../file",
    ] {
        let path = root.path().join("bad.nwr");
        write_zip(
            &path,
            vec![
                ("document.json", serde_json::to_vec(&doc()).unwrap()),
                (name, vec![1]),
            ],
        );
        assert!(package::read_zip(&path, true).is_err());
    }
    let path = root.path().join("broken.nwr");
    fs::write(&path, b"PK\x03\x04 broken").unwrap();
    assert!(package::read_zip(&path, true).is_err());
}
#[test]
fn missing_tampered_and_mislabeled_assets_rejected() {
    let (root, registry) = fixture();
    let (_, session) = registry.create().unwrap();
    let document = image_doc(&session);
    let manifest = format::manifest(&document).unwrap();
    let entry = manifest.values().next().unwrap();
    let path = root.path().join("missing.nwr");
    write_zip(
        &path,
        vec![
            ("document.json", serde_json::to_vec(&document).unwrap()),
            (
                "metadata.json",
                serde_json::to_vec(&json!({"packageVersion":1,"formatVersion":2})).unwrap(),
            ),
        ],
    );
    assert!(package::read_zip(&path, true).is_err());
    write_zip(
        &path,
        vec![
            ("document.json", serde_json::to_vec(&document).unwrap()),
            (
                "metadata.json",
                serde_json::to_vec(&json!({"packageVersion":1,"formatVersion":2})).unwrap(),
            ),
            (&entry.path, b"corrupt image".to_vec()),
        ],
    );
    assert!(package::read_zip(&path, true).is_err());
    assert!(session.add(b"\x89PNG\r\n\x1a\ncorrupted").is_err());
}
#[test]
fn duplicate_assets_reused_and_orphans_omitted_without_breaking_undo() {
    let (root, registry) = fixture();
    let (_, session) = registry.create().unwrap();
    let first = session.add(&png()).unwrap();
    let again = session.add(&png()).unwrap();
    assert_eq!(first.id, again.id);
    assert_eq!(session.manifest().unwrap().len(), 1);
    let mut document = image_doc(&session);
    document["content"] = doc()["content"].clone();
    let path = root.path().join("no-images.nwr");
    package::save(&path, document, Some(&session), None).unwrap();
    assert!(package::read_zip(&path, true).unwrap().assets.is_empty());
    assert_eq!(session.manifest().unwrap().len(), 1);
}
#[test]
fn session_capabilities_isolate_documents_and_cleanup() {
    let (root, registry) = fixture();
    let (first, a) = registry.create().unwrap();
    let (second, _) = registry.create().unwrap();
    let asset = a.add(&png()).unwrap();
    assert!(registry.resolve(&second, &asset.id).is_err());
    assert!(registry.resolve(&first, "../../etc/passwd").is_err());
    assert!(registry.resolve(&first, &asset.id).is_ok());
    registry.close(&first).unwrap();
    drop(a);
    assert!(registry.get(&first).is_err());
    drop(registry);
    let fresh = AssetRegistry::new(&root.path().join("sessions")).unwrap();
    assert!(fresh.get(&second).is_err());
}
#[test]
fn recovery_package_and_metadata_load_without_overwriting_original() {
    let (root, registry) = fixture();
    let (_, session) = registry.create().unwrap();
    let document = image_doc(&session);
    let original = root.path().join("original.nwr");
    fs::write(&original, b"original").unwrap();
    let snapshot = json!({"path":original,"savedAt":"2026-01-01T00:00:00Z","editRevision":42});
    let metadata = crate::recovery::metadata(&snapshot, &document, "recovery-test").unwrap();
    let path = root.path().join("recovery.nwr");
    package::save(&path, document, Some(&session), Some(metadata)).unwrap();
    let (_, metadata) = package::inspect(&path).unwrap();
    assert_eq!(metadata["recovery"]["editRevision"], 42);
    assert_eq!(metadata["recovery"]["documentId"], "document-test");
    assert_eq!(fs::read(&original).unwrap(), b"original");
    assert!(!filesystem::backup_path(&path).exists());
}
#[test]
fn decompression_expansion_duplicate_names_and_symlinks_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("expansion.nwr");
    let mut huge = doc();
    huge["content"]["content"][0]["content"][0]["text"] = json!("a".repeat(2 * 1024 * 1024));
    let mut zip = ZipWriter::new(File::create(&path).unwrap());
    zip.start_file(
        "document.json",
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(&serde_json::to_vec(&huge).unwrap()).unwrap();
    zip.start_file("metadata.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"{\"packageVersion\":1,\"formatVersion\":2}")
        .unwrap();
    zip.finish().unwrap();
    assert!(package::read_zip(&path, false)
        .err()
        .unwrap()
        .contains("expansion"));
    write_zip(
        &path,
        vec![
            ("document.json", serde_json::to_vec(&doc()).unwrap()),
            ("metadata.json", b"{}".to_vec()),
        ],
    );
    let bytes = fs::read(&path).unwrap();
    let mut duplicate = bytes.clone();
    for i in 0..bytes.len() - 13 {
        if &bytes[i..i + 13] == b"metadata.json" {
            duplicate[i..i + 13].copy_from_slice(b"document.json");
        }
    }
    fs::write(&path, duplicate).unwrap();
    assert!(package::read_zip(&path, false).is_err());
    let mut zip = ZipWriter::new(File::create(&path).unwrap());
    zip.start_file("document.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(&serde_json::to_vec(&doc()).unwrap()).unwrap();
    zip.add_symlink(
        "metadata.json",
        "../../outside",
        SimpleFileOptions::default(),
    )
    .unwrap();
    zip.finish().unwrap();
    assert!(package::read_zip(&path, false).is_err());
}
#[test]
fn mismatched_mime_claims_and_invalid_content_are_rejected() {
    let (root, registry) = fixture();
    let (_, session) = registry.create().unwrap();
    let mut document = image_doc(&session);
    let id = document["assets"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    let path_name = format!("assets/{id}.jpg");
    document["assets"][&id]["path"] = json!(path_name);
    document["assets"][&id]["mimeType"] = json!("image/jpeg");
    let path = root.path().join("mime.nwr");
    write_zip(
        &path,
        vec![
            ("document.json", serde_json::to_vec(&document).unwrap()),
            (
                "metadata.json",
                b"{\"packageVersion\":1,\"formatVersion\":2}".to_vec(),
            ),
            (&path_name, png()),
        ],
    );
    assert!(package::read_zip(&path, true).is_err());
    assert!(package::read(&path, &session).is_err());
    for content in [
        json!({"type":"doc","content":[{"type":"text","text":"wrong parent"}]}),
        json!({"type":"doc","content":[{"type":"heading","attrs":{"level":99}}]}),
        json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}),
    ] {
        let mut invalid = doc();
        invalid["content"] = content;
        assert!(format::validate(&invalid).is_err());
    }
}
#[cfg(unix)]
#[test]
fn real_directory_permission_denial_preserves_original() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("restricted");
    fs::create_dir(&folder).unwrap();
    let path = folder.join("file.nwr");
    fs::write(&path, b"original").unwrap();
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o500)).unwrap();
    // Root can bypass mode bits; only assert denial when the test user is restricted.
    if File::create(folder.join("probe")).is_err() {
        assert!(package::save(&path, doc(), None, None).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
    }
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).unwrap();
}
