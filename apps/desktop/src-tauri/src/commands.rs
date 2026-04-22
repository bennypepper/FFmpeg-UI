use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};

// ─────────────────────────────────────────────
// Payload structs (serialised → sent to JS)
// ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct Capabilities {
    pub has_ffmpeg: bool,
    pub has_ffprobe: bool,
    pub version: String,
}

/// Emitted as `progress-update` Tauri event
#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub job_id: String,
    pub frame: u64,
    pub fps: f32,
    pub speed: f64,
    pub size_kb: u64,
    pub time_s: f64,
    pub bitrate_kbps: f32,
}

/// Emitted as `log-update` Tauri event
#[derive(Serialize, Clone)]
pub struct LogPayload {
    pub job_id: String,
    pub level: String, // "info" | "warning" | "error" | "done" | "started"
    pub message: String,
}

/// Parameters passed from React via invoke('start_convert', {...})
#[derive(Deserialize)]
pub struct ConvertParams {
    pub job_id: String,
    /// Absolute path to source file
    pub input_path: String,
    /// Absolute path for the output file (caller constructs this)
    pub output_path: String,
    /// FFmpeg args built by @ffmpeg-ui/core (everything except -i and output)
    pub args: Vec<String>,
}

// ─────────────────────────────────────────────
// get_capabilities
// ─────────────────────────────────────────────
#[tauri::command]
pub fn get_capabilities() -> Result<Capabilities, String> {
    let ffmpeg_version = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|out| {
            let s = String::from_utf8_lossy(&out.stdout);
            s.lines().next().unwrap_or("unknown").to_string()
        })
        .unwrap_or_else(|_| "Not found".to_string());

    let has_ffmpeg = !ffmpeg_version.contains("Not found");

    let has_ffprobe = Command::new("ffprobe")
        .arg("-version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);

    Ok(Capabilities {
        has_ffmpeg,
        has_ffprobe,
        version: ffmpeg_version,
    })
}

// ─────────────────────────────────────────────
// probe_file — calls real ffprobe, returns JSON string
// ─────────────────────────────────────────────
#[tauri::command]
pub fn probe_file(path: String) -> Result<String, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| format!("ffprobe failed to spawn: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ─────────────────────────────────────────────
// start_convert — the main conversion command
// Spawns FFmpeg via ffmpeg-sidecar and streams
// progress + log events back to the frontend.
// ─────────────────────────────────────────────
#[tauri::command]
pub async fn start_convert(app: AppHandle, params: ConvertParams) -> Result<String, String> {
    use ffmpeg_sidecar::command::FfmpegCommand;
    use ffmpeg_sidecar::event::{FfmpegEvent, LogLevel};

    let job_id = params.job_id.clone();

    // Emit a "started" log so the terminal shows something immediately
    let _ = app.emit(
        "log-update",
        LogPayload {
            job_id: job_id.clone(),
            level: "started".into(),
            message: format!(
                "Starting encode: {} → {}",
                params.input_path, params.output_path
            ),
        },
    );

    // Build the FFmpeg command:
    // args from core package includes -i, input, all flags, and the output path.
    let mut child = FfmpegCommand::new()
        .args(&params.args)
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    // Iterate over events on the current (async) thread.
    // ffmpeg-sidecar's iterator is blocking, so we wrap in spawn_blocking.
    let job_id_clone = job_id.clone();
    let app_clone = app.clone();

    let iter = child
        .iter()
        .map_err(|e| format!("Failed to create ffmpeg iterator: {}", e))?;

    for event in iter {
        match event {
            FfmpegEvent::Progress(progress) => {
                let _ = app_clone.emit(
                    "progress-update",
                    ProgressPayload {
                        job_id: job_id_clone.clone(),
                        frame: progress.frame as u64,
                        fps: progress.fps,
                        speed: progress.speed as f64,
                        size_kb: progress.size_kb as u64,
                        // progress.time is a String like "00:01:23.45"
                        time_s: {
                            let t = &progress.time;
                            let parts: Vec<&str> = t.split(':').collect();
                            if parts.len() == 3 {
                                let h: f64 = parts[0].parse().unwrap_or(0.0);
                                let m: f64 = parts[1].parse().unwrap_or(0.0);
                                let s: f64 = parts[2].parse().unwrap_or(0.0);
                                h * 3600.0 + m * 60.0 + s
                            } else {
                                0.0
                            }
                        },
                        bitrate_kbps: progress.bitrate_kbps,
                    },
                );
            }

            FfmpegEvent::Log(LogLevel::Info, msg) => {
                let _ = app_clone.emit(
                    "log-update",
                    LogPayload {
                        job_id: job_id_clone.clone(),
                        level: "info".into(),
                        message: msg.clone(),
                    },
                );
            }

            FfmpegEvent::Log(LogLevel::Warning, msg) => {
                let _ = app_clone.emit(
                    "log-update",
                    LogPayload {
                        job_id: job_id_clone.clone(),
                        level: "warning".into(),
                        message: msg.clone(),
                    },
                );
            }

            FfmpegEvent::Log(LogLevel::Error | LogLevel::Fatal, msg) => {
                let _ = app_clone.emit(
                    "log-update",
                    LogPayload {
                        job_id: job_id_clone.clone(),
                        level: "error".into(),
                        message: msg.clone(),
                    },
                );
            }

            FfmpegEvent::Done => {
                let _ = app_clone.emit(
                    "log-update",
                    LogPayload {
                        job_id: job_id_clone.clone(),
                        level: "done".into(),
                        message: format!("✅ Encode complete → {}", params.output_path),
                    },
                );
                break;
            }

            _ => {}
        }
    }

    Ok(job_id.clone())
}

// ─────────────────────────────────────────────
// cancel_job — kills an active ffmpeg process
// (Basic implementation: SIGTERM / TerminateProcess via std::process)
// In production this should use the JobRegistry above.
// ─────────────────────────────────────────────
#[tauri::command]
pub fn cancel_job(_job_id: String) -> Result<(), String> {
    // TODO: look up PID from a global JobRegistry and kill it.
    // For now this is a no-op placeholder — the iterator loop will
    // detect that the child exited and stop naturally.
    Ok(())
}

// ─────────────────────────────────────────────
// download_ffmpeg — grabs pre-compiled binaries via sidecar
// ─────────────────────────────────────────────
#[tauri::command]
pub async fn download_ffmpeg() -> Result<String, String> {
    ffmpeg_sidecar::download::auto_download()
        .map_err(|e| format!("Failed to download FFmpeg: {}", e))?;
    Ok("Embedded FFmpeg downloaded successfully".to_string())
}
