# Nivra Writer

A local desktop word processor built with **Tauri 2, Rust, Svelte 5, TypeScript, Vite, Tiptap / ProseMirror, and Lucide**. Version 0.2 extends the existing editor with portable document packages, native asset management, migration, storage fault protection, and a fixed application UI scale. No account or network service is required.

## Run and build

Requirements: Node.js 22.12+ (Node 24 LTS recommended), npm, stable Rust/Cargo, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Linux needs WebKitGTK 4.1, GTK 3, build tools, OpenSSL, librsvg, and the platform indicator dependencies. macOS needs Xcode command line tools; Windows needs MSVC and WebView2.

```sh
npm ci
npm run tauri dev
```

The browser-only preview is `npm run dev`, at `http://127.0.0.1:1420`. Native storage and image import require the desktop app.

```sh
npm run tauri build
# Or compile without an installer:
npm run tauri build -- --no-bundle
```

The Linux executable is `src-tauri/target/release/nivra-writer`. Debian packages are in `src-tauri/target/release/bundle/deb/`. Change `bundle.targets` in `src-tauri/tauri.conf.json` for other platform installers. Signing/notarization is not configured. Stop running copies of the release binary before packaging: Linux will not permit the packager to patch a running executable.

## Current features

The existing rich-text editor remains intact: H1–H6, font family/size, bold/italic/underline/strike, text/highlight colors, alignment, lists and nested lists, links, blockquotes, rules, hard breaks, paragraph spacing/indentation, history, images, and resizable tables. Home and Insert ribbons, context/file menus, keyboard shortcuts, outline navigation, continuous A4/Letter paper, page settings, 50–200% document zoom, counts, light/dark/system themes, settings, recent files, HTML/text export, native open/save, and recovery are supported.

Images may be selected through the native picker or dropped onto an open document. Dropped `.nwr` files open through the unsaved-work guard. Missing recent files are checked on native workers, marked unavailable, and can be removed with the adjacent × button; this never deletes the document itself.

## Architecture

The existing boundaries are preserved:

```text
Svelte components → EditorCommands → Tiptap / ProseMirror
        ↓
DocumentSession → repository / AssetManager / recovery / exporters
        ↓
Native bridge → Tauri commands → blocking worker pool
        ↓
format validation / migrations / ZIP packages / atomic replacement

Continuous document → PageLayoutService → visual paper
Logical image ID → session-scoped resolver → native asset protocol
```

Important directories and files:

- `src/lib/components/`: shell, ribbon, editor canvas, dialogs, outline, menus, status bar, and common controls.
- `src/lib/editor/commands/`: the single editor command facade.
- `src/lib/editor/document/`: current model validation, asset resolver contract, and actual ProseMirror schema validation.
- `src/lib/editor/extensions/`: schema extensions and the asset image NodeView. The NodeView resolves display URLs without rewriting persisted node attributes.
- `src/lib/stores/document.svelte.ts`: edit/save revisions, document lifecycle, import coordination, debounced statistics/recovery, and save state.
- `src/lib/stores/recent.svelte.ts`: recent history, asynchronous availability checks, and serialized history writes.
- `src/lib/services/documents/`: repository and session-owned `AssetManager` (`addAsset`, `removeAsset`, `resolveAsset`, `listAssets`, `cleanupUnusedAssets`).
- `src/lib/services/autosave/`: recovery candidate metadata, persistence, and lazy restore.
- `src/lib/services/native/zoom-policy.ts`: one application-level browser gesture fallback, installed once.
- `src-tauri/src/format.rs`: native schema, version and asset manifest validation, and safety limits.
- `src-tauri/src/migrations.rs`: sequential migration pipeline.
- `src-tauri/src/package.rs`: bounded ZIP read/write, integrity checks, orphan filtering, and package inspection.
- `src-tauri/src/assets.rs`: native temporary asset sessions, SHA-256 deduplication, image validation, and capability resolution.
- `src-tauri/src/filesystem.rs`: atomic replacement, bounded backup, durability, and fault-injection stages.
- `src-tauri/src/recovery.rs`: self-contained recovery packages and metadata-only startup listings.
- `src-tauri/src/webview_policy.rs`: isolated platform-native browser zoom protection.

UI components do not read or write files. Editor extensions do not import native/file APIs. Heavy archive, image decoding, hashing, and file operations run on Rust workers. Assets never travel through the editor's reactive document as base64.

## `.nwr` v2 package

A document is one portable ZIP file:

```text
document.nwr
├── document.json
├── metadata.json
└── assets/
    ├── image-<64 lowercase SHA-256 hex characters>.png
    └── image-<64 lowercase SHA-256 hex characters>.webp
```

`document.json` contains `formatVersion: 2`, the existing document metadata (ID, title, timestamps, author, application version), page settings, structured ProseMirror content, and an asset manifest:

```text
assets["image-<sha256>"] = {
  path: "assets/image-<sha256>.png",
  mimeType: "image/png",
  sha256: "<64 lowercase hex characters>",
  size: <original file byte count>
}
```

An image node stores `attrs.src = "asset://image-<sha256>"`. It never stores an external file path, a temporary path, or a display capability token. `metadata.json` identifies `packageVersion: 1`, `formatVersion: 2`, and application version; recovery packages additionally include recovery metadata.

Identical byte sequences reuse one asset entry even if inserted multiple times. Before saving, only assets still referenced anywhere in the document are included. Native working copies remain available until document close so deleting an image, saving, and undoing the deletion still works. No automatic image optimization, re-encoding, or quality reduction occurs. ZIP entries are stored without recompressing raster files; future optional optimization belongs behind the asset boundary.

HTML export resolves logical references into portable data URLs on a native worker. Exported HTML does not depend on the live app's temporary capability URLs. Plain text export remains independent of assets.

### Migration and compatibility

The native loader reads the version before interpreting document content. `migrations.rs` runs ordered steps to the current format; the initial step migrates v1 JSON documents and their inline raster images into v2 logical assets. Existing v1 JSON recovery files are also restored through this pipeline. The frontend accepts only the validated current model.

Opening an older document migrates in memory and marks it unsaved. Saving writes a v2 package and keeps the previous original as `.nwr.bak`; simply opening never changes the original. Future unsupported versions are refused with “This document was created with a newer version of Nivra Writer.” They are not partially interpreted. Add future migrations centrally, with fixtures, rather than version branches in UI components.

### Temporary asset security

Each process leases a randomly named private directory below Tauri's application cache `asset-sessions/`. Each document gets its own random native session and private temporary asset directory. On close the session is revoked and its temporary data is removed after any active worker finishes. On startup, stale process directories are cleaned only after obtaining their lease; another live app instance's directory is preserved.

Archive paths are **never extracted**. Verified raster bytes are written using generated hash IDs. The custom `nwr-asset` protocol accepts only a live session capability and a valid manifest asset ID, never a filesystem path. Only declared, validated raster files can be served; arbitrary directories are not exposed. Display capability URLs are ephemeral and never persisted.

### Validation and limits

Documents are untrusted input. Native validation checks metadata, page settings, document structure, marks, version, logical references, manifest paths, MIME claims, byte sizes, and SHA-256 integrity. The frontend also validates the current model and checks it against the actual ProseMirror schema before replacing the current session.

The ZIP dependency uses the patched v9 line; the app does not call archive extraction APIs ([RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)). ZIP paths must exactly match the declared generated asset paths or the two JSON entry names. Absolute paths, traversal, directories, symlinks, duplicate names, undeclared/missing entries, malformed archives, unsupported features, corrupt assets, and mismatched hashes/MIME claims are rejected. No arbitrary HTML or scripts are rendered from documents. Remote image references are not accepted.

Limits: 128 MB packaged/expanded data, 16 MB document JSON, 1 MB package metadata, 1,024 assets, 32 MB per image, nesting depth 100, image dimensions at most 16,384 per axis, and a 128 MB decoded-image allocation limit. Compressed entries with excessive expansion are rejected. The image library fully decodes imported raster data to validate it on a worker, then retains the original bytes. Working images retained for undo also have a 128 MB session budget; saving and reopening releases unused working assets.

## Saving, backups, and status

A main save creates a unique private temporary sibling in the destination directory, writes the complete ZIP, flushes it, reopens and validates the completed package, and prepares one atomic `.nwr.bak` copy of the previous original. Only then does it atomically replace the original. On Unix the containing directory is synced as well. Existing permissions are preserved for replacements. Missing directories, read-only destinations, permission failures, invalid targets, temporary-file errors, write/flush/validation/backup/rename errors are surfaced without reporting a successful save. Precommit failures leave the original intact. A directory-sync failure after replacement is an uncertain durability error; the bounded backup remains available.

The backup is always the previous original at replacement time, including a corrupt original if the user explicitly replaces it. Backups rotate rather than accumulate. Recovery writes do not create backup chains. Interrupted processes can leave a temporary sibling; it does not replace the last completed file.

`editRevision`, `savingRevision`, and `lastSavedRevision` determine status. “Saved” requires equality of edited/saved revisions. Editing during an asynchronous save retains “Unsaved.” Actual persistence failures show “Save failed” and a useful error. A failure updating recent history or removing a stale recovery snapshot does not falsely report a successful document write as failed. The status bar also shows last saved package size, without per-keystroke package serialization.

## Autosave and crash recovery

Recovery is separate from explicit saving. A snapshot is scheduled after the configured idle interval (default 15 seconds), with a 60-second maximum delay during continuous typing. There is no per-keystroke document serialization; unchanged revisions are skipped, recovery writes do not overlap, and manual saves coordinate with any recovery write already in flight.

Each snapshot is its own validated `.nwr` package containing the referenced assets. Its metadata includes a per-session recovery ID, document ID/title, original path, autosave timestamp, and edit revision. Startup checks whether the original still exists. Startup listings read bounded JSON metadata on workers and do not send complete documents or image data to the UI. Full package/image validation and asset session creation happen on restore. Corrupt candidates are reported individually while valid candidates remain recoverable.

Recovery never overwrites the original automatically. Successful main saves and explicit discards remove the corresponding recovery files. Restoring a candidate loads an unsaved session; other candidates remain on disk for the next startup. Closing the recovery dialog preserves its files. A crash before a completed snapshot can still lose recent edits.

Settings and history live in Tauri's application-data directory for `app.nivra.writer`. Corrupt JSON is preserved as a bounded `.corrupt.json` copy and defaults are used, so it cannot break application startup or native unsaved-close protection. Recent availability checks run off the UI thread and stale entries can be removed without deleting files.

## Fixed UI scale and document zoom

Browser zoom and document zoom are separate. `zoomHotkeysEnabled: false` disables WebView2 zoom controls on Windows. Linux blocks native GTK touchpad pinch and modified-wheel events and holds WebKit page zoom at 1. macOS disables WKWebView magnification. One centralized, non-passive application fallback blocks modified wheels, WebKit gesture events, and browser zoom keys. Ordinary wheel events and horizontal/vertical touchpad scrolling pass through. CSS touch actions allow panning without browser pinch scaling.

The document zoom slider, ± controls, percentage, and paper-only scaling are unchanged. OS display scaling/accessibility magnification is outside the app's browser zoom policy.

## Tests and verification

```sh
npm run check
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npx playwright install chromium
npx playwright test
npm run tauri build
# Linux, after packaging finishes, with WebKitWebDriver and a display:
python3 tests/native/smoke.py
```

Tests cover model/manifest validation, schema, version rejection and v1 migration, atomic success/backup rotation, injected write/disk-full/validation/precommit failures, real permission denial where supported, original preservation, corrupt ZIPs, traversal, duplicate entries, symlinks, expansion limits, missing/tampered/mislabeled images, deduplication, orphan filtering, asset session isolation, recovery creation/metadata, debounce/max-wait, async save revisions, settings persistence, recent history, browser zoom guards, and editor operations.

Browser checks exercise the writing UI, tables, themes, document zoom, normal horizontal/vertical scrolling, and a 1,500-paragraph input benchmark. A local native release run measured about 38 ms to import a 4 MB raster, 48 ms to save its package, and 53 ms to reopen it, including IPC overhead. Measurements depend on hardware and build contention; they are regression checks, not frame-time guarantees. Native smoke tests use temporary data and a real release window to exercise migration, Save/reopen, image drops, deduplication, source deletion, moved packages, image rendering, HTML export, packaged autosave, forced process termination/recovery, restart settings, corrupt settings, and stale recents. Test screenshots are written under `/tmp/nivra-*.png`.

## Remaining limitations and next steps

- Windows/macOS native code and installer behavior still require platform CI/hardware validation. Synthetic/native-driver zoom tests do not substitute for testing physical touchpads and every compositor/WebView version.
- Native chooser interaction and real disk-full volumes require manual/platform tests; write/ENOSPC/interruption paths currently use fault injection plus real permission tests. There is no external file-change conflict detection or multiwindow editing UI.
- Working assets retained for undo consume temporary disk space until close; package reads/validation can temporarily hold asset bytes in native memory. Limits are enforced, but streaming large-package benchmarks and filesystem fault/crash testing remain valuable.
- Counts/outline remain debounced linear scans. Advanced font enumeration, image resize handles, clipboard-image import across documents, and a floating selection toolbar remain future work.
- The layout remains one continuous visual sheet. DOCX, PDF, printing, real pagination, comments, tracked changes, collaboration, and cloud sync are deliberately not implemented in this iteration.

Recommended next step: cross-platform storage/gesture CI, real crash/ENOSPC fault testing and external-change conflict detection, followed by measured streaming I/O improvements. Future product work can then build pagination, headers/footers, footnotes, sections, columns, DOCX/PDF adapters, comments, spell/grammar checking, equations, table of contents, templates, version history, collaboration, and optional cloud sync on these boundaries.
