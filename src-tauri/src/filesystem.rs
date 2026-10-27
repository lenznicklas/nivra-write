use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
pub async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|e| e.to_string())?
}
pub fn io_error(action: &str, path: &Path, error: std::io::Error) -> String {
    eprintln!("{action} {}: {error}", path.display());
    format!("Could not {action} ‘{}’: {error}", path.display())
}
pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".bak");
    PathBuf::from(name)
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SaveStage {
    Created,
    Written,
    Validated,
    BackedUp,
    Replacing,
}
/// All fallible work before persist leaves the destination intact. The caller validates
/// the *completed temporary file*, not just its in-memory source.
pub fn replace_with(
    path: &Path,
    backup: bool,
    write: impl FnOnce(&mut File) -> Result<(), String>,
    validate: impl FnOnce(&Path) -> Result<(), String>,
    fault: impl Fn(SaveStage) -> Result<(), String>,
) -> Result<u64, String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or("Choose a valid absolute destination path.")?;
    if !parent.is_dir() {
        return Err(
            "The destination directory no longer exists. Choose another location with Save As."
                .into(),
        );
    }
    if path.exists()
        && (!path.is_file()
            || fs::metadata(path)
                .map_err(|e| io_error("inspect", path, e))?
                .permissions()
                .readonly())
    {
        return Err("The destination is read-only or is not a regular file. Use Save As to choose another location.".into());
    }
    let mut temp = tempfile::Builder::new()
        .prefix(".nivra-save-")
        .tempfile_in(parent)
        .map_err(|e| io_error("create a temporary file in", parent, e))?;
    fault(SaveStage::Created)?;
    write(temp.as_file_mut())?;
    temp.as_file()
        .sync_all()
        .map_err(|e| io_error("flush", temp.path(), e))?;
    fault(SaveStage::Written)?;
    validate(temp.path())?;
    fault(SaveStage::Validated)?;
    let size = temp.as_file().metadata().map_err(|e| e.to_string())?.len();
    if let Ok(metadata) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| io_error("preserve permissions for", path, e))?;
    }
    if backup && path.exists() {
        let target = backup_path(path);
        let mut previous = tempfile::Builder::new()
            .prefix(".nivra-backup-")
            .tempfile_in(parent)
            .map_err(|e| io_error("create a backup in", parent, e))?;
        let mut original =
            File::open(path).map_err(|e| io_error("read the previous version of", path, e))?;
        std::io::copy(&mut original, previous.as_file_mut())
            .map_err(|e| io_error("back up", path, e))?;
        previous
            .as_file()
            .sync_all()
            .map_err(|e| io_error("flush the backup of", path, e))?;
        previous
            .persist(&target)
            .map_err(|e| io_error("replace the backup of", path, e.error))?;
    }
    fault(SaveStage::BackedUp)?;
    fault(SaveStage::Replacing)?;
    temp.persist(path)
        .map_err(|e| io_error("replace", path, e.error))?;
    #[cfg(unix)]
    File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| io_error("sync the saved document directory", parent, e))?;
    Ok(size)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid destination.")?;
    fs::create_dir_all(parent).map_err(|e| io_error("create", parent, e))?;
    replace_with(
        path,
        false,
        |f| f.write_all(bytes).map_err(|e| io_error("write", path, e)),
        |_| Ok(()),
        |_| Ok(()),
    )
    .map(|_| ())
}
pub fn read_limited_to(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| io_error("open", path, e))?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error("read", path, e))?;
    if bytes.len() as u64 > limit {
        return Err(format!(
            "The file exceeds the {} MB safety limit.",
            limit / 1024 / 1024
        ));
    }
    Ok(bytes)
}
pub fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    read_limited_to(path, crate::format::MAX_PACKAGE)
}
