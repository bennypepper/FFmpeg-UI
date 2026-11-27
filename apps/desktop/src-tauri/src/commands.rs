use crate::command_builder::{
    build_convert_plan, validate_existing_file, ConvertRequest,
};
use crate::downloader::{install_verified_ffmpeg_blocking, DownloadGuard};
use crate::jobs::JobRegistry;
use crate::process::{new_command, probe_version_line, resolve_binary};
use crate::progress::{classify_log_level, parse_progress_line};
use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::io::Read;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

/// Returned by `get_capabilities`.
#[derive(Debug, Clone, Serialize)]
pub struct CapabilitiesPayload {
    pub has_ffmpeg: bool,
    pub has_ffprobe: bool,
    pub version: String,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
}

/// Emitted as `log-update` (informational only — NEVER a terminal job signal).
#[derive(Debug, Clone, Serialize)]
pub struct LogPayload {
    pub job_id: String,
    pub level: String,
    pub message: String,
}

/// Emitted as `job-finished` when a conversion terminates (success, failure, or cancellation).
#[derive(Debug, Clone, Serialize)]
pub struct JobFinishedEvent {
    pub job_id: String,
    pub success: bool,
    pub cancelled: bool,
    pub exit_code: Option<i32>,
    pub output_path: String,
    pub error: Option<String>,
}

/// Inspects available FFmpeg and FFprobe binaries using the exact same resolver
/// as `start_convert` and `probe_file` (`<app_data_dir>/bin` first, then `PATH`).
#[tauri::command]
pub async fn get_capabilities(app: AppHandle) -> Result<CapabilitiesPayload, String> {
    tokio::task::spawn_blocking(move || {
        let ffmpeg_bin = resolve_binary(&app, "ffmpeg");
        let (has_ffmpeg, version, ffmpeg_path) = match ffmpeg_bin {
            Some(ref path) => match probe_version_line(path) {
                Some(ver) => (true, ver, Some(path.to_string_lossy().into_owned())),
                None => (false, "Not found".to_string(), None),
            },
            None => (false, "Not found".to_string(), None),
        };

        let ffprobe_bin = resolve_binary(&app, "ffprobe");
        let (has_ffprobe, ffprobe_path) = match ffprobe_bin {
            Some(ref path) if probe_version_line(path).is_some() => {
                (true, Some(path.to_string_lossy().into_owned()))
            }
            _ => (false, None),
        };

        Ok(CapabilitiesPayload {
            has_ffmpeg,
            has_ffprobe,
            version,
            ffmpeg_path,
            ffprobe_path,
        })
    })
    .await
    .map_err(|e| format!("Failed to inspect FFmpeg capabilities: {e}"))?
}

/// Validates a real local file and dynamically grants per-file access on Tauri's
/// `asset://` protocol scope (replacing wildcard `["**"]`).
#[tauri::command]
pub async fn allow_asset_file(app: AppHandle, path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let canonical = validate_existing_file(&path, "path")?;
        app.asset_protocol_scope()
            .allow_file(&canonical)
            .map_err(|e| format!("Failed to grant asset scope for file: {e}"))?;
        Ok(canonical.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("Failed to register asset file: {e}"))?
}

/// Validates a local media file, grants per-file `asset://` preview access, and runs `ffprobe`
/// safely with `-protocol_whitelist file` and `--` delimiter.
#[tauri::command]
pub async fn probe_file(app: AppHandle, path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let canonical = validate_existing_file(&path, "path")?;
        app.asset_protocol_scope()
            .allow_file(&canonical)
            .map_err(|e| format!("Failed to grant asset scope for probed file: {e}"))?;

        let ffprobe_bin = resolve_binary(&app, "ffprobe").ok_or_else(|| {
            "ffprobe binary not found in app data directory or system PATH".to_string()
        })?;

        let canonical_str = canonical.to_string_lossy().into_owned();
        let output = new_command(&ffprobe_bin)
            .args([
                "-v",
                "quiet",
                "-protocol_whitelist",
                "file",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                "--",
                &canonical_str,
            ])
            .output()
            .map_err(|e| format!("ffprobe failed to spawn: {e}"))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                Err(format!(
                    "ffprobe exited with status {}",
                    output.status.code().unwrap_or(-1)
                ))
            } else {
                Err(stderr)
            }
        }
    })
    .await
    .map_err(|e| format!("ffprobe worker task failed: {e}"))?
}

/// Validates `request`, constructs a safe FFmpeg command in Rust, spawns FFmpeg on a blocking
/// thread with `CREATE_NO_WINDOW`, streams live `progress-update` and `log-update` events,
/// always reaps the child process with `wait()`, emits `job-finished`, and returns `Err` on
/// failure or cancellation.
#[tauri::command]
pub async fn start_convert(
    app: AppHandle,
    request: ConvertRequest,
) -> Result<JobFinishedEvent, String> {
    tokio::task::spawn_blocking(move || run_convert_blocking(&app, &request))
        .await
        .map_err(|e| format!("Conversion worker panicked or was aborted: {e}"))?
}

fn run_convert_blocking(
    app: &AppHandle,
    request: &ConvertRequest,
) -> Result<JobFinishedEvent, String> {
    let plan = build_convert_plan(request)?;
    let job_id = request.job_id.clone();
    let output_path_str = plan.output_path.to_string_lossy().into_owned();

    let ffmpeg_bin = resolve_binary(app, "ffmpeg").ok_or_else(|| {
        "FFmpeg binary not found. Download FFmpeg Core or install it on your system PATH."
            .to_string()
    })?;

    let registry = app.state::<JobRegistry>();
    if registry.contains(&job_id) {
        return Err(format!("Job '{job_id}' is already running"));
    }

    let _ = app.emit(
        "log-update",
        LogPayload {
            job_id: job_id.clone(),
            level: "started".into(),
            message: format!(
                "Starting encode: {} -> {}",
                plan.input_path.display(),
                plan.output_path.display()
            ),
        },
    );

    let mut child = new_command(&ffmpeg_bin)
        .args(&plan.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg stderr stream".to_string())?;

    let handles = registry.register(job_id.clone(), child)?;

    // Drain stderr splitting on BOTH `\r` and `\n` so live FFmpeg progress updates flush immediately.
    let mut recent_errors: VecDeque<String> = VecDeque::with_capacity(24);
    drain_ffmpeg_stderr(stderr, app, &job_id, &mut recent_errors);

    // Always remove from registry and reap child with `.wait()` (no zombies).
    let _ = registry.remove(&job_id);
    let maybe_child = handles
        .child
        .lock()
        .map_err(|_| "Child process lock poisoned".to_string())?
        .take();

    let status = match maybe_child {
        Some(mut c) => Some(
            c.wait()
                .map_err(|e| format!("Failed to wait for ffmpeg process: {e}"))?,
        ),
        None => None,
    };

    let was_cancelled = handles.cancelled.load(Ordering::SeqCst);
    let exit_code = status.and_then(|s| s.code());
    let success = !was_cancelled && status.map(|s| s.success()).unwrap_or(false);

    if was_cancelled {
        // Best-effort cleanup of incomplete cancelled output file
        let _ = fs::remove_file(&plan.output_path);
    }

    let error_msg = if success {
        None
    } else if was_cancelled {
        Some("Conversion cancelled by user".to_string())
    } else {
        let tail = recent_errors
            .iter()
            .rev()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        if tail.is_empty() {
            Some(format!(
                "FFmpeg failed with exit code {}",
                exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "unknown".into())
            ))
        } else {
            Some(format!(
                "FFmpeg failed (exit {}): {tail}",
                exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "unknown".into())
            ))
        }
    };

    let finished = JobFinishedEvent {
        job_id: job_id.clone(),
        success,
        cancelled: was_cancelled,
        exit_code,
        output_path: output_path_str.clone(),
        error: error_msg.clone(),
    };

    let _ = app.emit(
        "log-update",
        LogPayload {
            job_id: job_id.clone(),
            level: if success {
                "done".into()
            } else if was_cancelled {
                "warning".into()
            } else {
                "error".into()
            },
            message: if success {
                format!("Encode complete -> {output_path_str}")
            } else if was_cancelled {
                "Encode cancelled by user".into()
            } else {
                error_msg
                    .clone()
                    .unwrap_or_else(|| "Encode failed".to_string())
            },
        },
    );

    let _ = app.emit("job-finished", finished.clone());

    if success {
        Ok(finished)
    } else {
        Err(error_msg.unwrap_or_else(|| "Conversion failed".to_string()))
    }
}

fn drain_ffmpeg_stderr<R: Read>(
    mut reader: R,
    app: &AppHandle,
    job_id: &str,
    recent_lines: &mut VecDeque<String>,
) {
    const MAX_LINE_BYTES: usize = 8192;
    let mut chunk = [0u8; 4096];
    let mut line_buf: Vec<u8> = Vec::with_capacity(512);

    let mut flush_line = |buf: &mut Vec<u8>| {
        if buf.is_empty() {
            return;
        }
        let line = String::from_utf8_lossy(buf).trim().to_string();
        buf.clear();
        if line.is_empty() {
            return;
        }
        if let Some(progress) = parse_progress_line(&line, job_id) {
            let _ = app.emit("progress-update", progress);
        } else {
            let level = classify_log_level(&line);
            if recent_lines.len() >= 20 {
                recent_lines.pop_front();
            }
            recent_lines.push_back(line.clone());
            let _ = app.emit(
                "log-update",
                LogPayload {
                    job_id: job_id.to_string(),
                    level: level.to_string(),
                    message: line,
                },
            );
        }
    };

    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                for &b in &chunk[..n] {
                    if b == b'\r' || b == b'\n' {
                        flush_line(&mut line_buf);
                    } else if line_buf.len() < MAX_LINE_BYTES {
                        line_buf.push(b);
                    }
                }
            }
            Err(_) => break,
        }
    }
    flush_line(&mut line_buf);
}

/// Terminates the active FFmpeg process for `job_id` immediately and marks it cancelled.
/// Returns `true` if an active job with `job_id` was found and terminated.
#[tauri::command]
pub fn cancel_job(registry: State<'_, JobRegistry>, job_id: String) -> Result<bool, String> {
    Ok(registry.cancel(&job_id))
}

/// Downloads and verifies pinned FFmpeg & FFprobe binaries into `<app_data_dir>/bin/`.
/// Protected against concurrent invocations by `DownloadGuard`.
#[tauri::command]
pub async fn download_ffmpeg(
    app: AppHandle,
    guard: State<'_, DownloadGuard>,
) -> Result<String, String> {
    let _lease = guard.try_acquire()?;
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || install_verified_ffmpeg_blocking(&app_clone))
        .await
        .map_err(|e| format!("FFmpeg download task failed: {e}"))?
}
