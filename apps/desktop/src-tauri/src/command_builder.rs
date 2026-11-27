use crate::process::normalize_fs_path;
use serde::{Deserialize, Deserializer, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Custom deserializer allowing JSON strings or numbers (e.g. `"23"` or `23`) for numeric-string fields.
fn de_opt_string_or_num<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrNum {
        Str(String),
        Int(i64),
        UInt(u64),
        Float(f64),
    }

    let opt = Option::<StringOrNum>::deserialize(deserializer)?;
    Ok(opt.map(|v| match v {
        StringOrNum::Str(s) => s,
        StringOrNum::Int(i) => i.to_string(),
        StringOrNum::UInt(u) => u.to_string(),
        StringOrNum::Float(f) => f.to_string(),
    }))
}

/// Custom deserializer allowing JSON numbers or numeric strings (e.g. `0.5`, `"0.5"`, `""`, `null`).
fn de_opt_f64_or_string<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum FloatOrStr {
        Float(f64),
        Int(i64),
        UInt(u64),
        Str(String),
    }

    let opt = Option::<FloatOrStr>::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(FloatOrStr::Float(f)) => Ok(Some(f)),
        Some(FloatOrStr::Int(i)) => Ok(Some(i as f64)),
        Some(FloatOrStr::UInt(u)) => Ok(Some(u as f64)),
        Some(FloatOrStr::Str(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                trimmed
                    .parse::<f64>()
                    .map(Some)
                    .map_err(serde::de::Error::custom)
            }
        }
    }
}

/// Typed FFmpeg encoding options matching `@ffmpeg-ui/core`'s `CommandOptions`.
/// Arbitrary `custom` CLI flags are explicitly rejected to prevent command injection.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeOptions {
    pub mode: Option<String>,
    pub fmt: Option<String>,
    pub vc: Option<String>,
    #[serde(alias = "hwaccel")]
    pub hw: Option<String>,
    pub rc: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub crf: Option<String>,
    pub vbr: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub tsz: Option<String>,
    #[serde(default, deserialize_with = "de_opt_f64_or_string")]
    pub duration_sec: Option<f64>,
    pub preset: Option<String>,
    pub tune: Option<String>,
    pub res: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub fps: Option<String>,
    pub pix_fmt: Option<String>,
    pub aspect: Option<String>,
    pub ac: Option<String>,
    pub ab: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub sr: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub ch: Option<String>,
    #[serde(default, deserialize_with = "de_opt_f64_or_string")]
    pub vol: Option<f64>,
    pub norm: Option<bool>,
    pub no_audio: Option<bool>,
    #[serde(default, deserialize_with = "de_opt_f64_or_string")]
    pub speed: Option<f64>,
    #[serde(alias = "rotate")]
    pub rot: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub crop_w: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub crop_h: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub crop_x: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub crop_y: Option<String>,
    pub deint: Option<bool>,
    pub gray: Option<bool>,
    #[serde(alias = "den")]
    pub denoise: Option<bool>,
    pub sharp: Option<bool>,
    #[serde(rename = "ts_start", alias = "tsStart")]
    pub ts_start: Option<String>,
    #[serde(rename = "ts_end", alias = "tsEnd")]
    pub ts_end: Option<String>,
    #[serde(alias = "webOpt")]
    pub faststart: Option<bool>,
    pub no_meta: Option<bool>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub threads: Option<String>,
    pub th_time: Option<String>,
    pub th_fmt: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_num")]
    pub th_q: Option<String>,
    #[serde(alias = "gFps", default, deserialize_with = "de_opt_string_or_num")]
    pub gif_fps: Option<String>,
    #[serde(alias = "gW", default, deserialize_with = "de_opt_string_or_num")]
    pub gif_w: Option<String>,
    #[serde(alias = "gLoop", default, deserialize_with = "de_opt_string_or_num")]
    pub gif_loop: Option<String>,
    pub has_wm: Option<bool>,
    pub wm_path: Option<String>,
    pub wm_pos: Option<String>,
    #[serde(default, deserialize_with = "de_opt_f64_or_string")]
    pub wm_opa: Option<f64>,
    pub has_sub: Option<bool>,
    pub sub_mode: Option<String>,
    pub sub_path: Option<String>,
    /// Rejected if non-empty to prevent raw CLI argument injection.
    pub custom: Option<String>,
}

/// Request payload passed to `start_convert`.
#[derive(Debug, Clone, Deserialize)]
pub struct ConvertRequest {
    pub job_id: String,
    pub input_path: String,
    pub output_dir: String,
    #[serde(default)]
    pub options: EncodeOptions,
}

/// Validated FFmpeg execution plan produced by `build_convert_plan`.
#[derive(Debug, Clone)]
pub struct ConvertPlan {
    pub args: Vec<String>,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
}

fn non_empty(opt: &Option<String>) -> Option<&str> {
    opt.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// Validates a `job_id` string (`[A-Za-z0-9_-]`, 1..=128 chars).
pub fn validate_job_id(job_id: &str) -> Result<(), String> {
    if job_id.is_empty() || job_id.len() > 128 {
        return Err("job_id must be between 1 and 128 characters".into());
    }
    if !job_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("job_id contains invalid characters".into());
    }
    Ok(())
}

/// Validates that a path exists on disk and is a regular file, returning a normalized canonical path.
pub fn validate_existing_file(raw: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    if trimmed.contains('\0') {
        return Err(format!("{label} contains invalid null byte"));
    }
    let meta = fs::metadata(trimmed)
        .map_err(|e| format!("{label} does not exist or is inaccessible: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{label} must be a regular file"));
    }
    let canonical = fs::canonicalize(trimmed)
        .map_err(|e| format!("Failed to canonicalize {label}: {e}"))?;
    Ok(normalize_fs_path(&canonical))
}

/// Validates that `output_dir` exists and is a directory, returning a normalized canonical path.
pub fn validate_existing_dir(raw: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    if trimmed.contains('\0') {
        return Err(format!("{label} contains invalid null byte"));
    }
    let meta = fs::metadata(trimmed)
        .map_err(|e| format!("{label} does not exist or is inaccessible: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("{label} must be a directory"));
    }
    let canonical = fs::canonicalize(trimmed)
        .map_err(|e| format!("Failed to canonicalize {label}: {e}"))?;
    Ok(normalize_fs_path(&canonical))
}

/// Sanitizes a file stem into a safe cross-platform filename component.
pub fn sanitize_stem(input_path: &Path) -> String {
    let raw = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == ' ');
    let limited: String = trimmed.chars().take(120).collect();
    if limited.is_empty() {
        "output".to_string()
    } else {
        limited
    }
}

/// Resolves a collision-free output path inside `output_dir`:
/// `name_converted.<ext>`, `name_converted (1).<ext>`, `name_converted (2).<ext>`, etc.
/// Guarantees we NEVER overwrite the input file in-place or clobber batch siblings.
pub fn resolve_output_path(
    output_dir: &Path,
    canonical_input: &Path,
    ext: &str,
) -> Result<PathBuf, String> {
    let stem = sanitize_stem(canonical_input);
    for idx in 0..=1000u32 {
        let filename = if idx == 0 {
            format!("{stem}_converted.{ext}")
        } else {
            format!("{stem}_converted ({idx}).{ext}")
        };
        let candidate = output_dir.join(&filename);
        if !candidate.exists() && candidate != canonical_input {
            return Ok(candidate);
        }
    }
    Err("Could not allocate a unique output filename after 1000 attempts".into())
}

/// Parses a validated FFmpeg timestamp (`HH:MM:SS(.mmm)`, `MM:SS(.mmm)`, or `SS(.mmm)`) to seconds.
pub fn parse_validated_timestamp(raw: &str, field: &str) -> Result<f64, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} cannot be empty"));
    }
    if trimmed.starts_with('-') || trimmed.starts_with('+') {
        return Err(format!("{field} must be a non-negative timestamp"));
    }

    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.is_empty() || parts.len() > 3 {
        return Err(format!("Invalid timestamp format for {field}: '{trimmed}'"));
    }

    let secs = match parts.as_slice() {
        [s] => parse_seconds_part(s, field)?,
        [m, s] => {
            let m_val = parse_uint_part(m, field)? as f64;
            let s_val = parse_seconds_part(s, field)?;
            if s_val >= 60.0 {
                return Err(format!("{field} seconds component must be < 60"));
            }
            m_val * 60.0 + s_val
        }
        [h, m, s] => {
            let h_val = parse_uint_part(h, field)? as f64;
            let m_val = parse_uint_part(m, field)? as f64;
            let s_val = parse_seconds_part(s, field)?;
            if m_val >= 60.0 || s_val >= 60.0 {
                return Err(format!("{field} minutes/seconds components must be < 60"));
            }
            h_val * 3600.0 + m_val * 60.0 + s_val
        }
        _ => unreachable!(),
    };

    if !secs.is_finite() || !(0.0..=86_400.0 * 7.0).contains(&secs) {
        return Err(format!("{field} is out of valid bounds"));
    }
    Ok(secs)
}

fn parse_uint_part(s: &str, field: &str) -> Result<u64, String> {
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Invalid timestamp digits in {field}: '{s}'"));
    }
    s.parse::<u64>()
        .map_err(|_| format!("Invalid timestamp integer in {field}: '{s}'"))
}

fn parse_seconds_part(s: &str, field: &str) -> Result<f64, String> {
    let segs: Vec<&str> = s.split('.').collect();
    if segs.len() > 2 || segs[0].is_empty() || !segs[0].chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Invalid timestamp seconds in {field}: '{s}'"));
    }
    if segs.len() == 2 && (segs[1].is_empty() || !segs[1].chars().all(|c| c.is_ascii_digit())) {
        return Err(format!("Invalid timestamp fractional seconds in {field}: '{s}'"));
    }
    s.parse::<f64>()
        .map_err(|_| format!("Invalid timestamp value in {field}: '{s}'"))
}

fn format_seconds(secs: f64) -> String {
    let rounded = (secs * 1000.0).round() / 1000.0;
    let formatted = format!("{rounded:.3}");
    formatted
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

/// Builds a chain of `atempo` filters where every stage stays within FFmpeg's `[0.5, 2.0]` range.
pub fn build_atempo_filters(speed: f64) -> Result<Vec<String>, String> {
    if !speed.is_finite() || !(0.25..=4.0).contains(&speed) {
        return Err(format!("speed must be between 0.25 and 4.0 (got {speed})"));
    }
    if (speed - 1.0).abs() < 1e-6 {
        return Ok(Vec::new());
    }

    let mut filters = Vec::new();
    let mut rem = speed;
    while rem < 0.5 - 1e-6 {
        filters.push("atempo=0.5".to_string());
        rem /= 0.5;
    }
    while rem > 2.0 + 1e-6 {
        filters.push("atempo=2.0".to_string());
        rem /= 2.0;
    }
    let val = format!("{rem:.4}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
    let final_val = if !val.contains('.') {
        format!("{val}.0")
    } else {
        val
    };
    filters.push(format!("atempo={final_val}"));
    Ok(filters)
}

/// Escapes a local subtitle file path safely for FFmpeg's `subtitles='...'` libass filter,
/// including Windows drive letters (`C:\foo\bar.srt` -> `C\:/foo/bar.srt`) and single quotes.
pub fn escape_subtitle_path(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let mut out = String::with_capacity(raw.len() + 8);
    for ch in raw.chars() {
        match ch {
            ':' => out.push_str(r"\:"),
            '\'' => out.push_str(r"'\\\''"),
            '[' => out.push_str(r"\["),
            ']' => out.push_str(r"\]"),
            ',' => out.push_str(r"\,"),
            ';' => out.push_str(r"\;"),
            _ => out.push(ch),
        }
    }
    out
}

fn default_video_codec_for_fmt(fmt: &str) -> &'static str {
    match fmt {
        "webm" => "libvpx-vp9",
        _ => "libx264",
    }
}

fn default_audio_codec_for_fmt(fmt: &str) -> &'static str {
    match fmt {
        "mp3" => "libmp3lame",
        "webm" | "ogg" | "opus" => "libopus",
        "wav" => "pcm_s16le",
        "flac" => "flac",
        _ => "aac",
    }
}

fn normalize_audio_codec(raw: &str) -> Result<&'static str, String> {
    match raw.to_ascii_lowercase().as_str() {
        "aac" => Ok("aac"),
        "mp3" | "libmp3lame" => Ok("libmp3lame"),
        "opus" | "libopus" => Ok("libopus"),
        "flac" => Ok("flac"),
        "wav" | "pcm" | "pcm_s16le" => Ok("pcm_s16le"),
        "copy" => Ok("copy"),
        other => Err(format!("Unsupported audio codec: '{other}'")),
    }
}

fn validate_video_codec(raw: &str) -> Result<&'static str, String> {
    match raw.to_ascii_lowercase().as_str() {
        "libx264" => Ok("libx264"),
        "libx265" => Ok("libx265"),
        "libvpx-vp9" => Ok("libvpx-vp9"),
        "libaom-av1" => Ok("libaom-av1"),
        "prores_ks" => Ok("prores_ks"),
        "copy" => Ok("copy"),
        other => Err(format!("Unsupported video codec: '{other}'")),
    }
}

fn validate_container_video_codec(fmt: &str, vc: &str) -> Result<(), String> {
    let allowed: &[&str] = match fmt {
        "mp4" => &["libx264", "libx265", "libaom-av1", "copy"],
        "mkv" => &[
            "libx264",
            "libx265",
            "libvpx-vp9",
            "libaom-av1",
            "prores_ks",
            "copy",
        ],
        "webm" => &["libvpx-vp9", "libaom-av1", "copy"],
        "mov" => &["libx264", "libx265", "prores_ks", "copy"],
        "avi" => &["libx264", "copy"],
        _ => return Err(format!("Unsupported video container format: '{fmt}'")),
    };
    if !allowed.contains(&vc) {
        return Err(format!(
            "Video codec '{vc}' is incompatible with container '{fmt}'"
        ));
    }
    Ok(())
}

fn validate_container_audio_codec(fmt: &str, ac: &str) -> Result<(), String> {
    let allowed: &[&str] = match fmt {
        "mp4" => &["aac", "libmp3lame", "libopus", "copy"],
        "mkv" => &["aac", "libmp3lame", "libopus", "flac", "pcm_s16le", "copy"],
        "webm" => &["libopus", "copy"],
        "mov" => &["aac", "libmp3lame", "pcm_s16le", "copy"],
        "avi" => &["libmp3lame", "pcm_s16le", "aac", "copy"],
        "mp3" => &["libmp3lame", "copy"],
        "m4a" | "aac" => &["aac", "copy"],
        "ogg" => &["libopus", "flac", "copy"],
        "opus" => &["libopus", "copy"],
        "wav" => &["pcm_s16le", "copy"],
        "flac" => &["flac", "copy"],
        _ => return Err(format!("Unsupported container format for audio: '{fmt}'")),
    };
    if !allowed.contains(&ac) {
        return Err(format!(
            "Audio codec '{ac}' is incompatible with container '{fmt}'"
        ));
    }
    Ok(())
}

fn validate_bitrate(raw: &str, field: &str, min_kbps: u64, max_kbps: u64) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} cannot be empty"));
    }
    let last = trimmed.chars().last().unwrap();
    let (digits, unit, mult) = match last {
        'k' | 'K' => (&trimmed[..trimmed.len() - 1], "k", 1u64),
        'm' | 'M' => (&trimmed[..trimmed.len() - 1], "M", 1000u64),
        c if c.is_ascii_digit() => (trimmed, "k", 1u64),
        _ => return Err(format!("Invalid bitrate '{trimmed}' for {field}")),
    };
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Invalid bitrate '{trimmed}' for {field}"));
    }
    let val: u64 = digits
        .parse()
        .map_err(|_| format!("Invalid bitrate '{trimmed}' for {field}"))?;
    let kbps = val.saturating_mul(mult);
    if kbps < min_kbps || kbps > max_kbps {
        return Err(format!(
            "{field} must be between {min_kbps}k and {max_kbps}k (got '{trimmed}')"
        ));
    }
    Ok(format!("{val}{unit}"))
}

fn validate_resolution(raw: &str) -> Result<Option<String>, String> {
    match raw {
        "" | "original" => Ok(None),
        "4k" => Ok(Some("3840:-2".into())),
        "1080p" => Ok(Some("1920:-2".into())),
        "720p" => Ok(Some("1280:-2".into())),
        "480p" => Ok(Some("854:-2".into())),
        "360p" => Ok(Some("640:-2".into())),
        other => {
            let parts: Vec<&str> = other.split(':').collect();
            if parts.len() != 2 {
                return Err(format!("Invalid resolution '{other}'"));
            }
            let w: i32 = parts[0]
                .parse()
                .map_err(|_| format!("Invalid resolution width in '{other}'"))?;
            let h: i32 = parts[1]
                .parse()
                .map_err(|_| format!("Invalid resolution height in '{other}'"))?;
            let w_ok = w == -2 || w == -1 || (16..=7680).contains(&w);
            let h_ok = h == -2 || h == -1 || (16..=4320).contains(&h);
            if !w_ok || !h_ok || (w < 0 && h < 0) {
                return Err(format!("Resolution dimensions out of bounds: '{other}'"));
            }
            Ok(Some(format!("{w}:{h}")))
        }
    }
}

fn validate_fps(raw: &str) -> Result<Option<String>, String> {
    if raw.is_empty() || raw == "original" {
        return Ok(None);
    }
    let val: f64 = raw
        .parse()
        .map_err(|_| format!("Invalid frame rate: '{raw}'"))?;
    if !val.is_finite() || !(1.0..=240.0).contains(&val) {
        return Err(format!("Frame rate must be between 1 and 240 (got '{raw}')"));
    }
    Ok(Some(raw.to_string()))
}

fn validate_threads(raw: &str) -> Result<Option<String>, String> {
    if raw.is_empty() || raw == "auto" {
        return Ok(None);
    }
    let val: u32 = raw
        .parse()
        .map_err(|_| format!("Invalid threads value: '{raw}'"))?;
    if !(1..=64).contains(&val) {
        return Err(format!("threads must be between 1 and 64 (got {val})"));
    }
    Ok(Some(val.to_string()))
}

fn validate_trim(
    ts_start: &Option<String>,
    ts_end: &Option<String>,
) -> Result<(Option<f64>, Option<f64>), String> {
    let start_s = match non_empty(ts_start) {
        Some(s) if s != "00:00:00" && s != "0" && s != "00:00" => {
            Some(parse_validated_timestamp(s, "ts_start")?)
        }
        Some(s) => {
            // Still validate syntax even if zero
            let _ = parse_validated_timestamp(s, "ts_start")?;
            None
        }
        None => None,
    };

    let end_s = match non_empty(ts_end) {
        Some(s) if s != "00:00:00" && s != "0" && s != "00:00" => {
            Some(parse_validated_timestamp(s, "ts_end")?)
        }
        Some(s) => {
            let _ = parse_validated_timestamp(s, "ts_end")?;
            None
        }
        None => None,
    };

    let duration_s = match (start_s, end_s) {
        (Some(st), Some(en)) => {
            if en <= st {
                return Err("ts_end must be greater than ts_start".into());
            }
            Some(en - st)
        }
        (None, Some(en)) => Some(en),
        _ => None,
    };

    Ok((start_s, duration_s))
}

fn build_audio_filters(opts: &EncodeOptions) -> Result<Vec<String>, String> {
    let mut af = Vec::new();

    // Volume: explicitly honor vol == 0.0 (mute)! Only skip when None or ~1.0.
    if let Some(vol) = opts.vol {
        if !vol.is_finite() || !(0.0..=5.0).contains(&vol) {
            return Err(format!("vol must be between 0.0 and 5.0 (got {vol})"));
        }
        if (vol - 1.0).abs() >= 1e-6 {
            af.push(format!("volume={vol:.2}"));
        }
    }

    if opts.norm.unwrap_or(false) {
        af.push("loudnorm".to_string());
    }

    if let Some(speed) = opts.speed {
        let chain = build_atempo_filters(speed)?;
        af.extend(chain);
    }

    Ok(af)
}

struct ValidatedAudioParams {
    ab: Option<String>,
    sr: Option<u32>,
    ch: Option<u32>,
}

fn validate_audio_params(
    ac: &str,
    opts: &EncodeOptions,
) -> Result<ValidatedAudioParams, String> {
    let ab = match non_empty(&opts.ab) {
        Some(raw) if ac != "copy" && ac != "flac" && ac != "pcm_s16le" => {
            Some(validate_bitrate(raw, "ab", 32, 1024)?)
        }
        Some(raw) => {
            // Still validate syntax even if lossless/copy ignores it
            let _ = validate_bitrate(raw, "ab", 32, 1024)?;
            None
        }
        None => None,
    };

    let sr = match non_empty(&opts.sr) {
        Some(raw) => {
            let val: u32 = raw
                .parse()
                .map_err(|_| format!("Invalid sample rate: '{raw}'"))?;
            if !matches!(
                val,
                8000 | 11025 | 12000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000 | 64000 | 88200 | 96000
            ) {
                return Err(format!("Unsupported sample rate: {val}"));
            }
            if ac == "libmp3lame" && val > 48000 {
                return Err("MP3 (libmp3lame) does not support sample rates above 48000 Hz".into());
            }
            if ac == "libopus" && !matches!(val, 8000 | 12000 | 16000 | 24000 | 48000) {
                return Err(
                    "Opus (libopus) only supports 8000, 12000, 16000, 24000, or 48000 Hz".into(),
                );
            }
            Some(val)
        }
        None => None,
    };

    let ch = match non_empty(&opts.ch) {
        Some(raw) => {
            let val: u32 = raw
                .parse()
                .map_err(|_| format!("Invalid audio channel count: '{raw}'"))?;
            if !matches!(val, 1 | 2 | 6 | 8) {
                return Err(format!("Unsupported audio channel count: {val}"));
            }
            if ac == "libmp3lame" && val > 2 {
                return Err("MP3 (libmp3lame) supports at most 2 channels (Mono/Stereo)".into());
            }
            if ac == "aac" && val > 6 {
                return Err("AAC supports at most 6 channels (5.1)".into());
            }
            Some(val)
        }
        None => None,
    };

    Ok(ValidatedAudioParams { ab, sr, ch })
}

/// Validates a `ConvertRequest` and builds a safe, strictly validated FFmpeg argument array.
pub fn build_convert_plan(req: &ConvertRequest) -> Result<ConvertPlan, String> {
    validate_job_id(&req.job_id)?;

    let opts = &req.options;

    // Security: explicitly reject arbitrary raw CLI arguments
    if let Some(custom) = non_empty(&opts.custom) {
        return Err(format!(
            "Arbitrary custom FFmpeg arguments ('{custom}') are disabled for security"
        ));
    }

    let input_path = validate_existing_file(&req.input_path, "input_path")?;
    let output_dir = validate_existing_dir(&req.output_dir, "output_dir")?;

    let raw_mode = non_empty(&opts.mode)
        .unwrap_or("convert")
        .to_ascii_lowercase();
    let raw_fmt = non_empty(&opts.fmt).map(str::to_ascii_lowercase);

    // Effective mode: route `convert` + `fmt == "gif"` into GIF palettegen pipeline
    let mode = match raw_mode.as_str() {
        "convert" if raw_fmt.as_deref() == Some("gif") => "gif",
        "convert" | "audio" | "remux" | "thumbnail" | "gif" => raw_mode.as_str(),
        "merge" => {
            return Err("Merge mode is not supported by single-file start_convert".into());
        }
        other => return Err(format!("Unsupported processing mode: '{other}'")),
    };

    let input_str = input_path.to_string_lossy().into_owned();

    match mode {
        "thumbnail" => build_thumbnail_plan(&input_path, &input_str, &output_dir, opts),
        "gif" => build_gif_plan(&input_path, &input_str, &output_dir, opts),
        "audio" => build_audio_plan(&input_path, &input_str, &output_dir, opts),
        "remux" => build_remux_plan(&input_path, &input_str, &output_dir, opts),
        "convert" => build_video_convert_plan(&input_path, &input_str, &output_dir, opts),
        _ => unreachable!(),
    }
}

fn build_thumbnail_plan(
    input_path: &Path,
    input_str: &str,
    output_dir: &Path,
    opts: &EncodeOptions,
) -> Result<ConvertPlan, String> {
    let th_fmt = non_empty(&opts.th_fmt)
        .unwrap_or("jpg")
        .to_ascii_lowercase();
    if !matches!(th_fmt.as_str(), "jpg" | "png" | "webp") {
        return Err(format!("Unsupported thumbnail format: '{th_fmt}'"));
    }

    let default_seek = match opts.duration_sec {
        Some(d) if d.is_finite() && (0.0..1.5).contains(&d) => 0.0,
        _ => 1.0,
    };
    let seek_s = match non_empty(&opts.th_time) {
        Some(raw) => parse_validated_timestamp(raw, "thTime")?,
        None => default_seek,
    };

    let th_q = match non_empty(&opts.th_q) {
        Some(raw) => {
            let val: u32 = raw
                .parse()
                .map_err(|_| format!("Invalid thumbnail quality: '{raw}'"))?;
            if !(1..=31).contains(&val) {
                return Err(format!("thQ must be between 1 and 31 (got {val})"));
            }
            Some(val)
        }
        None => None,
    };

    let threads = match non_empty(&opts.threads) {
        Some(raw) => validate_threads(raw)?,
        None => None,
    };

    let output_path = resolve_output_path(output_dir, input_path, &th_fmt)?;
    let mut args = vec![
        "-y".to_string(),
        "-protocol_whitelist".to_string(),
        "file".to_string(),
        "-ss".to_string(),
        format_seconds(seek_s),
        "-i".to_string(),
        input_str.to_string(),
        "-frames:v".to_string(),
        "1".to_string(),
    ];

    if let Some(q) = th_q {
        if th_fmt == "jpg" {
            args.push("-q:v".to_string());
            args.push(q.to_string());
        }
    }
    if let Some(th) = threads {
        args.push("-threads".to_string());
        args.push(th);
    }
    if opts.no_meta.unwrap_or(false) {
        args.push("-map_metadata".to_string());
        args.push("-1".to_string());
    }

    args.push(output_path.to_string_lossy().into_owned());
    Ok(ConvertPlan {
        args,
        input_path: input_path.to_path_buf(),
        output_path,
    })
}

fn build_gif_plan(
    input_path: &Path,
    input_str: &str,
    output_dir: &Path,
    opts: &EncodeOptions,
) -> Result<ConvertPlan, String> {
    let gif_fps: u32 = match non_empty(&opts.gif_fps) {
        Some(raw) => {
            let v: u32 = raw
                .parse()
                .map_err(|_| format!("Invalid gifFps: '{raw}'"))?;
            if !(1..=60).contains(&v) {
                return Err(format!("gifFps must be between 1 and 60 (got {v})"));
            }
            v
        }
        None => 15,
    };

    let gif_w: i32 = match non_empty(&opts.gif_w) {
        Some(raw) => {
            let v: i32 = raw
                .parse()
                .map_err(|_| format!("Invalid gifW: '{raw}'"))?;
            if v != -1 && !(16..=4096).contains(&v) {
                return Err(format!("gifW must be -1 or between 16 and 4096 (got {v})"));
            }
            v
        }
        None => 480,
    };

    let gif_loop: i32 = match non_empty(&opts.gif_loop) {
        Some(raw) => {
            let v: i32 = raw
                .parse()
                .map_err(|_| format!("Invalid gifLoop: '{raw}'"))?;
            if !(-1..=100).contains(&v) {
                return Err(format!("gifLoop must be between -1 and 100 (got {v})"));
            }
            v
        }
        None => 0,
    };

    let (start_s, duration_s) = validate_trim(&opts.ts_start, &opts.ts_end)?;
    let threads = match non_empty(&opts.threads) {
        Some(raw) => validate_threads(raw)?,
        None => None,
    };

    let output_path = resolve_output_path(output_dir, input_path, "gif")?;
    let mut args = vec!["-y".to_string()];

    if let Some(st) = start_s {
        args.push("-ss".to_string());
        args.push(format_seconds(st));
    }

    args.push("-protocol_whitelist".to_string());
    args.push("file".to_string());
    args.push("-i".to_string());
    args.push(input_str.to_string());

    if let Some(dur) = duration_s {
        args.push("-t".to_string());
        args.push(format_seconds(dur));
    }

    let filter = format!(
        "fps={gif_fps},scale={gif_w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5"
    );
    args.push("-vf".to_string());
    args.push(filter);
    args.push("-an".to_string());
    args.push("-loop".to_string());
    args.push(gif_loop.to_string());

    if let Some(th) = threads {
        args.push("-threads".to_string());
        args.push(th);
    }

    if opts.no_meta.unwrap_or(false) {
        args.push("-map_metadata".to_string());
        args.push("-1".to_string());
    }

    args.push(output_path.to_string_lossy().into_owned());
    Ok(ConvertPlan {
        args,
        input_path: input_path.to_path_buf(),
        output_path,
    })
}

fn build_audio_plan(
    input_path: &Path,
    input_str: &str,
    output_dir: &Path,
    opts: &EncodeOptions,
) -> Result<ConvertPlan, String> {
    let fmt = non_empty(&opts.fmt)
        .unwrap_or("mp3")
        .to_ascii_lowercase();
    if !matches!(fmt.as_str(), "mp3" | "m4a" | "ogg" | "wav" | "flac" | "aac" | "opus") {
        return Err(format!("Unsupported audio output format: '{fmt}'"));
    }

    let ac = match non_empty(&opts.ac) {
        Some(raw) => normalize_audio_codec(raw)?,
        None => default_audio_codec_for_fmt(&fmt),
    };
    validate_container_audio_codec(&fmt, ac)?;

    let (start_s, duration_s) = validate_trim(&opts.ts_start, &opts.ts_end)?;
    let audio_params = validate_audio_params(ac, opts)?;
    let af = build_audio_filters(opts)?;
    if ac == "copy" && (!af.is_empty() || audio_params.sr.is_some() || audio_params.ch.is_some()) {
        return Err("Cannot apply audio filters, sample rate, or channel changes with audio codec 'copy'".into());
    }

    let threads = match non_empty(&opts.threads) {
        Some(raw) => validate_threads(raw)?,
        None => None,
    };

    let output_path = resolve_output_path(output_dir, input_path, &fmt)?;
    let mut args = vec!["-y".to_string()];

    if let Some(st) = start_s {
        args.push("-ss".to_string());
        args.push(format_seconds(st));
    }

    args.push("-protocol_whitelist".to_string());
    args.push("file".to_string());
    args.push("-i".to_string());
    args.push(input_str.to_string());

    if let Some(dur) = duration_s {
        args.push("-t".to_string());
        args.push(format_seconds(dur));
    }

    args.push("-vn".to_string());
    args.push("-c:a".to_string());
    args.push(ac.to_string());

    if let Some(bitrate) = audio_params.ab {
        args.push("-b:a".to_string());
        args.push(bitrate);
    }
    if let Some(sample_rate) = audio_params.sr {
        args.push("-ar".to_string());
        args.push(sample_rate.to_string());
    }
    if let Some(channels) = audio_params.ch {
        args.push("-ac".to_string());
        args.push(channels.to_string());
    }
    if !af.is_empty() {
        args.push("-filter:a".to_string());
        args.push(af.join(","));
    }
    if let Some(th) = threads {
        args.push("-threads".to_string());
        args.push(th);
    }
    if opts.no_meta.unwrap_or(false) {
        args.push("-map_metadata".to_string());
        args.push("-1".to_string());
    }

    args.push(output_path.to_string_lossy().into_owned());
    Ok(ConvertPlan {
        args,
        input_path: input_path.to_path_buf(),
        output_path,
    })
}

fn build_remux_plan(
    input_path: &Path,
    input_str: &str,
    output_dir: &Path,
    opts: &EncodeOptions,
) -> Result<ConvertPlan, String> {
    let fmt = non_empty(&opts.fmt)
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    if !matches!(fmt.as_str(), "mp4" | "mkv" | "webm" | "avi" | "mov") {
        return Err(format!("Unsupported remux container format: '{fmt}'"));
    }

    let (start_s, duration_s) = validate_trim(&opts.ts_start, &opts.ts_end)?;
    let threads = match non_empty(&opts.threads) {
        Some(raw) => validate_threads(raw)?,
        None => None,
    };
    let output_path = resolve_output_path(output_dir, input_path, &fmt)?;

    let mut args = vec!["-y".to_string()];
    if let Some(st) = start_s {
        args.push("-ss".to_string());
        args.push(format_seconds(st));
    }
    args.push("-protocol_whitelist".to_string());
    args.push("file".to_string());
    args.push("-i".to_string());
    args.push(input_str.to_string());
    if let Some(dur) = duration_s {
        args.push("-t".to_string());
        args.push(format_seconds(dur));
    }
    args.push("-c:v".to_string());
    args.push("copy".to_string());
    if opts.no_audio.unwrap_or(false) {
        args.push("-an".to_string());
    } else {
        args.push("-c:a".to_string());
        args.push("copy".to_string());
    }
    if let Some(th) = threads {
        args.push("-threads".to_string());
        args.push(th);
    }
    if opts.faststart.unwrap_or(false) && matches!(fmt.as_str(), "mp4" | "mov") {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }
    if opts.no_meta.unwrap_or(false) {
        args.push("-map_metadata".to_string());
        args.push("-1".to_string());
    }
    args.push(output_path.to_string_lossy().into_owned());

    Ok(ConvertPlan {
        args,
        input_path: input_path.to_path_buf(),
        output_path,
    })
}

fn build_video_convert_plan(
    input_path: &Path,
    input_str: &str,
    output_dir: &Path,
    opts: &EncodeOptions,
) -> Result<ConvertPlan, String> {
    let fmt = non_empty(&opts.fmt)
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    if !matches!(fmt.as_str(), "mp4" | "mkv" | "webm" | "avi" | "mov") {
        return Err(format!("Unsupported video output format: '{fmt}'"));
    }

    let vc = match non_empty(&opts.vc) {
        Some(raw) => validate_video_codec(raw)?,
        None => default_video_codec_for_fmt(&fmt),
    };
    validate_container_video_codec(&fmt, vc)?;

    let hw = non_empty(&opts.hw)
        .unwrap_or("none")
        .to_ascii_lowercase();
    if !matches!(hw.as_str(), "none" | "cuda" | "qsv") {
        return Err(format!("Unsupported hardware acceleration mode: '{hw}'"));
    }
    if hw != "none" && !matches!(vc, "libx264" | "libx265") {
        return Err(format!(
            "Hardware acceleration '{hw}' is only supported with libx264 or libx265 (got '{vc}')"
        ));
    }

    let (start_s, duration_s) = validate_trim(&opts.ts_start, &opts.ts_end)?;

    // Build video filter chain
    let mut vf: Vec<String> = Vec::new();
    if let Some(raw_res) = non_empty(&opts.res) {
        if let Some(scale) = validate_resolution(&raw_res.to_ascii_lowercase())? {
            vf.push(format!("scale={scale}"));
        }
    }

    if let Some(rot) = non_empty(&opts.rot) {
        match rot.to_ascii_lowercase().as_str() {
            "none" => {}
            "cw90" => vf.push("transpose=1".into()),
            "ccw90" => vf.push("transpose=2".into()),
            "180" => vf.push("transpose=2,transpose=2".into()),
            "fliph" => vf.push("hflip".into()),
            "flipv" => vf.push("vflip".into()),
            other => return Err(format!("Unsupported rotation option: '{other}'")),
        }
    }

    if let Some(speed) = opts.speed {
        if !speed.is_finite() || !(0.25..=4.0).contains(&speed) {
            return Err(format!("speed must be between 0.25 and 4.0 (got {speed})"));
        }
        if (speed - 1.0).abs() >= 1e-6 {
            vf.push(format!("setpts={:.4}*PTS", 1.0 / speed));
        }
    }

    if let (Some(cw_raw), Some(ch_raw)) = (non_empty(&opts.crop_w), non_empty(&opts.crop_h)) {
        let cw: u32 = cw_raw
            .parse()
            .map_err(|_| format!("Invalid cropW: '{cw_raw}'"))?;
        let ch: u32 = ch_raw
            .parse()
            .map_err(|_| format!("Invalid cropH: '{ch_raw}'"))?;
        if cw < 16 || ch < 16 || cw > 7680 || ch > 4320 {
            return Err("cropW/cropH out of valid bounds (16..7680 / 16..4320)".into());
        }
        let cx: u32 = non_empty(&opts.crop_x)
            .map(|s| s.parse::<u32>().map_err(|_| format!("Invalid cropX: '{s}'")))
            .transpose()?
            .unwrap_or(0);
        let cy: u32 = non_empty(&opts.crop_y)
            .map(|s| s.parse::<u32>().map_err(|_| format!("Invalid cropY: '{s}'")))
            .transpose()?
            .unwrap_or(0);
        vf.push(format!("crop={cw}:{ch}:{cx}:{cy}"));
    }

    if opts.deint.unwrap_or(false) {
        vf.push("yadif".into());
    }
    if opts.gray.unwrap_or(false) {
        vf.push("hue=s=0".into());
    }
    if opts.denoise.unwrap_or(false) {
        vf.push("hqdn3d".into());
    }
    if opts.sharp.unwrap_or(false) {
        vf.push("unsharp=5:5:1.0:5:5:0.0".into());
    }

    // Subtitles burn-in
    let sub_burn_enabled =
        opts.has_sub != Some(false) && opts.sub_mode.as_deref().unwrap_or("burn") == "burn";
    if sub_burn_enabled {
        if let Some(raw_sub) = non_empty(&opts.sub_path) {
            let sub_canonical = validate_existing_file(raw_sub, "subPath")?;
            let escaped = escape_subtitle_path(&sub_canonical);
            vf.push(format!("subtitles='{escaped}'"));
        }
    }

    // Watermark overlay
    let wm_enabled = opts.has_wm != Some(false);
    let wm_path_opt = if wm_enabled {
        non_empty(&opts.wm_path)
            .map(|raw| validate_existing_file(raw, "wmPath"))
            .transpose()?
    } else {
        None
    };

    if vc == "copy" && (!vf.is_empty() || wm_path_opt.is_some()) {
        return Err("Cannot apply video filters or watermark when video codec is 'copy'".into());
    }

    let wm_overlay = if wm_path_opt.is_some() {
        let pos = match non_empty(&opts.wm_pos).unwrap_or("br") {
            "tl" => "10:10",
            "tr" => "W-w-10:10",
            "bl" => "10:H-h-10",
            "br" => "W-w-10:H-h-10",
            "center" => "(W-w)/2:(H-h)/2",
            other => return Err(format!("Unsupported watermark position: '{other}'")),
        };
        // CRITICAL: explicitly respect wmOpa == 0.0 (do NOT treat 0.0 as falsy!)
        let opa = opts.wm_opa.unwrap_or(0.75);
        if !opa.is_finite() || !(0.0..=1.0).contains(&opa) {
            return Err(format!("wmOpa must be between 0.0 and 1.0 (got {opa})"));
        }
        Some((pos, opa))
    } else {
        None
    };

    // Validate rate control / quality
    let rc = non_empty(&opts.rc).map(str::to_ascii_lowercase);
    if let Some(ref rc_val) = rc {
        if !matches!(rc_val.as_str(), "crf" | "vbr") {
            return Err(format!("Unsupported rate control mode: '{rc_val}'"));
        }
    }

    let vbr = match non_empty(&opts.vbr) {
        Some(raw) => Some(validate_bitrate(raw, "vbr", 100, 500_000)?),
        None => None,
    };

    let tsz_vbr = match (non_empty(&opts.tsz), opts.duration_sec) {
        (Some(raw_tsz), Some(dur)) if dur.is_finite() && dur > 0.0 => {
            let target_mb: f64 = raw_tsz
                .parse()
                .map_err(|_| format!("Invalid target size (tsz): '{raw_tsz}'"))?;
            if !target_mb.is_finite() || !(0.5..=100_000.0).contains(&target_mb) {
                return Err(format!(
                    "tsz must be between 0.5 and 100000 MB (got '{raw_tsz}')"
                ));
            }
            let total_kbps = (target_mb * 8192.0) / dur;
            let audio_kbps = if opts.no_audio.unwrap_or(false) {
                0.0
            } else {
                128.0
            };
            let video_kbps = (total_kbps - audio_kbps).floor().max(100.0) as u64;
            Some(format!("{video_kbps}k"))
        }
        (Some(raw_tsz), _) => {
            let target_mb: f64 = raw_tsz
                .parse()
                .map_err(|_| format!("Invalid target size (tsz): '{raw_tsz}'"))?;
            if !target_mb.is_finite() || !(0.5..=100_000.0).contains(&target_mb) {
                return Err(format!(
                    "tsz must be between 0.5 and 100000 MB (got '{raw_tsz}')"
                ));
            }
            None
        }
        _ => None,
    };

    let crf = match non_empty(&opts.crf) {
        Some(raw) => {
            let val: u32 = raw
                .parse()
                .map_err(|_| format!("Invalid CRF value: '{raw}'"))?;
            if val > 63 {
                return Err(format!("crf must be between 0 and 63 (got {val})"));
            }
            Some(val)
        }
        None => None,
    };

    let preset = match non_empty(&opts.preset) {
        Some(raw) => {
            let lower = raw.to_ascii_lowercase();
            let valid = match lower.as_str() {
                "ultrafast" => "ultrafast",
                "superfast" => "superfast",
                "veryfast" => "veryfast",
                "faster" => "faster",
                "fast" => "fast",
                "medium" => "medium",
                "slow" => "slow",
                "slower" => "slower",
                "veryslow" => "veryslow",
                _ => return Err(format!("Unsupported encoder preset: '{raw}'")),
            };
            Some(valid)
        }
        None => None,
    };

    let tune = match non_empty(&opts.tune) {
        None => None,
        Some(raw) => {
            let lower = raw.to_ascii_lowercase();
            match lower.as_str() {
                "none" => None,
                "film" => Some("film"),
                "animation" => Some("animation"),
                "grain" => Some("grain"),
                "stillimage" => Some("stillimage"),
                "fastdecode" => Some("fastdecode"),
                "zerolatency" => Some("zerolatency"),
                _ => return Err(format!("Unsupported encoder tune: '{raw}'")),
            }
        }
    };

    let fps = match non_empty(&opts.fps) {
        Some(raw) => validate_fps(raw)?,
        None => None,
    };

    let pix_fmt = match non_empty(&opts.pix_fmt) {
        Some(raw) => {
            let lower = raw.to_ascii_lowercase();
            let valid = match lower.as_str() {
                "yuv420p" => "yuv420p",
                "yuv422p" => "yuv422p",
                "yuv444p" => "yuv444p",
                "yuv420p10le" => "yuv420p10le",
                "rgb24" => "rgb24",
                "rgba" => "rgba",
                _ => return Err(format!("Unsupported pixel format: '{raw}'")),
            };
            Some(valid)
        }
        None => None,
    };

    let aspect = match non_empty(&opts.aspect) {
        None => None,
        Some(raw) => {
            let lower = raw.to_ascii_lowercase();
            match lower.as_str() {
                "auto" => None,
                "16:9" => Some("16:9"),
                "4:3" => Some("4:3"),
                "1:1" => Some("1:1"),
                "9:16" => Some("9:16"),
                "21:9" => Some("21:9"),
                _ => return Err(format!("Unsupported aspect ratio: '{raw}'")),
            }
        }
    };

    let threads = match non_empty(&opts.threads) {
        Some(raw) => validate_threads(raw)?,
        None => None,
    };

    // Validate audio settings
    let no_audio = opts.no_audio.unwrap_or(false);
    let audio_plan = if no_audio {
        None
    } else {
        let ac = match non_empty(&opts.ac) {
            Some(raw) => normalize_audio_codec(raw)?,
            None => default_audio_codec_for_fmt(&fmt),
        };
        validate_container_audio_codec(&fmt, ac)?;
        let audio_params = validate_audio_params(ac, opts)?;
        let af = build_audio_filters(opts)?;
        if ac == "copy"
            && (!af.is_empty() || audio_params.sr.is_some() || audio_params.ch.is_some())
        {
            return Err(
                "Cannot apply audio filters, sample rate, or channel changes with audio codec 'copy'"
                    .into(),
            );
        }
        Some((ac, audio_params, af))
    };

    let output_path = resolve_output_path(output_dir, input_path, &fmt)?;

    // Assemble FFmpeg arguments in strictly valid order
    let mut args = vec!["-y".to_string()];

    // Input options MUST precede `-i`:
    if let Some(st) = start_s {
        args.push("-ss".to_string());
        args.push(format_seconds(st));
    }

    // CRITICAL: `-hwaccel` MUST come BEFORE `-i`!
    if hw != "none" {
        args.push("-hwaccel".to_string());
        args.push(hw.clone());
    }

    args.push("-protocol_whitelist".to_string());
    args.push("file".to_string());
    args.push("-i".to_string());
    args.push(input_str.to_string());

    // Secondary watermark input comes right after primary `-i` and BEFORE `-t` / output options
    if let Some(ref wm_path) = wm_path_opt {
        args.push("-protocol_whitelist".to_string());
        args.push("file".to_string());
        args.push("-i".to_string());
        args.push(wm_path.to_string_lossy().into_owned());
    }

    // Trim duration applies to the output stream
    if let Some(dur) = duration_s {
        args.push("-t".to_string());
        args.push(format_seconds(dur));
    }

    // Video filters / watermark filter_complex (always include `format=rgba` before colorchannelmixer)
    if let Some((pos, opa)) = wm_overlay {
        let chain = if vf.is_empty() {
            format!("[1:v]format=rgba,colorchannelmixer=aa={opa:.2}[wm];[0:v][wm]overlay={pos}[outv]")
        } else {
            format!(
                "[0:v]{}[base];[1:v]format=rgba,colorchannelmixer=aa={opa:.2}[wm];[base][wm]overlay={pos}[outv]",
                vf.join(",")
            )
        };
        args.push("-filter_complex".to_string());
        args.push(chain);
        args.push("-map".to_string());
        args.push("[outv]".to_string());
        if !no_audio {
            args.push("-map".to_string());
            args.push("0:a?".to_string());
        }
    } else if !vf.is_empty() {
        args.push("-vf".to_string());
        args.push(vf.join(","));
    }

    // Video encoder + rate control
    let effective_vbr = vbr.or(tsz_vbr);
    if vc == "copy" {
        args.push("-c:v".to_string());
        args.push("copy".to_string());
    } else if hw == "cuda" {
        let enc = if vc == "libx265" {
            "hevc_nvenc"
        } else {
            "h264_nvenc"
        };
        args.push("-c:v".to_string());
        args.push(enc.to_string());
        if vc == "libx265" && matches!(fmt.as_str(), "mp4" | "mov") {
            args.push("-tag:v".to_string());
            args.push("hvc1".to_string());
        }
        if rc.as_deref() == Some("vbr") || (rc.is_none() && effective_vbr.is_some()) {
            if let Some(ref br) = effective_vbr {
                args.push("-b:v".to_string());
                args.push(br.clone());
            }
        } else {
            args.push("-cq".to_string());
            args.push(crf.unwrap_or(23).to_string());
        }
    } else if hw == "qsv" {
        let enc = if vc == "libx265" {
            "hevc_qsv"
        } else {
            "h264_qsv"
        };
        args.push("-c:v".to_string());
        args.push(enc.to_string());
        if vc == "libx265" && matches!(fmt.as_str(), "mp4" | "mov") {
            args.push("-tag:v".to_string());
            args.push("hvc1".to_string());
        }
        if rc.as_deref() == Some("vbr") || (rc.is_none() && effective_vbr.is_some()) {
            if let Some(ref br) = effective_vbr {
                args.push("-b:v".to_string());
                args.push(br.clone());
            }
        } else {
            args.push("-global_quality".to_string());
            args.push(crf.unwrap_or(23).to_string());
        }
    } else {
        args.push("-c:v".to_string());
        args.push(vc.to_string());

        if vc == "libx265" && matches!(fmt.as_str(), "mp4" | "mov") {
            args.push("-tag:v".to_string());
            args.push("hvc1".to_string());
        }
        if vc == "prores_ks" {
            args.push("-profile:v".to_string());
            args.push("3".to_string());
        }

        let use_vbr = rc.as_deref() == Some("vbr") || (rc.is_none() && effective_vbr.is_some());
        if use_vbr {
            if let Some(ref br) = effective_vbr {
                args.push("-b:v".to_string());
                args.push(br.clone());
            }
        } else if vc != "prores_ks" {
            match vc {
                "libx264" | "libx265" => {
                    args.push("-crf".to_string());
                    args.push(crf.unwrap_or(23).to_string());
                }
                "libvpx-vp9" | "libaom-av1" => {
                    args.push("-crf".to_string());
                    args.push(crf.unwrap_or(30).to_string());
                    args.push("-b:v".to_string());
                    args.push("0".to_string());
                }
                _ => {}
            }
        }

        if matches!(vc, "libx264" | "libx265") {
            if let Some(p) = preset {
                args.push("-preset".to_string());
                args.push(p.to_string());
            }
            if let Some(t) = tune {
                args.push("-tune".to_string());
                args.push(t.to_string());
            }
        }
    }

    if let Some(f) = fps {
        args.push("-r".to_string());
        args.push(f);
    }
    if let Some(pf) = pix_fmt {
        if vc != "copy" {
            args.push("-pix_fmt".to_string());
            args.push(pf.to_string());
        }
    }
    if let Some(ar) = aspect {
        args.push("-aspect".to_string());
        args.push(ar.to_string());
    }
    if let Some(th) = threads {
        args.push("-threads".to_string());
        args.push(th);
    }

    // Audio encoder & filters
    match audio_plan {
        None => {
            args.push("-an".to_string());
        }
        Some((ac, audio_params, af)) => {
            args.push("-c:a".to_string());
            args.push(ac.to_string());
            if let Some(bitrate) = audio_params.ab {
                args.push("-b:a".to_string());
                args.push(bitrate);
            }
            if let Some(sample_rate) = audio_params.sr {
                args.push("-ar".to_string());
                args.push(sample_rate.to_string());
            }
            if let Some(channels) = audio_params.ch {
                args.push("-ac".to_string());
                args.push(channels.to_string());
            }
            if !af.is_empty() {
                args.push("-filter:a".to_string());
                args.push(af.join(","));
            }
        }
    }

    if opts.faststart.unwrap_or(false) && matches!(fmt.as_str(), "mp4" | "mov") {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }
    if opts.no_meta.unwrap_or(false) {
        args.push("-map_metadata".to_string());
        args.push("-1".to_string());
    }

    args.push(output_path.to_string_lossy().into_owned());

    Ok(ConvertPlan {
        args,
        input_path: input_path.to_path_buf(),
        output_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ffmpeg_ui_test_{tag}_{nanos}"));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    fn touch(path: &Path) {
        fs::write(path, b"dummy").expect("write dummy test file");
    }

    #[test]
    fn rejects_invalid_inputs_codecs_bounds_and_custom_injection() {
        let dir = make_temp_dir("rejects");
        let input = dir.join("clip.mp4");
        touch(&input);
        let input_str = input.to_string_lossy().to_string();
        let dir_str = dir.to_string_lossy().to_string();

        // 1. Custom CLI flags must be rejected
        let req_custom = ConvertRequest {
            job_id: "job_1".into(),
            input_path: input_str.clone(),
            output_dir: dir_str.clone(),
            options: EncodeOptions {
                custom: Some("-i /etc/passwd".into()),
                ..Default::default()
            },
        };
        assert!(build_convert_plan(&req_custom).is_err());

        // 2. Non-existent input path rejected
        let req_missing = ConvertRequest {
            job_id: "job_2".into(),
            input_path: dir.join("does_not_exist.mp4").to_string_lossy().to_string(),
            output_dir: dir_str.clone(),
            options: EncodeOptions::default(),
        };
        assert!(build_convert_plan(&req_missing).is_err());

        // 3. Invalid codec / container combo rejected (libx264 in webm, aac in mp3)
        let req_webm_x264 = ConvertRequest {
            job_id: "job_3".into(),
            input_path: input_str.clone(),
            output_dir: dir_str.clone(),
            options: EncodeOptions {
                fmt: Some("webm".into()),
                vc: Some("libx264".into()),
                ..Default::default()
            },
        };
        assert!(build_convert_plan(&req_webm_x264).is_err());

        let req_mp3_aac = ConvertRequest {
            job_id: "job_4".into(),
            input_path: input_str.clone(),
            output_dir: dir_str.clone(),
            options: EncodeOptions {
                mode: Some("audio".into()),
                fmt: Some("mp3".into()),
                ac: Some("aac".into()),
                ..Default::default()
            },
        };
        assert!(build_convert_plan(&req_mp3_aac).is_err());

        // 4. Out-of-bounds CRF & speed rejected
        let req_bad_crf = ConvertRequest {
            job_id: "job_5".into(),
            input_path: input_str.clone(),
            output_dir: dir_str.clone(),
            options: EncodeOptions {
                crf: Some("99".into()),
                ..Default::default()
            },
        };
        assert!(build_convert_plan(&req_bad_crf).is_err());

        let req_bad_speed = ConvertRequest {
            job_id: "job_6".into(),
            input_path: input_str.clone(),
            output_dir: dir_str.clone(),
            options: EncodeOptions {
                speed: Some(0.1),
                ..Default::default()
            },
        };
        assert!(build_convert_plan(&req_bad_speed).is_err());

        // 5. Invalid job_id with traversal / injection characters rejected
        let req_bad_job = ConvertRequest {
            job_id: "../evil;rm".into(),
            input_path: input_str.clone(),
            output_dir: dir_str.clone(),
            options: EncodeOptions::default(),
        };
        assert!(build_convert_plan(&req_bad_job).is_err());

        // 6. Output dir as a file (not directory) rejected
        let req_bad_dir = ConvertRequest {
            job_id: "job_7".into(),
            input_path: input_str,
            output_dir: input.to_string_lossy().to_string(),
            options: EncodeOptions::default(),
        };
        assert!(build_convert_plan(&req_bad_dir).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn places_hwaccel_before_input_and_maps_qsv_hevc() {
        let dir = make_temp_dir("hwaccel");
        let input = dir.join("video.mp4");
        touch(&input);

        let req = ConvertRequest {
            job_id: "job_hw".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("convert".into()),
                fmt: Some("mp4".into()),
                vc: Some("libx265".into()),
                hw: Some("qsv".into()),
                ..Default::default()
            },
        };

        let plan = build_convert_plan(&req).expect("qsv hevc plan should succeed");
        let hw_idx = plan.args.iter().position(|a| a == "-hwaccel").unwrap();
        let i_idx = plan.args.iter().position(|a| a == "-i").unwrap();
        assert!(hw_idx < i_idx, "-hwaccel must precede -i: {:?}", plan.args);
        assert_eq!(plan.args[hw_idx + 1], "qsv");
        let cv_idx = plan.args.iter().position(|a| a == "-c:v").unwrap();
        assert_eq!(plan.args[cv_idx + 1], "hevc_qsv");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn chains_atempo_for_extreme_speeds_and_honors_zero_volume() {
        assert_eq!(
            build_atempo_filters(0.25).unwrap(),
            vec!["atempo=0.5", "atempo=0.5"]
        );
        assert_eq!(
            build_atempo_filters(4.0).unwrap(),
            vec!["atempo=2.0", "atempo=2.0"]
        );

        let dir = make_temp_dir("audio_filters");
        let input = dir.join("clip.mp4");
        touch(&input);

        let req = ConvertRequest {
            job_id: "job_af".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("convert".into()),
                fmt: Some("mp4".into()),
                vol: Some(0.0),
                speed: Some(0.25),
                ..Default::default()
            },
        };

        let plan = build_convert_plan(&req).expect("plan with vol=0 and speed=0.25");
        let af_idx = plan.args.iter().position(|a| a == "-filter:a").unwrap();
        let af = &plan.args[af_idx + 1];
        assert!(af.contains("volume=0.00"), "vol=0.0 must emit mute: {af}");
        assert!(
            af.contains("atempo=0.5,atempo=0.5"),
            "0.25x must chain atempo: {af}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn computes_trim_duration_and_watermark_zero_opacity_with_rgba() {
        let dir = make_temp_dir("trim_wm");
        let input = dir.join("movie.mp4");
        let wm = dir.join("logo.jpg");
        touch(&input);
        touch(&wm);

        let req = ConvertRequest {
            job_id: "job_trim_wm".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("convert".into()),
                fmt: Some("mp4".into()),
                ts_start: Some("00:00:04".into()),
                ts_end: Some("00:00:06.5".into()),
                wm_path: Some(wm.to_string_lossy().to_string()),
                wm_opa: Some(0.0),
                wm_pos: Some("tl".into()),
                ..Default::default()
            },
        };

        let plan = build_convert_plan(&req).expect("trim + wm plan should succeed");
        let ss_idx = plan.args.iter().position(|a| a == "-ss").unwrap();
        let i_indices: Vec<usize> = plan
            .args
            .iter()
            .enumerate()
            .filter_map(|(idx, a)| (a == "-i").then_some(idx))
            .collect();
        let t_idx = plan.args.iter().position(|a| a == "-t").unwrap();
        assert_eq!(i_indices.len(), 2);
        assert!(ss_idx < i_indices[0]);
        assert!(t_idx > i_indices[1], "-t must appear after all -i inputs");
        assert_eq!(plan.args[ss_idx + 1], "4");
        assert_eq!(plan.args[t_idx + 1], "2.5");

        let fc_idx = plan
            .args
            .iter()
            .position(|a| a == "-filter_complex")
            .unwrap();
        let fc = &plan.args[fc_idx + 1];
        assert!(
            fc.contains("format=rgba,colorchannelmixer=aa=0.00"),
            "wmOpa=0 must keep 0.00 and include format=rgba: {fc}"
        );
        assert!(fc.contains("overlay=10:10"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn builds_gif_palettegen_and_thumbnail_with_proper_extensions() {
        let dir = make_temp_dir("gif_thumb");
        let input = dir.join("clip.mp4");
        touch(&input);

        // GIF via convert + fmt: "gif"
        let gif_req = ConvertRequest {
            job_id: "job_gif".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("convert".into()),
                fmt: Some("gif".into()),
                gif_fps: Some("12".into()),
                gif_w: Some("360".into()),
                ..Default::default()
            },
        };
        let gif_plan = build_convert_plan(&gif_req).expect("gif plan");
        assert_eq!(gif_plan.output_path.extension().unwrap(), "gif");
        let vf_idx = gif_plan.args.iter().position(|a| a == "-vf").unwrap();
        assert!(gif_plan.args[vf_idx + 1].contains("palettegen"));
        assert!(gif_plan.args[vf_idx + 1].contains("fps=12,scale=360:-1"));

        // Thumbnail honors thFmt
        let thumb_req = ConvertRequest {
            job_id: "job_thumb".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("thumbnail".into()),
                fmt: Some("mp4".into()),
                th_fmt: Some("webp".into()),
                th_time: Some("00:00:02".into()),
                ..Default::default()
            },
        };
        let thumb_plan = build_convert_plan(&thumb_req).expect("thumbnail plan");
        assert_eq!(thumb_plan.output_path.extension().unwrap(), "webp");
        assert!(thumb_plan.args.contains(&"-frames:v".to_string()));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn escapes_windows_subtitle_paths_and_disambiguates_output_collisions() {
        let escaped = escape_subtitle_path(Path::new(r"C:\Users\Benny\My Sub's [1].srt"));
        assert_eq!(escaped, r"C\:/Users/Benny/My Sub'\\\''s \[1\].srt");

        let dir = make_temp_dir("collisions");
        let input = dir.join("sample.mp4");
        touch(&input);

        let first = resolve_output_path(&dir, &input, "mp4").unwrap();
        assert_eq!(first.file_name().unwrap(), "sample_converted.mp4");
        touch(&first);

        let second = resolve_output_path(&dir, &input, "mp4").unwrap();
        assert_eq!(second.file_name().unwrap(), "sample_converted (1).mp4");
        touch(&second);

        let third = resolve_output_path(&dir, &input, "mp4").unwrap();
        assert_eq!(third.file_name().unwrap(), "sample_converted (2).mp4");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn deserializes_core_command_options_aliases_cleanly() {
        let json = r#"{
            "mode": "convert",
            "fmt": "mp4",
            "vc": "libx264",
            "hwaccel": "none",
            "crf": 22,
            "rotate": "cw90",
            "den": true,
            "webOpt": true,
            "gFps": "15",
            "gW": 480,
            "vol": "0.5",
            "speed": "1.5",
            "wmOpa": "0",
            "durationSec": 12.5,
            "ts_start": "00:00:01",
            "ts_end": "00:00:05"
        }"#;
        let opts: EncodeOptions = serde_json::from_str(json).expect("deserialize aliases");
        assert_eq!(opts.hw.as_deref(), Some("none"));
        assert_eq!(opts.crf.as_deref(), Some("22"));
        assert_eq!(opts.rot.as_deref(), Some("cw90"));
        assert_eq!(opts.denoise, Some(true));
        assert_eq!(opts.faststart, Some(true));
        assert_eq!(opts.gif_fps.as_deref(), Some("15"));
        assert_eq!(opts.gif_w.as_deref(), Some("480"));
        assert_eq!(opts.vol, Some(0.5));
        assert_eq!(opts.speed, Some(1.5));
        assert_eq!(opts.wm_opa, Some(0.0));
        assert_eq!(opts.duration_sec, Some(12.5));
        assert_eq!(opts.ts_start.as_deref(), Some("00:00:01"));
        assert_eq!(opts.ts_end.as_deref(), Some("00:00:05"));
    }

    #[test]
    fn supports_short_clip_thumbnail_default_ogg_flac_and_target_size() {
        let dir = make_temp_dir("parity");
        let input = dir.join("short.mp4");
        touch(&input);

        // Short clip (< 1.5s) defaults thumbnail seek to 0
        let thumb_req = ConvertRequest {
            job_id: "job_short_thumb".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("thumbnail".into()),
                duration_sec: Some(0.8),
                th_fmt: Some("PNG".into()),
                ..Default::default()
            },
        };
        let thumb_plan = build_convert_plan(&thumb_req).expect("short thumbnail plan");
        let ss_idx = thumb_plan.args.iter().position(|a| a == "-ss").unwrap();
        assert_eq!(thumb_plan.args[ss_idx + 1], "0");
        assert_eq!(thumb_plan.output_path.extension().unwrap(), "png");

        // OGG + FLAC audio parity with @ffmpeg-ui/core
        let ogg_req = ConvertRequest {
            job_id: "job_ogg_flac".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("audio".into()),
                fmt: Some("OGG".into()),
                ac: Some("FLAC".into()),
                ..Default::default()
            },
        };
        let ogg_plan = build_convert_plan(&ogg_req).expect("ogg flac plan");
        let ca_idx = ogg_plan.args.iter().position(|a| a == "-c:a").unwrap();
        assert_eq!(ogg_plan.args[ca_idx + 1], "flac");

        // Target file size computes -b:v when durationSec is present
        let tsz_req = ConvertRequest {
            job_id: "job_tsz".into(),
            input_path: input.to_string_lossy().to_string(),
            output_dir: dir.to_string_lossy().to_string(),
            options: EncodeOptions {
                mode: Some("convert".into()),
                fmt: Some("mp4".into()),
                vc: Some("libx264".into()),
                tsz: Some("10".into()),
                duration_sec: Some(20.0),
                ..Default::default()
            },
        };
        let tsz_plan = build_convert_plan(&tsz_req).expect("tsz plan");
        let bv_idx = tsz_plan.args.iter().position(|a| a == "-b:v").unwrap();
        assert_eq!(tsz_plan.args[bv_idx + 1], "3968k");

        let _ = fs::remove_dir_all(&dir);
    }
}
