use serde::Serialize;
use tauri::ipc::InvokeError;
use std::process::Command;

#[derive(Serialize)]
pub struct Capabilities {
    pub has_ffmpeg: bool,
    pub has_ffprobe: bool,
    pub version: String,
}

#[tauri::command]
pub fn get_capabilities() -> Result<Capabilities, InvokeError> {
    let version = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|out| {
            let s = String::from_utf8_lossy(&out.stdout);
            s.lines().next().unwrap_or("unknown").to_string()
        })
        .unwrap_or_else(|_| "Not found".to_string());

    Ok(Capabilities {
        has_ffmpeg: !version.contains("Not found"),
        has_ffprobe: true, // Assuming we'll bundle it
        version,
    })
}

#[tauri::command]
pub fn probe_file(path: String) -> Result<String, String> {
    Ok(format!("{{\"format\": {{\"filename\": \"{}\", \"duration\": \"10.0\"}}}}", path))
}
