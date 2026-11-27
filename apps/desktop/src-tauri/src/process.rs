use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Returns platform executable filename (e.g. `ffmpeg.exe` on Windows, `ffmpeg` on Unix).
pub fn exe_name(base: &str) -> String {
    if cfg!(target_os = "windows") && !base.ends_with(".exe") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Creates a `std::process::Command` with `CREATE_NO_WINDOW` set on Windows so
/// background FFmpeg/FFprobe spawns never flash a black console window.
pub fn new_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Strips the Windows extended-length path prefix (`\\?\`) produced by `fs::canonicalize`
/// for regular drive paths (`\\?\C:\...` -> `C:\...`), since FFmpeg's `file` protocol
/// and `subtitles` filter reject `\\?\` prefixes.
pub fn normalize_fs_path(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(s) = path.to_str() {
            if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
                return PathBuf::from(format!(r"\\{stripped}"));
            }
            if let Some(stripped) = s.strip_prefix(r"\\?\") {
                return PathBuf::from(stripped);
            }
        }
    }
    path.to_path_buf()
}

/// Returns the app-managed binary directory (`<app_data_dir>/bin`).
pub fn managed_bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    Ok(data_dir.join("bin"))
}

/// Resolves an FFmpeg tool (`ffmpeg` or `ffprobe`) consistently across all commands:
/// 1. App-managed `<app_data_dir>/bin/<tool>(.exe)` first
/// 2. System `PATH` lookup second
pub fn resolve_binary(app: &AppHandle, base_name: &str) -> Option<PathBuf> {
    let bin_name = exe_name(base_name);

    if let Ok(bin_dir) = managed_bin_dir(app) {
        let managed = bin_dir.join(&bin_name);
        if managed.is_file() {
            return Some(managed);
        }
    }

    find_in_path(&bin_name)
}

/// Searches the `PATH` environment variable for an executable file.
pub fn find_in_path(bin_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(bin_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Probes a binary's `-version` output line without flashing a console window.
pub fn probe_version_line(binary: &Path) -> Option<String> {
    let output = new_command(binary).arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Some(
        stdout
            .lines()
            .next()
            .unwrap_or("ffmpeg (unknown version)")
            .trim()
            .to_string(),
    )
}
