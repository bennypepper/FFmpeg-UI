use serde::Serialize;

/// Emitted as `progress-update`
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProgressPayload {
    pub job_id: String,
    pub frame: u64,
    pub fps: f32,
    pub speed: f64,
    pub size_kb: u64,
    pub time_s: f64,
    pub bitrate_kbps: f32,
}

/// Parses an FFmpeg timestamp string (`HH:MM:SS.xx`, `MM:SS.xx`, `SS.xx`, or negative values)
/// into non-negative seconds (`>= 0.0`). Returns `0.0` for `N/A` or malformed values.
pub fn parse_time_str(raw: &str) -> f64 {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
        return 0.0;
    }

    // Clamp negative FFmpeg timestamps (e.g. "-00:00:00.04") to 0.0
    if trimmed.starts_with('-') {
        return 0.0;
    }

    let parts: Vec<&str> = trimmed.split(':').collect();
    let secs = match parts.as_slice() {
        [h, m, s] => {
            let h_val: f64 = h.parse().unwrap_or(0.0);
            let m_val: f64 = m.parse().unwrap_or(0.0);
            let s_val: f64 = s.parse().unwrap_or(0.0);
            h_val * 3600.0 + m_val * 60.0 + s_val
        }
        [m, s] => {
            let m_val: f64 = m.parse().unwrap_or(0.0);
            let s_val: f64 = s.parse().unwrap_or(0.0);
            m_val * 60.0 + s_val
        }
        [s] => s.parse().unwrap_or(0.0),
        _ => 0.0,
    };

    if secs.is_finite() && secs > 0.0 {
        secs
    } else {
        0.0
    }
}

/// Extracts the value immediately following `key=` (allowing whitespace after `=`).
fn extract_kv<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let mut search_from = 0;
    while let Some(rel) = line[search_from..].find(key) {
        let pos = search_from + rel;
        let boundary_ok = pos == 0
            || line.as_bytes()[pos - 1].is_ascii_whitespace();
        let after = pos + key.len();
        if boundary_ok && after < line.len() {
            let rest = line[after..].trim_start();
            let val = rest.split_whitespace().next()?;
            return Some(val);
        }
        search_from = pos + 1;
    }
    None
}

fn parse_size_kb(raw: &str) -> u64 {
    let lower = raw.trim().to_ascii_lowercase();
    if lower == "n/a" {
        return 0;
    }
    if let Some(num) = lower.strip_suffix("kib").or_else(|| lower.strip_suffix("kb")) {
        return num.parse::<f64>().unwrap_or(0.0).max(0.0) as u64;
    }
    if let Some(num) = lower.strip_suffix("mib").or_else(|| lower.strip_suffix("mb")) {
        return (num.parse::<f64>().unwrap_or(0.0).max(0.0) * 1024.0) as u64;
    }
    if let Some(num) = lower.strip_suffix('b') {
        return (num.parse::<f64>().unwrap_or(0.0).max(0.0) / 1024.0) as u64;
    }
    lower.parse::<f64>().unwrap_or(0.0).max(0.0) as u64
}

fn parse_bitrate_kbps(raw: &str) -> f32 {
    let lower = raw.trim().to_ascii_lowercase();
    if lower == "n/a" {
        return 0.0;
    }
    let cleaned = lower
        .strip_suffix("kbits/s")
        .or_else(|| lower.strip_suffix("kb/s"))
        .unwrap_or(&lower);
    let val = cleaned.parse::<f32>().unwrap_or(0.0);
    if val.is_finite() && val > 0.0 {
        val
    } else {
        0.0
    }
}

fn parse_speed(raw: &str) -> f64 {
    let trimmed = raw.trim().trim_end_matches('x').trim_end_matches('X');
    if trimmed.eq_ignore_ascii_case("N/A") {
        return 0.0;
    }
    let val = trimmed.parse::<f64>().unwrap_or(0.0);
    if val.is_finite() && val > 0.0 {
        val
    } else {
        0.0
    }
}

/// Parses an FFmpeg stderr progress status line (both video and audio-only formats).
pub fn parse_progress_line(line: &str, job_id: &str) -> Option<ProgressPayload> {
    if !line.contains("time=") {
        return None;
    }
    let has_metric = line.contains("frame=")
        || line.contains("size=")
        || line.contains("Lsize=")
        || line.contains("bitrate=")
        || line.contains("speed=");
    if !has_metric {
        return None;
    }

    let frame = extract_kv(line, "frame=")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let fps = extract_kv(line, "fps=")
        .and_then(|v| v.parse::<f32>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(0.0);
    let size_kb = extract_kv(line, "size=")
        .or_else(|| extract_kv(line, "Lsize="))
        .map(parse_size_kb)
        .unwrap_or(0);
    let time_s = extract_kv(line, "time=")
        .map(parse_time_str)
        .unwrap_or(0.0);
    let bitrate_kbps = extract_kv(line, "bitrate=")
        .map(parse_bitrate_kbps)
        .unwrap_or(0.0);
    let speed = extract_kv(line, "speed=")
        .map(parse_speed)
        .unwrap_or(0.0);

    Some(ProgressPayload {
        job_id: job_id.to_string(),
        frame,
        fps,
        speed,
        size_kb,
        time_s,
        bitrate_kbps,
    })
}

/// Classifies a non-progress FFmpeg stderr line for UI log styling only.
/// NEVER treat `"error"` as a terminal job signal — rely exclusively on `job-finished`.
pub fn classify_log_level(line: &str) -> &'static str {
    let lower = line.to_ascii_lowercase();
    if lower.contains("error")
        || lower.contains("invalid")
        || lower.contains("failed")
        || lower.contains("no such file")
        || lower.contains("conversion failed")
    {
        "error"
    } else if lower.contains("warning") || lower.contains("deprecated") {
        "warning"
    } else {
        "info"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_time_str_handles_normal_fractional_and_negative() {
        assert!((parse_time_str("00:01:30.50") - 90.5).abs() < 1e-6);
        assert!((parse_time_str("01:02:03.25") - 3723.25).abs() < 1e-6);
        assert!((parse_time_str("02:15.5") - 135.5).abs() < 1e-6);
        assert!((parse_time_str("42.75") - 42.75).abs() < 1e-6);
        // Negative FFmpeg timestamps must clamp to 0.0
        assert_eq!(parse_time_str("-00:00:00.04"), 0.0);
        assert_eq!(parse_time_str("-5.12"), 0.0);
        assert_eq!(parse_time_str("N/A"), 0.0);
        assert_eq!(parse_time_str(""), 0.0);
    }

    #[test]
    fn parse_progress_line_parses_video_and_audio_lines() {
        let video_line = "frame=  120 fps= 59.5 q=28.0 size=     512KiB time=00:00:04.00 bitrate=1048.5kbits/s speed=2.00x";
        let p = parse_progress_line(video_line, "job_1").expect("should parse video progress");
        assert_eq!(p.job_id, "job_1");
        assert_eq!(p.frame, 120);
        assert!((p.fps - 59.5).abs() < 1e-3);
        assert_eq!(p.size_kb, 512);
        assert!((p.time_s - 4.0).abs() < 1e-6);
        assert!((p.bitrate_kbps - 1048.5).abs() < 1e-2);
        assert!((p.speed - 2.0).abs() < 1e-6);

        let audio_line = "size=     256kB time=-00:00:00.02 bitrate= 192.0kbits/s speed=14.2x";
        let pa = parse_progress_line(audio_line, "job_2").expect("should parse audio progress");
        assert_eq!(pa.frame, 0);
        assert_eq!(pa.size_kb, 256);
        assert_eq!(pa.time_s, 0.0);
        assert!((pa.bitrate_kbps - 192.0).abs() < 1e-2);
        assert!((pa.speed - 14.2).abs() < 1e-6);

        assert!(parse_progress_line("Input #0, mov,mp4,m4a, from 'clip.mp4':", "job_1").is_none());
    }
}
