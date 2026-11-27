use crate::process::{exe_name, managed_bin_dir, probe_version_line};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

/// Emitted as `ffmpeg-download-progress` while downloading verified binaries.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub stage: String,
    pub binary: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
}

/// Prevents concurrent invocations of `download_ffmpeg`.
#[derive(Default)]
pub struct DownloadGuard {
    in_progress: AtomicBool,
}

impl DownloadGuard {
    pub fn new() -> Self {
        Self {
            in_progress: AtomicBool::new(false),
        }
    }

    pub fn try_acquire(&self) -> Result<DownloadLease<'_>, String> {
        self.in_progress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| DownloadLease { guard: self })
            .map_err(|_| "An FFmpeg download is already in progress".to_string())
    }
}

/// RAII guard that always releases `DownloadGuard` when dropped.
pub struct DownloadLease<'a> {
    guard: &'a DownloadGuard,
}

impl Drop for DownloadLease<'_> {
    fn drop(&mut self) {
        self.guard.in_progress.store(false, Ordering::SeqCst);
    }
}

/// Pinned immutable release artifact with expected lowercase hex SHA-256 checksum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinnedBinaryAsset {
    pub binary_name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
}

/// Pinned release manifest from immutable GitHub release `eugeneware/ffmpeg-static@b6.1.1`.
/// Provides direct standalone binaries for BOTH `ffmpeg` and `ffprobe` on all 5 desktop targets
/// with verified SHA-256 checksums.
pub fn pinned_assets_for(os: &str, arch: &str) -> Result<[PinnedBinaryAsset; 2], String> {
    match (os, arch) {
        ("windows", "x86_64") => Ok([
            PinnedBinaryAsset {
                binary_name: "ffmpeg",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64",
                sha256: "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
            },
            PinnedBinaryAsset {
                binary_name: "ffprobe",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-win32-x64",
                sha256: "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4",
            },
        ]),
        ("macos", "aarch64") => Ok([
            PinnedBinaryAsset {
                binary_name: "ffmpeg",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64",
                sha256: "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584",
            },
            PinnedBinaryAsset {
                binary_name: "ffprobe",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64",
                sha256: "bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64",
            },
        ]),
        ("macos", "x86_64") => Ok([
            PinnedBinaryAsset {
                binary_name: "ffmpeg",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64",
                sha256: "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894",
            },
            PinnedBinaryAsset {
                binary_name: "ffprobe",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-x64",
                sha256: "fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0",
            },
        ]),
        ("linux", "x86_64") => Ok([
            PinnedBinaryAsset {
                binary_name: "ffmpeg",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64",
                sha256: "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
            },
            PinnedBinaryAsset {
                binary_name: "ffprobe",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-linux-x64",
                sha256: "4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d",
            },
        ]),
        ("linux", "aarch64") => Ok([
            PinnedBinaryAsset {
                binary_name: "ffmpeg",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-arm64",
                sha256: "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
            },
            PinnedBinaryAsset {
                binary_name: "ffprobe",
                url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-linux-arm64",
                sha256: "d17ae9b4c297d48e2521ba14e417bb0537c6ff77c584cdbcd6bb0d8d0307a2e8",
            },
        ]),
        _ => Err(format!(
            "No pinned FFmpeg binary release is configured for {os}/{arch}. Please install ffmpeg and ffprobe onto your system PATH."
        )),
    }
}

/// Verifies that a SHA-256 hex digest matches the expected pinned digest (case-insensitive).
pub fn verify_sha256_hex(actual_hex: &str, expected_hex: &str) -> Result<(), String> {
    if !actual_hex.eq_ignore_ascii_case(expected_hex) {
        return Err(format!(
            "SHA-256 checksum mismatch: expected {expected_hex}, got {actual_hex}"
        ));
    }
    Ok(())
}

/// Downloads and verifies both `ffmpeg` and `ffprobe` into `<app_data_dir>/bin/`.
pub fn install_verified_ffmpeg_blocking(app: &AppHandle) -> Result<String, String> {
    let assets = pinned_assets_for(std::env::consts::OS, std::env::consts::ARCH)?;
    let bin_dir = managed_bin_dir(app)?;
    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("Failed to create app bin directory: {e}"))?;

    for asset in assets {
        download_and_verify_asset(app, &bin_dir, asset)?;
    }

    // Verify both binaries exist and respond to `-version`
    let ffmpeg_dest = bin_dir.join(exe_name("ffmpeg"));
    let ffprobe_dest = bin_dir.join(exe_name("ffprobe"));

    let ffmpeg_ver = probe_version_line(&ffmpeg_dest).ok_or_else(|| {
        "Downloaded ffmpeg binary failed post-install version verification".to_string()
    })?;
    if probe_version_line(&ffprobe_dest).is_none() {
        return Err(
            "Downloaded ffprobe binary failed post-install version verification".to_string(),
        );
    }

    let _ = app.emit(
        "ffmpeg-download-progress",
        DownloadProgressPayload {
            stage: "complete".into(),
            binary: "ffmpeg+ffprobe".into(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(100.0),
        },
    );

    Ok(format!(
        "Installed verified FFmpeg & FFprobe ({ffmpeg_ver}) into {}",
        bin_dir.display()
    ))
}

fn download_and_verify_asset(
    app: &AppHandle,
    bin_dir: &Path,
    asset: PinnedBinaryAsset,
) -> Result<(), String> {
    let target_name = exe_name(asset.binary_name);
    let final_path = bin_dir.join(&target_name);
    let part_path = bin_dir.join(format!("{target_name}.part"));

    let _ = app.emit(
        "ffmpeg-download-progress",
        DownloadProgressPayload {
            stage: "downloading".into(),
            binary: asset.binary_name.into(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(0.0),
        },
    );

    let mut response = ureq::get(asset.url)
        .header("User-Agent", "FFmpeg-UI-Desktop/2.0.0")
        .call()
        .map_err(|e| format!("Failed to download {}: {e}", asset.binary_name))?;

    let total_bytes = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    let mut file = File::create(&part_path)
        .map_err(|e| format!("Failed to create temp file for {}: {e}", asset.binary_name))?;

    let mut reader = response.body_mut().as_reader();
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_emitted: u64 = 0;

    loop {
        let n = reader.read(&mut buf).map_err(|e| {
            let _ = fs::remove_file(&part_path);
            format!("Network read error while downloading {}: {e}", asset.binary_name)
        })?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| {
            let _ = fs::remove_file(&part_path);
            format!("Disk write error while saving {}: {e}", asset.binary_name)
        })?;
        hasher.update(&buf[..n]);
        downloaded += n as u64;

        // Emit progress at most every ~512 KiB
        if downloaded.saturating_sub(last_emitted) >= 512 * 1024 {
            last_emitted = downloaded;
            let percent = total_bytes.and_then(|tot| {
                if tot > 0 {
                    Some(((downloaded as f64 / tot as f64) * 100.0).min(99.0))
                } else {
                    None
                }
            });
            let _ = app.emit(
                "ffmpeg-download-progress",
                DownloadProgressPayload {
                    stage: "downloading".into(),
                    binary: asset.binary_name.into(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent,
                },
            );
        }
    }

    file.flush().map_err(|e| {
        let _ = fs::remove_file(&part_path);
        format!("Failed to flush {}: {e}", asset.binary_name)
    })?;
    drop(file);

    let _ = app.emit(
        "ffmpeg-download-progress",
        DownloadProgressPayload {
            stage: "verifying".into(),
            binary: asset.binary_name.into(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: Some(99.0),
        },
    );

    let actual_hex = hex::encode(hasher.finalize());
    if let Err(err) = verify_sha256_hex(&actual_hex, asset.sha256) {
        let _ = fs::remove_file(&part_path);
        return Err(format!("{} verification failed: {err}", asset.binary_name));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&part_path, fs::Permissions::from_mode(0o755)).map_err(|e| {
            let _ = fs::remove_file(&part_path);
            format!("Failed to set executable permissions on {}: {e}", asset.binary_name)
        })?;
    }

    // Atomic replacement (on Windows, remove destination first if present)
    if final_path.exists() {
        let _ = fs::remove_file(&final_path);
    }
    fs::rename(&part_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&part_path);
        format!("Failed to finalize {}: {e}", asset.binary_name)
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_manifest_covers_all_desktop_targets_with_valid_sha256() {
        for (os, arch) in [
            ("windows", "x86_64"),
            ("macos", "aarch64"),
            ("macos", "x86_64"),
            ("linux", "x86_64"),
            ("linux", "aarch64"),
        ] {
            let assets = pinned_assets_for(os, arch).expect("target should be supported");
            assert_eq!(assets[0].binary_name, "ffmpeg");
            assert_eq!(assets[1].binary_name, "ffprobe");
            for asset in assets {
                assert!(asset.url.starts_with("https://github.com/"));
                assert_eq!(asset.sha256.len(), 64);
                assert!(asset.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            }
        }
        assert!(pinned_assets_for("solaris", "sparc").is_err());
    }

    #[test]
    fn download_guard_blocks_concurrent_downloads_and_releases_on_drop() {
        let guard = DownloadGuard::new();
        {
            let _lease = guard.try_acquire().expect("first acquire succeeds");
            assert!(guard.try_acquire().is_err());
        }
        assert!(guard.try_acquire().is_ok());
    }

    #[test]
    fn verify_sha256_hex_enforces_exact_match() {
        let digest = "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00";
        assert!(verify_sha256_hex(digest, digest).is_ok());
        assert!(verify_sha256_hex(&digest.to_uppercase(), digest).is_ok());
        assert!(verify_sha256_hex("deadbeef", digest).is_err());
    }
}
