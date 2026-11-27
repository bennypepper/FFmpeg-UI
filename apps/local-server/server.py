from __future__ import annotations

import collections
import hmac
import json
import logging
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from flask import (
    Flask,
    Response,
    jsonify,
    request,
    send_file,
    send_from_directory,
    stream_with_context,
)
from flask_cors import CORS

if TYPE_CHECKING:
    from collections.abc import Iterator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ffmpeg_ui.local_server")

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR.parent / "local-server-web" / "dist"

UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

ALLOWED_ORIGINS: tuple[str, ...] = (
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
)
ALLOWED_ORIGINS_SET: frozenset[str] = frozenset(ALLOWED_ORIGINS)

BOOT_TOKEN: str = secrets.token_urlsafe(32)


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        logger.warning("Invalid integer for %s=%r; using default %d", name, raw, default)
        return default


MAX_UPLOAD_MB: int = _env_int("FFMPEG_UI_MAX_UPLOAD_MB", 2048, minimum=1)
JOB_TTL_SECONDS: int = _env_int("FFMPEG_UI_JOB_TTL_SEC", 3600, minimum=1)

app = Flask(__name__, static_folder=str(DIST_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

CORS(
    app,
    origins=list(ALLOWED_ORIGINS),
    allow_headers=["Content-Type", "X-Local-Token"],
    methods=["GET", "POST", "OPTIONS"],
    supports_credentials=False,
)

# ── Concurrency & Job State ──────────────────────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}
_processes: dict[str, subprocess.Popen[str]] = {}
_cancel_flags: set[str] = set()
_session_uploads: dict[str, float] = {}
_jobs_lock = threading.Lock()
CAPABILITIES: dict[str, Any] = {}
_caps_lock = threading.Lock()

# ── Validation Constants ─────────────────────────────────────────────────────
STORED_NAME_RE = re.compile(r"^[0-9a-f]{32}\.[a-z0-9]{1,8}$")
JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
TIMESTAMP_RE = re.compile(r"^(?:(\d{1,3}):)?(?:([0-5]?\d):)?(\d{1,5}(?:\.\d{1,4})?)$")
RES_CUSTOM_RE = re.compile(r"^(\d{2,4}):(-2|-1|\d{2,4})$")
BITRATE_RE = re.compile(r"^(\d{1,6})([kKmM]?)$")
SAFE_STEM_RE = re.compile(r"[^A-Za-z0-9._ -]+")

ALLOWED_MEDIA_EXTENSIONS: frozenset[str] = frozenset(
    {
        # Video
        ".mp4",
        ".mkv",
        ".webm",
        ".mov",
        ".avi",
        ".flv",
        ".wmv",
        ".m4v",
        ".ts",
        ".mts",
        ".m2ts",
        ".3gp",
        ".ogv",
        ".mpeg",
        ".mpg",
        # Audio
        ".mp3",
        ".wav",
        ".flac",
        ".aac",
        ".m4a",
        ".ogg",
        ".opus",
        ".wma",
        ".aiff",
        ".aif",
        ".ac3",
        ".alac",
        ".amr",
        # Image (no .svg — XSS risk)
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".bmp",
        ".tif",
        ".tiff",
    }
)

VIDEO_FORMATS: frozenset[str] = frozenset({"mp4", "mkv", "webm", "mov", "avi"})
AUDIO_FORMATS: frozenset[str] = frozenset({"mp3", "wav", "flac", "aac", "m4a", "ogg", "opus"})
THUMBNAIL_FORMATS: frozenset[str] = frozenset({"jpg", "png", "webp"})
ALLOWED_MODES: frozenset[str] = frozenset({"convert", "audio", "remux", "thumbnail", "gif"})

ALLOWED_VIDEO_CODECS: frozenset[str] = frozenset(
    {"libx264", "libx265", "libvpx-vp9", "libaom-av1", "prores_ks", "copy"}
)
ALLOWED_AUDIO_CODECS: frozenset[str] = frozenset(
    {"aac", "libmp3lame", "libopus", "libvorbis", "flac", "pcm_s16le", "copy"}
)
ALLOWED_HWACCELS: frozenset[str] = frozenset({"none", "cuda", "qsv"})
ALLOWED_PRESETS: frozenset[str] = frozenset(
    {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"}
)
ALLOWED_TUNES_X264: frozenset[str] = frozenset(
    {"none", "film", "animation", "grain", "stillimage", "fastdecode", "zerolatency"}
)
ALLOWED_TUNES_X265: frozenset[str] = frozenset(
    {"none", "psnr", "ssim", "grain", "fastdecode", "zerolatency", "animation"}
)
ALLOWED_SAMPLE_RATES: frozenset[int] = frozenset(
    {8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000}
)
OPUS_SAMPLE_RATES: frozenset[int] = frozenset({8000, 12000, 16000, 24000, 48000})
ALLOWED_CHANNELS: frozenset[int] = frozenset({1, 2, 6})
ALLOWED_PIX_FMTS: frozenset[str] = frozenset(
    {"yuv420p", "yuv422p", "yuv444p", "yuv420p10le", "yuva420p"}
)
ALLOWED_ASPECTS: frozenset[str] = frozenset({"auto", "16:9", "4:3", "1:1", "21:9", "9:16"})

_RES_MAP: dict[str, str] = {
    "4k": "3840:-2",
    "1080p": "1920:-2",
    "720p": "1280:-2",
    "480p": "854:-2",
    "360p": "640:-2",
}
_ROT_MAP: dict[str, str] = {
    "cw90": "transpose=1",
    "ccw90": "transpose=2",
    "180": "transpose=2,transpose=2",
    "fliph": "hflip",
    "flipv": "vflip",
}

CONTAINER_VIDEO_CODECS: dict[str, frozenset[str]] = {
    "mp4": frozenset({"libx264", "libx265", "copy"}),
    "mkv": frozenset({"libx264", "libx265", "libvpx-vp9", "libaom-av1", "prores_ks", "copy"}),
    "webm": frozenset({"libvpx-vp9", "libaom-av1", "copy"}),
    "mov": frozenset({"libx264", "libx265", "prores_ks", "copy"}),
    "avi": frozenset({"libx264", "copy"}),
}

CONTAINER_AUDIO_CODECS: dict[str, frozenset[str]] = {
    "mp4": frozenset({"aac", "libmp3lame", "libopus", "copy"}),
    "mkv": frozenset({"aac", "libmp3lame", "libopus", "libvorbis", "flac", "pcm_s16le", "copy"}),
    "webm": frozenset({"libopus", "libvorbis", "copy"}),
    "mov": frozenset({"aac", "pcm_s16le", "flac", "copy"}),
    "avi": frozenset({"libmp3lame", "pcm_s16le", "aac", "copy"}),
    "mp3": frozenset({"libmp3lame", "copy"}),
    "wav": frozenset({"pcm_s16le", "copy"}),
    "flac": frozenset({"flac", "copy"}),
    "aac": frozenset({"aac", "copy"}),
    "m4a": frozenset({"aac", "flac", "copy"}),
    "ogg": frozenset({"libvorbis", "libopus", "flac", "copy"}),
    "opus": frozenset({"libopus", "copy"}),
}

DEFAULT_VIDEO_CODEC_FOR_FMT: dict[str, str] = {
    "mp4": "libx264",
    "mkv": "libx264",
    "webm": "libvpx-vp9",
    "mov": "libx264",
    "avi": "libx264",
}

DEFAULT_AUDIO_CODEC_FOR_FMT: dict[str, str] = {
    "mp4": "aac",
    "mkv": "aac",
    "webm": "libopus",
    "mov": "aac",
    "avi": "libmp3lame",
    "mp3": "libmp3lame",
    "wav": "pcm_s16le",
    "flac": "flac",
    "aac": "aac",
    "m4a": "aac",
    "ogg": "libvorbis",
    "opus": "libopus",
}

# Endpoints that never require X-Local-Token
_PUBLIC_ENDPOINTS: frozenset[str] = frozenset({"index", "static", "auth_token", "capabilities"})
# Endpoints that accept ?token= fallback because EventSource / <video> / <a> cannot set headers
_QUERY_TOKEN_ENDPOINTS: frozenset[str] = frozenset({"progress", "download", "serve_upload"})


class ValidationError(ValueError):
    """Raised when client-supplied input fails schema or security validation."""


# ── Security Middleware & Error Handlers ─────────────────────────────────────
@app.before_request
def _enforce_origin_and_auth() -> tuple[Response, int] | None:
    origin = request.headers.get("Origin")
    if origin is not None and origin not in ALLOWED_ORIGINS_SET:
        return jsonify({"error": "Origin not allowed"}), 403

    if request.method == "OPTIONS":
        return None

    endpoint = request.endpoint
    if endpoint in _PUBLIC_ENDPOINTS:
        return None

    # Allow Flask's 404 handler to run for unknown paths only if authenticated,
    # or protect all non-public routes with token auth.
    provided = request.headers.get("X-Local-Token", "")
    if not provided and endpoint in _QUERY_TOKEN_ENDPOINTS:
        provided = request.args.get("token", "")

    if not provided or not hmac.compare_digest(provided, BOOT_TOKEN):
        return jsonify({"error": "Unauthorized: missing or invalid token"}), 401
    return None


@app.after_request
def _add_security_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


@app.errorhandler(413)
def _handle_payload_too_large(_err: Any) -> tuple[Response, int]:
    return jsonify({"error": f"Upload exceeds maximum allowed size of {MAX_UPLOAD_MB} MB"}), 413


# ── Subprocess & Path Helpers ────────────────────────────────────────────────
def _popen_kwargs() -> dict[str, Any]:
    if os.name == "nt":
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = subprocess.SW_HIDE
        return {"startupinfo": si}
    return {}


def _safe_resolve(base_dir: Path, filename: str) -> Path:
    """Strictly resolve a stored filename inside base_dir without allowing traversal."""
    if not isinstance(filename, str) or not STORED_NAME_RE.fullmatch(filename):
        raise ValidationError("Invalid stored filename")
    base_resolved = base_dir.resolve()
    resolved = (base_resolved / filename).resolve()
    if not resolved.is_relative_to(base_resolved) or resolved.parent != base_resolved:
        raise ValidationError("Path escapes allowed directory")
    return resolved


def _validate_upload_extension(filename: str) -> str:
    """Validate uploaded filename extension against the strict media allowlist."""
    ext = Path(filename).suffix.lower()
    if not ext or ext not in ALLOWED_MEDIA_EXTENSIONS:
        raise ValidationError(f"Unsupported file extension: '{ext or '(none)'}'")
    return ext


def _sanitize_download_stem(original_name: str | None, fallback: str = "output") -> str:
    """Sanitize a client-provided filename into a safe download stem."""
    if not original_name or not isinstance(original_name, str):
        return fallback
    basename = Path(original_name.replace("\\", "/")).name
    stem = Path(basename).stem
    cleaned = SAFE_STEM_RE.sub("_", stem).strip(" ._")
    cleaned = re.sub(r"[_\s]+", "_", cleaned)
    if not cleaned:
        return fallback
    return cleaned[:100]


def _seconds(t: str) -> float:
    """Parse SS(.ms), MM:SS(.ms), or HH:MM:SS(.ms) into seconds."""
    if not isinstance(t, str):
        return 0.0
    stripped = t.strip()
    if not stripped:
        return 0.0
    parts = stripped.split(":")
    try:
        if len(parts) == 1:
            val = float(parts[0])
        elif len(parts) == 2:
            val = int(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 3:
            val = int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        else:
            return 0.0
    except ValueError:
        return 0.0
    return max(0.0, val)


def _parse_timestamp(raw: Any, *, name: str) -> tuple[str, float] | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if not TIMESTAMP_RE.fullmatch(s):
        raise ValidationError(f"Invalid timestamp for '{name}': {s!r}")
    secs = _seconds(s)
    return s, secs


def _parse_bool(raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return bool(raw)
    if isinstance(raw, str):
        return raw.strip().lower() in {"true", "1", "yes"}
    return False


def _parse_int(raw: Any, *, default: int, min_val: int, max_val: int, name: str) -> int:
    if raw is None or raw == "":
        return default
    try:
        val = int(str(raw).strip())
    except ValueError as err:
        raise ValidationError(f"Invalid integer for '{name}'") from err
    if val < min_val or val > max_val:
        raise ValidationError(f"'{name}' must be between {min_val} and {max_val}")
    return val


def _parse_float(raw: Any, *, default: float, min_val: float, max_val: float, name: str) -> float:
    if raw is None or raw == "":
        return default
    try:
        val = float(str(raw).strip())
    except ValueError as err:
        raise ValidationError(f"Invalid number for '{name}'") from err
    if val < min_val or val > max_val:
        raise ValidationError(f"'{name}' must be between {min_val} and {max_val}")
    return val


def _parse_bitrate(raw: Any, *, default: str, min_kbps: int, max_kbps: int, name: str) -> str:
    if raw is None or str(raw).strip() == "":
        return default
    text = str(raw).strip()
    match = BITRATE_RE.fullmatch(text)
    if not match:
        raise ValidationError(f"Invalid bitrate for '{name}': {text!r}")
    amount = int(match.group(1))
    unit = match.group(2).lower()
    kbps = amount * 1000 if unit == "m" else amount
    if kbps < min_kbps or kbps > max_kbps:
        raise ValidationError(f"'{name}' must be between {min_kbps}k and {max_kbps}k")
    return f"{kbps}k"


def _build_atempo_filters(speed: float) -> list[str]:
    """Chain FFmpeg atempo filters so every stage stays within [0.5, 2.0]."""
    if speed <= 0:
        raise ValidationError("Speed must be greater than 0")
    filters: list[str] = []
    remaining = speed
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    formatted = f"{remaining:.4f}".rstrip("0").rstrip(".")
    filters.append(f"atempo={formatted}")
    return filters


def _parse_progress(line: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, pat in (
        ("time", r"time=(\d+:\d+:\d+\.\d+)"),
        ("fps", r"fps=\s*(\d+\.?\d*)"),
        ("frame", r"frame=\s*(\d+)"),
        ("size_kb", r"size=\s*(\d+)kB"),
    ):
        match = re.search(pat, line)
        if match:
            out[key] = match.group(1)
    return out


def _probe(path: Path) -> dict[str, Any] | None:
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-protocol_whitelist",
        "file",
        "--",
        str(path),
    ]
    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
            **_popen_kwargs(),
        )
        if res.returncode != 0:
            return None
        data = json.loads(res.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as err:
        logger.warning("ffprobe failed for %s: %s", path.name, err)
        return None

    fmt = data.get("format", {})
    streams = data.get("streams", [])
    vs = next((s for s in streams if s.get("codec_type") == "video"), None)
    as_ = next((s for s in streams if s.get("codec_type") == "audio"), None)

    try:
        duration = float(fmt.get("duration", 0) or 0)
    except (TypeError, ValueError):
        duration = 0.0
    try:
        size_mb = round(int(fmt.get("size", 0) or 0) / 1_048_576, 2)
    except (TypeError, ValueError):
        size_mb = 0.0
    try:
        bitrate_kbps = round(int(fmt.get("bit_rate", 0) or 0) / 1000)
    except (TypeError, ValueError):
        bitrate_kbps = 0

    info: dict[str, Any] = {
        "duration": duration,
        "size_mb": size_mb,
        "bitrate_kbps": bitrate_kbps,
    }
    if vs:
        info["width"] = int(vs.get("width", 0) or 0)
        info["height"] = int(vs.get("height", 0) or 0)
        info["video_codec"] = str(vs.get("codec_name", "unknown"))
        raw_rate = str(vs.get("r_frame_rate", "0/1"))
        try:
            num_s, den_s = raw_rate.split("/", 1)
            den = int(den_s)
            info["fps"] = round(int(num_s) / den, 3) if den else 0.0
        except (ValueError, ZeroDivisionError):
            info["fps"] = 0.0
    if as_:
        info["audio_codec"] = str(as_.get("codec_name", "unknown"))
        info["channels"] = int(as_.get("channels", 2) or 2)
        info["sample_rate"] = str(as_.get("sample_rate", "44100"))
    return info


def _check_capabilities() -> dict[str, Any]:
    caps: dict[str, Any] = {
        "has_ffmpeg": False,
        "has_ffprobe": False,
        "version": "unknown",
        "encoders": [],
        "hwaccel": [],
    }
    try:
        ver_r = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=False,
            **_popen_kwargs(),
        )
        if ver_r.returncode == 0:
            caps["has_ffmpeg"] = True
            match = re.search(r"ffmpeg version (\S+)", ver_r.stdout)
            if match:
                caps["version"] = match.group(1).split("-")[0].strip()
    except (OSError, subprocess.TimeoutExpired) as err:
        logger.warning("ffmpeg version check failed: %s", err)

    if caps["has_ffmpeg"]:
        try:
            enc_r = subprocess.run(
                ["ffmpeg", "-encoders"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                check=False,
                **_popen_kwargs(),
            )
            if enc_r.returncode == 0:
                for enc in (
                    "libx264",
                    "libx265",
                    "libvpx-vp9",
                    "libaom-av1",
                    "prores_ks",
                    "h264_nvenc",
                    "hevc_nvenc",
                    "h264_qsv",
                    "hevc_qsv",
                ):
                    if f" {enc} " in enc_r.stdout or f"\n {enc} " in enc_r.stdout:
                        caps["encoders"].append(enc)
        except (OSError, subprocess.TimeoutExpired) as err:
            logger.warning("ffmpeg encoder check failed: %s", err)

        try:
            hw_r = subprocess.run(
                ["ffmpeg", "-hwaccels"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                check=False,
                **_popen_kwargs(),
            )
            if hw_r.returncode == 0:
                lines = {line.strip() for line in hw_r.stdout.splitlines()}
                for hw in ("cuda", "qsv"):
                    if hw in lines:
                        caps["hwaccel"].append(hw)
        except (OSError, subprocess.TimeoutExpired) as err:
            logger.warning("ffmpeg hwaccel check failed: %s", err)

    try:
        probe_r = subprocess.run(
            ["ffprobe", "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            check=False,
            **_popen_kwargs(),
        )
        caps["has_ffprobe"] = probe_r.returncode == 0
    except (OSError, subprocess.TimeoutExpired) as err:
        logger.warning("ffprobe check failed: %s", err)

    return caps


def _get_capabilities() -> dict[str, Any]:
    with _caps_lock:
        if not CAPABILITIES:
            CAPABILITIES.update(_check_capabilities())
        return dict(CAPABILITIES)


# ── TTL Cleanup ──────────────────────────────────────────────────────────────
def cleanup_expired_jobs(
    *,
    now: float | None = None,
    ttl_seconds: float | None = None,
    delete_files: bool = False,
) -> int:
    """Evict expired finished jobs from memory (and optionally delete their outputs)."""
    current = time.time() if now is None else now
    ttl = float(JOB_TTL_SECONDS if ttl_seconds is None else ttl_seconds)
    expired_outputs: list[str] = []
    evicted = 0

    with _jobs_lock:
        to_remove: list[str] = []
        for jid, job in _jobs.items():
            finished_at = job.get("finished_at")
            if job.get("done") and finished_at is not None and (current - finished_at) >= ttl:
                to_remove.append(jid)
                if delete_files and job.get("output"):
                    expired_outputs.append(str(job["output"]))
        for jid in to_remove:
            _jobs.pop(jid, None)
            _cancel_flags.discard(jid)
            evicted += 1

        if delete_files:
            expired_uploads = [
                uname for uname, ts in _session_uploads.items() if (current - ts) >= ttl
            ]
            for uname in expired_uploads:
                _session_uploads.pop(uname, None)
                try:
                    _safe_resolve(UPLOAD_DIR, uname).unlink(missing_ok=True)
                except (ValidationError, OSError) as err:
                    logger.debug("Could not remove expired upload %s: %s", uname, err)

    if delete_files:
        for out_name in expired_outputs:
            try:
                _safe_resolve(OUTPUT_DIR, out_name).unlink(missing_ok=True)
            except (ValidationError, OSError) as err:
                logger.debug("Could not remove expired output %s: %s", out_name, err)

    return evicted


# ── Validated Server-Side FFmpeg Command Builder ─────────────────────────────
def _validate_audio_params(
    options: dict[str, Any],
    out_ext: str,
    *,
    speed: float,
) -> list[str]:
    """Validate audio options and build FFmpeg audio flags."""
    raw_ac = str(options.get("ac") or "").strip().lower()
    ac = raw_ac or DEFAULT_AUDIO_CODEC_FOR_FMT[out_ext]

    if ac not in ALLOWED_AUDIO_CODECS:
        raise ValidationError(f"Unsupported audio codec: '{ac}'")
    allowed_for_fmt = CONTAINER_AUDIO_CODECS.get(out_ext, frozenset())
    if ac not in allowed_for_fmt:
        raise ValidationError(
            f"Audio codec '{ac}' is incompatible with format '{out_ext}' "
            f"(supported: {', '.join(sorted(allowed_for_fmt))})"
        )

    raw_sr = options.get("sr")
    sr: int | None = None
    if raw_sr is not None and str(raw_sr).strip() not in {"", "original", "auto"}:
        sr = _parse_int(raw_sr, default=48000, min_val=8000, max_val=96000, name="sr")
        if sr not in ALLOWED_SAMPLE_RATES:
            raise ValidationError(f"Unsupported sample rate: {sr}")
        if ac == "libopus" and sr not in OPUS_SAMPLE_RATES:
            raise ValidationError(
                f"libopus only supports sample rates {sorted(OPUS_SAMPLE_RATES)}, got {sr}"
            )
        if ac == "libmp3lame" and sr > 48000:
            raise ValidationError("libmp3lame supports sample rates up to 48000 Hz")

    raw_ch = options.get("ch")
    ch: int | None = None
    if raw_ch is not None and str(raw_ch).strip() not in {"", "original", "auto"}:
        ch = _parse_int(raw_ch, default=2, min_val=1, max_val=6, name="ch")
        if ch not in ALLOWED_CHANNELS:
            raise ValidationError(f"Unsupported channel count: {ch}")
        if ac == "libmp3lame" and ch > 2:
            raise ValidationError("libmp3lame supports at most 2 channels")

    vol = _parse_float(options.get("vol"), default=1.0, min_val=0.0, max_val=5.0, name="vol")
    norm = _parse_bool(options.get("norm"))

    af: list[str] = []
    if abs(vol - 1.0) > 1e-6:
        af.append(f"volume={vol:.2f}")
    if norm:
        af.append("loudnorm")
    if abs(speed - 1.0) > 1e-6:
        af.extend(_build_atempo_filters(speed))

    if ac == "copy" and (af or sr is not None or ch is not None):
        raise ValidationError("Cannot apply audio filters, sample rate, or channel changes with 'copy'")

    flags: list[str] = ["-c:a", ac]
    if ac not in {"copy", "flac", "pcm_s16le"}:
        ab_raw = options.get("ab")
        if ab_raw is not None and str(ab_raw).strip() != "":
            ab = _parse_bitrate(ab_raw, default="192k", min_kbps=32, max_kbps=512, name="ab")
            flags += ["-b:a", ab]
    if sr is not None:
        flags += ["-ar", str(sr)]
    if ch is not None:
        flags += ["-ac", str(ch)]
    if af:
        flags += ["-filter:a", ",".join(af)]
    return flags


def _sanitize_display_command(
    cmd: list[str],
    path_replacements: dict[str, str],
) -> str:
    """Build a human-readable FFmpeg command string with host paths redacted."""
    tokens = [path_replacements.get(tok, tok) for tok in cmd]
    return " ".join(tokens)


def build_ffmpeg_command(
    input_path: Path,
    output_dir: Path,
    job_id: str,
    options: dict[str, Any],
    duration: float = 0.0,
) -> tuple[list[str], Path, str, float]:
    """Validate structured CommandOptions and construct a safe FFmpeg argv list."""
    if not isinstance(options, dict):
        raise ValidationError("'options' must be a JSON object")

    for forbidden_key in ("args", "custom_args", "custom"):
        val = options.get(forbidden_key)
        if isinstance(val, str) and val.strip():
            raise ValidationError("Raw custom FFmpeg arguments are not permitted")
        if val and not isinstance(val, str):
            raise ValidationError("Raw custom FFmpeg arguments are not permitted")

    raw_mode = str(options.get("mode") or "convert").strip().lower()
    mode = "audio" if raw_mode == "extract_audio" else raw_mode
    if mode not in ALLOWED_MODES:
        raise ValidationError(f"Unsupported mode: '{mode}'")

    raw_fmt = str(options.get("fmt") or "").strip().lower()
    if mode == "convert" and raw_fmt == "gif":
        mode = "gif"

    # Trim parsing & validation (accurate -ss before -i + -t duration after -i)
    ts_start_parsed = _parse_timestamp(options.get("ts_start"), name="ts_start")
    ts_end_parsed = _parse_timestamp(options.get("ts_end"), name="ts_end")
    start_sec = ts_start_parsed[1] if ts_start_parsed is not None else 0.0
    end_sec = ts_end_parsed[1] if ts_end_parsed is not None else None

    trim_dur: float | None = None
    if end_sec is not None and end_sec > 0.0:
        if end_sec <= start_sec:
            raise ValidationError("Trim end time must be greater than trim start time")
        trim_dur = end_sec - start_sec

    if trim_dur is not None:
        eff_dur = trim_dur
    elif duration > 0 and start_sec > 0:
        eff_dur = max(0.0, duration - start_sec)
    else:
        eff_dur = max(0.0, duration)

    # Determine validated output extension & output path
    if mode == "thumbnail":
        out_ext = str(options.get("thFmt") or "jpg").strip().lower()
        if out_ext not in THUMBNAIL_FORMATS:
            raise ValidationError(f"Unsupported thumbnail format: '{out_ext}'")
    elif mode == "gif":
        out_ext = "gif"
    elif mode == "audio":
        out_ext = raw_fmt or "mp3"
        if out_ext not in AUDIO_FORMATS:
            raise ValidationError(f"Unsupported audio format: '{out_ext}'")
    else:
        out_ext = raw_fmt or "mp4"
        if out_ext not in VIDEO_FORMATS:
            raise ValidationError(f"Unsupported video format: '{out_ext}'")

    out_name = f"{job_id}.{out_ext}"
    out_path = _safe_resolve(output_dir, out_name)

    # ── THUMBNAIL ────────────────────────────────────────────────────────────
    if mode == "thumbnail":
        th_parsed = _parse_timestamp(options.get("thTime"), name="thTime")
        th_sec = th_parsed[1] if th_parsed is not None else 1.0
        if duration > 0 and th_sec >= duration:
            th_sec = max(0.0, round(duration * 0.5, 3))
        th_q = _parse_int(options.get("thQ"), default=90, min_val=1, max_val=100, name="thQ")
        cmd = ["ffmpeg", "-y", "-ss", f"{th_sec:.3f}", "-i", str(input_path), "-frames:v", "1"]
        if out_ext == "jpg":
            qscale = max(2, min(31, round(31 - (th_q / 100.0) * 29)))
            cmd += ["-q:v", str(qscale)]
        elif out_ext == "webp":
            cmd += ["-quality", str(th_q)]
        cmd.append(str(out_path))
        return cmd, out_path, out_name, 0.0

    # ── GIF (palettegen + paletteuse single-command) ─────────────────────────
    if mode == "gif":
        gif_fps = _parse_int(
            options.get("gifFps", options.get("gFps")),
            default=15,
            min_val=1,
            max_val=60,
            name="gifFps",
        )
        gif_w = _parse_int(
            options.get("gifW", options.get("gW")),
            default=480,
            min_val=64,
            max_val=1920,
            name="gifW",
        )
        gif_loop = _parse_int(
            options.get("gifLoop", options.get("gLoop")),
            default=0,
            min_val=-1,
            max_val=1000,
            name="gifLoop",
        )
        cmd = ["ffmpeg", "-y"]
        if start_sec > 0:
            cmd += ["-ss", f"{start_sec:.3f}"]
        cmd += ["-i", str(input_path)]
        if trim_dur is not None:
            cmd += ["-t", f"{trim_dur:.3f}"]
        fc = (
            f"[0:v]fps={gif_fps},scale={gif_w}:-2:flags=lanczos,split[s0][s1];"
            "[s0]palettegen[p];[s1][p]paletteuse"
        )
        cmd += ["-filter_complex", fc, "-loop", str(gif_loop), str(out_path)]
        return cmd, out_path, out_name, eff_dur

    # ── REMUX ────────────────────────────────────────────────────────────────
    if mode == "remux":
        cmd = ["ffmpeg", "-y"]
        if start_sec > 0:
            cmd += ["-ss", f"{start_sec:.3f}"]
        cmd += ["-i", str(input_path)]
        if trim_dur is not None:
            cmd += ["-t", f"{trim_dur:.3f}"]
        cmd += ["-c:v", "copy", "-c:a", "copy"]
        if _parse_bool(options.get("faststart", options.get("webOpt"))) and out_ext in {
            "mp4",
            "mov",
        }:
            cmd += ["-movflags", "+faststart"]
        if _parse_bool(options.get("noMeta")):
            cmd += ["-map_metadata", "-1"]
        cmd.append(str(out_path))
        return cmd, out_path, out_name, eff_dur

    # Shared speed validation (guard against speed <= 0 / division by zero)
    raw_speed = options.get("speed")
    if raw_speed is not None and raw_speed != "":
        try:
            speed_val = float(str(raw_speed).strip())
        except ValueError as err:
            raise ValidationError("Invalid number for 'speed'") from err
        if speed_val <= 0:
            raise ValidationError("'speed' must be greater than 0")
    speed = _parse_float(raw_speed, default=1.0, min_val=0.25, max_val=4.0, name="speed")

    raw_threads = options.get("threads")
    threads: int | None = None
    if raw_threads is not None and str(raw_threads).strip() not in {"", "auto"}:
        threads = _parse_int(raw_threads, default=0, min_val=0, max_val=64, name="threads")

    # ── AUDIO ────────────────────────────────────────────────────────────────
    if mode == "audio":
        audio_flags = _validate_audio_params(options, out_ext, speed=speed)
        cmd = ["ffmpeg", "-y"]
        if start_sec > 0:
            cmd += ["-ss", f"{start_sec:.3f}"]
        cmd += ["-i", str(input_path)]
        if trim_dur is not None:
            cmd += ["-t", f"{trim_dur:.3f}"]
        cmd += ["-vn", *audio_flags]
        if threads is not None:
            cmd += ["-threads", str(threads)]
        if _parse_bool(options.get("faststart", options.get("webOpt"))) and out_ext == "m4a":
            cmd += ["-movflags", "+faststart"]
        if _parse_bool(options.get("noMeta")):
            cmd += ["-map_metadata", "-1"]
        cmd.append(str(out_path))
        adjusted_dur = eff_dur / speed if eff_dur > 0 else 0.0
        return cmd, out_path, out_name, adjusted_dur

    # ── CONVERT (VIDEO) ──────────────────────────────────────────────────────
    raw_vc = str(options.get("vc") or "").strip().lower()
    vc = raw_vc or DEFAULT_VIDEO_CODEC_FOR_FMT[out_ext]
    if vc not in ALLOWED_VIDEO_CODECS:
        raise ValidationError(f"Unsupported video codec: '{vc}'")
    allowed_vc = CONTAINER_VIDEO_CODECS[out_ext]
    if vc not in allowed_vc:
        raise ValidationError(
            f"Video codec '{vc}' is incompatible with format '{out_ext}' "
            f"(supported: {', '.join(sorted(allowed_vc))})"
        )

    raw_hw = str(options.get("hw", options.get("hwaccel")) or "none").strip().lower()
    if raw_hw not in ALLOWED_HWACCELS:
        raise ValidationError(f"Unsupported hardware acceleration: '{raw_hw}'")
    if raw_hw != "none" and vc not in {"libx264", "libx265"}:
        raise ValidationError(f"Hardware acceleration '{raw_hw}' requires libx264 or libx265")

    cmd = ["ffmpeg", "-y"]
    # Input option: -hwaccel MUST appear before -i
    if raw_hw != "none" and vc != "copy":
        cmd += ["-hwaccel", raw_hw]
    if start_sec > 0:
        cmd += ["-ss", f"{start_sec:.3f}"]
    cmd += ["-i", str(input_path)]
    if trim_dur is not None:
        cmd += ["-t", f"{trim_dur:.3f}"]

    # Video filters
    vf: list[str] = []
    res = str(options.get("res") or "").strip().lower()
    if res and res != "original":
        if res in _RES_MAP:
            vf.append(f"scale={_RES_MAP[res]}")
        else:
            rmatch = RES_CUSTOM_RE.fullmatch(res)
            if not rmatch:
                raise ValidationError(f"Invalid resolution: '{res}'")
            w_val = int(rmatch.group(1))
            h_val = int(rmatch.group(2))
            if w_val < 64 or w_val > 7680 or (h_val > 0 and (h_val < 64 or h_val > 4320)):
                raise ValidationError(f"Resolution out of supported bounds: '{res}'")
            vf.append(f"scale={w_val}:{h_val}")

    rot = str(options.get("rot", options.get("rotate")) or "").strip().lower()
    if rot and rot != "none":
        if rot not in _ROT_MAP:
            raise ValidationError(f"Unsupported rotation: '{rot}'")
        vf.append(_ROT_MAP[rot])

    if abs(speed - 1.0) > 1e-6:
        vf.append(f"setpts={1.0 / speed:.4f}*PTS")

    crop_w_raw = options.get("cropW")
    crop_h_raw = options.get("cropH")
    if crop_w_raw and crop_h_raw:
        cw = _parse_int(crop_w_raw, default=0, min_val=1, max_val=7680, name="cropW")
        ch_crop = _parse_int(crop_h_raw, default=0, min_val=1, max_val=4320, name="cropH")
        cx = _parse_int(options.get("cropX"), default=0, min_val=0, max_val=7680, name="cropX")
        cy = _parse_int(options.get("cropY"), default=0, min_val=0, max_val=4320, name="cropY")
        vf.append(f"crop={cw}:{ch_crop}:{cx}:{cy}")

    if _parse_bool(options.get("deint")):
        vf.append("yadif")
    if _parse_bool(options.get("gray")):
        vf.append("hue=s=0")
    if _parse_bool(options.get("denoise", options.get("den"))):
        vf.append("hqdn3d")
    if _parse_bool(options.get("sharp")):
        vf.append("unsharp=5:5:1.0:5:5:0.0")

    if vc == "copy" and vf:
        raise ValidationError("Cannot apply video filters when video codec is 'copy'")
    if vf:
        cmd += ["-vf", ",".join(vf)]

    # Rate control & encoder flags
    rc = str(options.get("rc") or "").strip().lower()
    if rc and rc not in {"crf", "vbr"}:
        raise ValidationError(f"Unsupported rate control mode: '{rc}'")

    if vc == "copy":
        cmd += ["-c:v", "copy"]
    elif raw_hw == "cuda":
        nvenc = "hevc_nvenc" if vc == "libx265" else "h264_nvenc"
        cmd += ["-c:v", nvenc]
        if rc == "vbr" or (not rc and options.get("vbr")):
            vbr = _parse_bitrate(
                options.get("vbr"), default="4000k", min_kbps=100, max_kbps=200_000, name="vbr"
            )
            cmd += ["-b:v", vbr]
        elif options.get("crf") not in (None, ""):
            cq = _parse_int(options.get("crf"), default=23, min_val=0, max_val=51, name="crf")
            cmd += ["-cq", str(cq)]
    elif raw_hw == "qsv":
        qsv_enc = "hevc_qsv" if vc == "libx265" else "h264_qsv"
        cmd += ["-c:v", qsv_enc]
        if rc == "vbr" or (not rc and options.get("vbr")):
            vbr = _parse_bitrate(
                options.get("vbr"), default="4000k", min_kbps=100, max_kbps=200_000, name="vbr"
            )
            cmd += ["-b:v", vbr]
        elif options.get("crf") not in (None, ""):
            gq = _parse_int(options.get("crf"), default=23, min_val=1, max_val=51, name="crf")
            cmd += ["-global_quality", str(gq)]
    else:
        cmd += ["-c:v", vc]
        if vc == "libx265" and out_ext in {"mp4", "mov"}:
            cmd += ["-tag:v", "hvc1"]
        if vc == "prores_ks":
            cmd += ["-profile:v", "3"]

        use_vbr = rc == "vbr" or (not rc and bool(str(options.get("vbr") or "").strip()))
        if use_vbr and vc != "prores_ks":
            vbr = _parse_bitrate(
                options.get("vbr"), default="2500k", min_kbps=100, max_kbps=200_000, name="vbr"
            )
            cmd += ["-b:v", vbr]
        elif vc in {"libx264", "libx265"}:
            crf = _parse_int(options.get("crf"), default=23, min_val=0, max_val=51, name="crf")
            cmd += ["-crf", str(crf)]
        elif vc in {"libvpx-vp9", "libaom-av1"}:
            crf = _parse_int(options.get("crf"), default=30, min_val=0, max_val=63, name="crf")
            cmd += ["-crf", str(crf), "-b:v", "0"]

        preset = str(options.get("preset") or "").strip().lower()
        if preset:
            if preset not in ALLOWED_PRESETS:
                raise ValidationError(f"Unsupported preset: '{preset}'")
            if vc in {"libx264", "libx265"}:
                cmd += ["-preset", preset]

        tune = str(options.get("tune") or "").strip().lower()
        if tune and tune != "none":
            if vc == "libx264":
                if tune not in ALLOWED_TUNES_X264:
                    raise ValidationError(f"Unsupported libx264 tune: '{tune}'")
                cmd += ["-tune", tune]
            elif vc == "libx265":
                if tune not in ALLOWED_TUNES_X265:
                    raise ValidationError(f"Unsupported libx265 tune: '{tune}'")
                cmd += ["-tune", tune]
            else:
                raise ValidationError(f"'-tune' is not supported for video codec '{vc}'")

    raw_fps = options.get("fps")
    if raw_fps is not None and str(raw_fps).strip().lower() not in {"", "original", "auto"}:
        fps_val = _parse_float(raw_fps, default=30.0, min_val=1.0, max_val=240.0, name="fps")
        fps_str = f"{fps_val:.3f}".rstrip("0").rstrip(".")
        cmd += ["-r", fps_str]

    raw_pix = str(options.get("pixFmt") or "").strip().lower()
    if raw_pix and vc not in {"copy", "prores_ks"}:
        if raw_pix not in ALLOWED_PIX_FMTS:
            raise ValidationError(f"Unsupported pixel format: '{raw_pix}'")
        cmd += ["-pix_fmt", raw_pix]
    elif vc in {"libx264", "libx265"} and raw_hw == "none":
        cmd += ["-pix_fmt", "yuv420p"]

    raw_aspect = str(options.get("aspect") or "").strip().lower()
    if raw_aspect and raw_aspect != "auto":
        if raw_aspect not in ALLOWED_ASPECTS:
            raise ValidationError(f"Unsupported aspect ratio: '{raw_aspect}'")
        cmd += ["-aspect", raw_aspect]

    if threads is not None:
        cmd += ["-threads", str(threads)]

    if _parse_bool(options.get("noAudio")):
        cmd += ["-an"]
    else:
        cmd += _validate_audio_params(options, out_ext, speed=speed)

    if _parse_bool(options.get("faststart", options.get("webOpt"))) and out_ext in {"mp4", "mov"}:
        cmd += ["-movflags", "+faststart"]
    if _parse_bool(options.get("noMeta")):
        cmd += ["-map_metadata", "-1"]

    cmd.append(str(out_path))
    adjusted_dur = eff_dur / speed if eff_dur > 0 else 0.0
    return cmd, out_path, out_name, adjusted_dur


# ── Job Runner ───────────────────────────────────────────────────────────────
def _extract_error_summary(stderr_lines: collections.deque[str], returncode: int | None) -> str:
    """Build a concise, informative FFmpeg error summary from captured stderr."""
    non_progress = [
        line
        for line in stderr_lines
        if not line.startswith(("frame=", "size=")) and "time=" not in line
    ]
    tail = non_progress[-4:] if non_progress else list(stderr_lines)[-4:]
    if tail:
        return f"FFmpeg exited ({returncode}): {' | '.join(tail)}"
    return f"FFmpeg exited with code {returncode}"


def _run_job(
    job_id: str,
    cmd: list[str],
    out_path: Path,
    duration: float,
    cleanup_paths: list[Path] | None = None,
) -> None:
    start = time.time()
    stderr_ring: collections.deque[str] = collections.deque(maxlen=40)

    def _upd(**kw: Any) -> None:
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id].update(kw)

    def _is_cancelled() -> bool:
        with _jobs_lock:
            return job_id in _cancel_flags

    def _progress_handler(line: str) -> None:
        stripped = line.strip()
        if stripped:
            stderr_ring.append(stripped)
        pg = _parse_progress(line)
        if "time" in pg and duration > 0:
            t_sec = _seconds(pg["time"])
            pct = min(99.9, max(0.0, (t_sec / duration) * 100.0))
            elapsed = time.time() - start
            eta = max(0.0, elapsed / max(pct / 100.0, 0.001) - elapsed)
            _upd(
                progress=round(pct, 1),
                fps=float(pg.get("fps", 0)),
                frame=int(pg.get("frame", 0)),
                size_mb=round(int(pg.get("size_kb", 0)) / 1024.0, 2),
                eta_sec=round(eta),
            )

    def _drain_stderr(proc: subprocess.Popen[str]) -> None:
        """Sole reader of proc.stderr so no concurrent pipe reads occur."""
        pipe = proc.stderr
        if pipe is None:
            return
        try:
            for line in pipe:
                _progress_handler(line)
        except (OSError, ValueError) as err:
            logger.debug("stderr drain closed for job %s: %s", job_id, err)

    def _terminate_proc(proc: subprocess.Popen[str]) -> None:
        """Terminate process without ever reading stderr from another thread."""
        try:
            proc.kill()
        except OSError as err:
            logger.debug("kill failed for job %s: %s", job_id, err)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.warning("Timed out waiting for cancelled process in job %s", job_id)

    proc: subprocess.Popen[str] | None = None
    try:
        if _is_cancelled():
            _upd(status="cancelled", done=True, error="Cancelled", finished_at=time.time())
            return

        proc = subprocess.Popen(
            cmd,
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            **_popen_kwargs(),
        )
        with _jobs_lock:
            _processes[job_id] = proc
            already_cancelled = job_id in _cancel_flags

        drain_thread = threading.Thread(target=_drain_stderr, args=(proc,), daemon=True)
        drain_thread.start()

        if already_cancelled:
            _terminate_proc(proc)
        else:
            while proc.poll() is None:
                if _is_cancelled():
                    _terminate_proc(proc)
                    break
                time.sleep(0.05)

        drain_thread.join(timeout=3)

        # Remove temporary helper files (e.g. concat lists) before publishing
        # terminal job state so callers observing status=="done" never see them.
        if cleanup_paths:
            for extra in cleanup_paths:
                extra.unlink(missing_ok=True)

        if _is_cancelled():
            out_path.unlink(missing_ok=True)
            _upd(status="cancelled", done=True, error="Cancelled", finished_at=time.time())
        elif proc.returncode == 0 and out_path.is_file() and out_path.stat().st_size > 0:
            _upd(status="done", progress=100.0, done=True, error=None, finished_at=time.time())
        else:
            out_path.unlink(missing_ok=True)
            err_msg = _extract_error_summary(stderr_ring, proc.returncode)
            _upd(status="error", done=True, error=err_msg, finished_at=time.time())
    except OSError as err:
        out_path.unlink(missing_ok=True)
        _upd(status="error", done=True, error=f"Failed to run FFmpeg: {err}", finished_at=time.time())
    finally:
        with _jobs_lock:
            _processes.pop(job_id, None)
            _cancel_flags.discard(job_id)
        if cleanup_paths:
            for extra in cleanup_paths:
                extra.unlink(missing_ok=True)


# ── Routes ───────────────────────────────────────────────────────────────────
@app.route("/")
def index() -> Response | tuple[Response, int]:
    index_file = DIST_DIR / "index.html"
    if not index_file.is_file():
        hint = (
            "Frontend build not found (apps/local-server-web/dist/index.html is missing). "
            "Run 'npm run build' from the repository root, or start Vite dev server "
            "in apps/local-server-web."
        )
        if request.accept_mimetypes.best == "application/json":
            return jsonify({"error": hint}), 503
        html = (
            "<!doctype html><html><head><meta charset='utf-8'><title>FFmpeg UI - Build Required"
            "</title></head><body style='font-family:system-ui,sans-serif;padding:2rem;'>"
            "<h1>Frontend Build Missing</h1>"
            f"<p>{hint}</p>"
            "</body></html>"
        )
        return Response(html, status=503, mimetype="text/html")
    return send_from_directory(DIST_DIR, "index.html")


@app.route("/auth/token", methods=["GET"])
def auth_token() -> Response:
    resp = jsonify({"token": BOOT_TOKEN})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/capabilities", methods=["GET"])
def capabilities() -> Response:
    caps = _get_capabilities()
    return jsonify(
        {
            "has_ffmpeg": bool(caps.get("has_ffmpeg", False)),
            "has_ffprobe": bool(caps.get("has_ffprobe", False)),
            "version": str(caps.get("version", "unknown")),
            "encoders": list(caps.get("encoders", [])),
            "hwaccel": list(caps.get("hwaccel", [])),
        }
    )


@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_upload(filename: str) -> Response | tuple[Response, int]:
    """Serve validated media uploads inline for in-browser preview."""
    try:
        resolved = _safe_resolve(UPLOAD_DIR, filename)
        _validate_upload_extension(resolved.name)
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400
    if not resolved.is_file():
        return jsonify({"error": "Not found"}), 404
    resp = send_file(resolved, as_attachment=False)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Disposition"] = f'inline; filename="{resolved.name}"'
    return resp


@app.route("/upload", methods=["POST"])
def upload() -> tuple[Response, int] | Response:
    cleanup_expired_jobs(delete_files=True)
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Empty filename"}), 400
    try:
        ext = _validate_upload_extension(uploaded.filename)
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400

    uid = uuid.uuid4().hex
    stored_name = f"{uid}{ext}"
    try:
        dest = _safe_resolve(UPLOAD_DIR, stored_name)
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400

    uploaded.save(dest)
    with _jobs_lock:
        _session_uploads[stored_name] = time.time()

    return jsonify(
        {
            "file_id": uid,
            "stored_name": stored_name,
            "original_name": Path(uploaded.filename.replace("\\", "/")).name,
            "preview_url": f"/uploads/{stored_name}",
            "probe": _probe(dest),
        }
    )


@app.route("/probe", methods=["GET"])
def probe_route() -> tuple[Response, int] | Response:
    stored = request.args.get("file", "")
    if not stored:
        return jsonify({"error": "Missing 'file' query parameter"}), 400
    try:
        path = _safe_resolve(UPLOAD_DIR, stored)
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400
    if not path.is_file():
        return jsonify({"error": "File not found"}), 404
    probed = _probe(path)
    if probed is None:
        return jsonify({"error": "Probe failed: unable to inspect media file"}), 422
    return jsonify(probed)


@app.route("/merge-probe", methods=["POST"])
def merge_probe() -> tuple[Response, int] | Response:
    cleanup_expired_jobs(delete_files=True)
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files provided"}), 400

    results: list[dict[str, Any]] = []
    for uploaded in files:
        if not uploaded.filename:
            continue
        try:
            ext = _validate_upload_extension(uploaded.filename)
        except ValidationError as err:
            return jsonify({"error": str(err)}), 400
        uid = uuid.uuid4().hex
        stored_name = f"{uid}{ext}"
        dest = _safe_resolve(UPLOAD_DIR, stored_name)
        uploaded.save(dest)
        with _jobs_lock:
            _session_uploads[stored_name] = time.time()
        results.append(
            {
                "file_id": uid,
                "stored_name": stored_name,
                "original_name": Path(uploaded.filename.replace("\\", "/")).name,
                "preview_url": f"/uploads/{stored_name}",
                "probe": _probe(dest),
            }
        )

    mismatches: list[str] = []
    recommended: dict[str, Any] = {}
    if len(results) > 1:
        probes = [r["probe"] or {} for r in results]
        max_w = max((p.get("width", 0) for p in probes), default=0)
        max_h = max((p.get("height", 0) for p in probes), default=0)
        base_vc = probes[0].get("video_codec") if probes else None
        recommended = {"width": max_w, "height": max_h, "video_codec": base_vc}
        for item in results:
            p = item.get("probe") or {}
            if p.get("width") != max_w or p.get("height") != max_h:
                mismatches.append(
                    f"Resolution: '{item['original_name']}' is "
                    f"{p.get('width')}x{p.get('height')} (max {max_w}x{max_h})"
                )
            if base_vc and p.get("video_codec") != base_vc:
                mismatches.append(
                    f"Codec: '{item['original_name']}' is {p.get('video_codec')} != {base_vc}"
                )

    return jsonify(
        {
            "files": results,
            "compatible": len(mismatches) == 0,
            "mismatches": mismatches,
            "recommended": recommended,
        }
    )


@app.route("/convert", methods=["POST"])
def convert() -> tuple[Response, int] | Response:
    cleanup_expired_jobs(delete_files=True)
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 415
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    # Explicitly reject raw args[] or custom_args injection attempts
    if "args" in data or "custom_args" in data:
        return jsonify({"error": "Raw FFmpeg args are not permitted; pass structured 'options'"}), 400

    stored_name = data.get("stored_name")
    if not isinstance(stored_name, str) or not stored_name:
        return jsonify({"error": "Missing 'stored_name'"}), 400
    try:
        input_path = _safe_resolve(UPLOAD_DIR, stored_name)
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400
    if not input_path.is_file():
        return jsonify({"error": "Input file not found"}), 404

    options = data.get("options")
    if not isinstance(options, dict):
        return jsonify({"error": "Missing or invalid 'options' object"}), 400

    orig_name = str(data.get("original_name") or stored_name)
    safe_orig_stem = _sanitize_download_stem(orig_name)
    probe_data = _probe(input_path)
    orig_dur = float((probe_data or {}).get("duration", 0.0))

    job_id = uuid.uuid4().hex
    try:
        cmd, out_path, out_name, eff_dur = build_ffmpeg_command(
            input_path, OUTPUT_DIR, job_id, options, duration=orig_dur
        )
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400

    cmd_display = _sanitize_display_command(
        cmd,
        {
            str(input_path): input_path.name,
            str(out_path): out_name,
        },
    )

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "processing",
            "progress": 0.0,
            "fps": 0.0,
            "frame": 0,
            "size_mb": 0.0,
            "eta_sec": 0,
            "done": False,
            "error": None,
            "output": out_name,
            "orig_name": safe_orig_stem,
            "command": cmd_display,
            "created_at": time.time(),
            "finished_at": None,
        }

    threading.Thread(
        target=_run_job,
        args=(job_id, cmd, out_path, eff_dur),
        daemon=True,
    ).start()
    return jsonify({"job_id": job_id, "command": cmd_display})


@app.route("/merge", methods=["POST"])
def merge() -> tuple[Response, int] | Response:
    cleanup_expired_jobs(delete_files=True)
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 415
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    files = data.get("files")
    if not isinstance(files, list) or len(files) < 2:
        return jsonify({"error": "Need at least 2 files to merge"}), 400

    fmt = str(data.get("output_format") or "mp4").strip().lower()
    if fmt not in (VIDEO_FORMATS | AUDIO_FORMATS):
        return jsonify({"error": f"Unsupported merge output format: '{fmt}'"}), 400

    reencode = _parse_bool(data.get("force_reencode"))
    re_params = data.get("reencode_params") or {}
    if not isinstance(re_params, dict):
        return jsonify({"error": "'reencode_params' must be an object"}), 400

    resolved_paths: list[Path] = []
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("stored_name"), str):
            return jsonify({"error": "Each merge item must include a valid 'stored_name'"}), 400
        try:
            resolved = _safe_resolve(UPLOAD_DIR, item["stored_name"])
        except ValidationError as err:
            return jsonify({"error": str(err)}), 400
        if not resolved.is_file():
            return jsonify({"error": f"Input file not found: {item['stored_name']}"}), 404
        resolved_paths.append(resolved)

    job_id = uuid.uuid4().hex
    out_name = f"{job_id}.{fmt}"
    try:
        out_path = _safe_resolve(OUTPUT_DIR, out_name)
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400

    # Place concat list in UPLOAD_DIR with strictly relative filenames ([0-9a-f]{32}.ext)
    # so FFmpeg concat demuxer operates in default safe mode WITHOUT -safe 0!
    concat_name = f"concat_{job_id}.txt"
    concat_txt = UPLOAD_DIR.resolve() / concat_name
    try:
        with concat_txt.open("w", encoding="utf-8", newline="\n") as cf:
            for resolved in resolved_paths:
                cf.write(f"file '{resolved.name}'\n")
    except OSError as err:
        concat_txt.unlink(missing_ok=True)
        return jsonify({"error": f"Failed to write concat list: {err}"}), 500

    cmd: list[str] = ["ffmpeg", "-y", "-f", "concat", "-i", str(concat_txt)]
    try:
        if reencode:
            if fmt in VIDEO_FORMATS:
                vc = str(
                    re_params.get("codec_video") or DEFAULT_VIDEO_CODEC_FOR_FMT[fmt]
                ).strip().lower()
                if vc not in CONTAINER_VIDEO_CODECS[fmt] or vc == "copy":
                    raise ValidationError(f"Invalid re-encode video codec '{vc}' for '{fmt}'")
                crf = _parse_int(re_params.get("crf"), default=23, min_val=0, max_val=51, name="crf")
                ac = str(
                    re_params.get("codec_audio") or DEFAULT_AUDIO_CODEC_FOR_FMT[fmt]
                ).strip().lower()
                if ac not in CONTAINER_AUDIO_CODECS[fmt] or ac == "copy":
                    raise ValidationError(f"Invalid re-encode audio codec '{ac}' for '{fmt}'")
                cmd += ["-c:v", vc, "-crf", str(crf)]
                if vc in {"libvpx-vp9", "libaom-av1"}:
                    cmd += ["-b:v", "0"]
                cmd += ["-c:a", ac]
                res = str(re_params.get("resolution") or "").strip().lower()
                if res and res != "original":
                    if res in _RES_MAP:
                        cmd += ["-vf", f"scale={_RES_MAP[res]}"]
                    elif RES_CUSTOM_RE.fullmatch(res):
                        cmd += ["-vf", f"scale={res}"]
                    else:
                        raise ValidationError(f"Invalid merge resolution: '{res}'")
            else:
                ac = str(
                    re_params.get("codec_audio") or DEFAULT_AUDIO_CODEC_FOR_FMT[fmt]
                ).strip().lower()
                if ac not in CONTAINER_AUDIO_CODECS[fmt] or ac == "copy":
                    raise ValidationError(f"Invalid re-encode audio codec '{ac}' for '{fmt}'")
                cmd += ["-vn", "-c:a", ac]
        else:
            cmd += ["-c", "copy"]
    except ValidationError as err:
        concat_txt.unlink(missing_ok=True)
        return jsonify({"error": str(err)}), 400

    cmd.append(str(out_path))

    total_dur = sum(float((_probe(p) or {}).get("duration", 0.0)) for p in resolved_paths)
    cmd_display = _sanitize_display_command(
        cmd,
        {
            str(concat_txt): concat_name,
            str(out_path): out_name,
        },
    )

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "processing",
            "progress": 0.0,
            "fps": 0.0,
            "frame": 0,
            "size_mb": 0.0,
            "eta_sec": 0,
            "done": False,
            "error": None,
            "output": out_name,
            "orig_name": "merged",
            "command": cmd_display,
            "created_at": time.time(),
            "finished_at": None,
        }

    threading.Thread(
        target=_run_job,
        args=(job_id, cmd, out_path, total_dur, [concat_txt]),
        daemon=True,
    ).start()
    return jsonify({"job_id": job_id, "command": cmd_display})


@app.route("/progress/<job_id>", methods=["GET"])
def progress(job_id: str) -> Response | tuple[Response, int]:
    if not JOB_ID_RE.fullmatch(job_id):
        return jsonify({"error": "Invalid job_id"}), 400
    with _jobs_lock:
        if job_id not in _jobs:
            return jsonify({"error": "Job not found"}), 404

    def generate() -> Iterator[str]:
        while True:
            with _jobs_lock:
                job = dict(_jobs.get(job_id, {}))
            if not job:
                yield f"data: {json.dumps({'job_id': job_id, 'status': 'error', 'done': True, 'error': 'Job not found'})}\n\n"
                return
            payload: dict[str, Any] = {
                "job_id": job_id,
                "status": job.get("status", "processing"),
                "progress": job.get("progress", 0.0),
                "fps": job.get("fps", 0.0),
                "frame": job.get("frame", 0),
                "size_mb": job.get("size_mb", 0.0),
                "eta_sec": job.get("eta_sec", 0),
                "done": bool(job.get("done", False)),
                "error": job.get("error"),
            }
            if job.get("done") and job.get("status") == "done":
                payload["output"] = job.get("output")
            yield f"data: {json.dumps(payload)}\n\n"
            if job.get("done"):
                return
            time.sleep(0.25)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/cancel", methods=["POST"])
def cancel() -> tuple[Response, int] | Response:
    data = request.get_json(silent=True) or request.form or {}
    job_id = data.get("job_id")
    if not isinstance(job_id, str) or not JOB_ID_RE.fullmatch(job_id):
        return jsonify({"error": "Missing or invalid 'job_id'"}), 400

    with _jobs_lock:
        _cancel_flags.add(job_id)
        proc = _processes.get(job_id)
        if job_id in _jobs and not _jobs[job_id].get("done"):
            _jobs[job_id].update(
                status="cancelled",
                done=True,
                error="Cancelled",
                finished_at=time.time(),
            )

    if proc is not None:
        try:
            proc.kill()
        except OSError as err:
            logger.debug("Process already exited during cancel for job %s: %s", job_id, err)

    return jsonify({"ok": True, "job_id": job_id})


@app.route("/download/<job_id>", methods=["GET"])
def download(job_id: str) -> Response | tuple[Response, int]:
    if not JOB_ID_RE.fullmatch(job_id):
        return jsonify({"error": "Invalid job_id"}), 400
    with _jobs_lock:
        job = dict(_jobs.get(job_id, {}))
    if not job or not job.get("output"):
        return jsonify({"error": "Job not found"}), 404
    try:
        path = _safe_resolve(OUTPUT_DIR, str(job["output"]))
    except ValidationError as err:
        return jsonify({"error": str(err)}), 400
    if not path.is_file():
        return jsonify({"error": "Output file missing"}), 404
    stem = _sanitize_download_stem(str(job.get("orig_name", "output")))
    return send_file(path, as_attachment=True, download_name=f"{stem}_converted{path.suffix}")


def _stream_and_unlink(path: Path, chunk_size: int = 65536) -> Iterator[bytes]:
    try:
        with path.open("rb") as fh:
            while chunk := fh.read(chunk_size):
                yield chunk
    finally:
        path.unlink(missing_ok=True)


@app.route("/download-all", methods=["POST"])
def download_all() -> Response | tuple[Response, int]:
    data = request.get_json(silent=True) or {}
    job_ids = data.get("job_ids")
    if not isinstance(job_ids, list) or not job_ids:
        return jsonify({"error": "Missing or empty 'job_ids' list"}), 400

    entries: list[tuple[Path, str]] = []
    seen_arcnames: dict[str, int] = {}
    for jid in job_ids:
        if not isinstance(jid, str) or not JOB_ID_RE.fullmatch(jid):
            continue
        with _jobs_lock:
            job = dict(_jobs.get(jid, {}))
        if job.get("status") != "done" or not job.get("output"):
            continue
        try:
            out_path = _safe_resolve(OUTPUT_DIR, str(job["output"]))
        except ValidationError:
            continue
        if not out_path.is_file():
            continue
        stem = _sanitize_download_stem(str(job.get("orig_name", "output")))
        base_arc = f"{stem}_converted{out_path.suffix}"
        count = seen_arcnames.get(base_arc, 0)
        seen_arcnames[base_arc] = count + 1
        arcname = base_arc if count == 0 else f"{stem}_converted_{count + 1}{out_path.suffix}"
        entries.append((out_path, arcname))

    if not entries:
        return jsonify({"error": "No completed job outputs available for download"}), 404

    with tempfile.NamedTemporaryFile(
        prefix="ffmpeg_ui_batch_", suffix=".zip", delete=False
    ) as tmp:
        tmp_path = Path(tmp.name)

    try:
        with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for file_path, arcname in entries:
                zf.write(file_path, arcname)
    except OSError as err:
        tmp_path.unlink(missing_ok=True)
        return jsonify({"error": f"Failed to build batch ZIP: {err}"}), 500

    return Response(
        stream_with_context(_stream_and_unlink(tmp_path)),
        mimetype="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="batch_converted.zip"',
            "Cache-Control": "no-store",
        },
    )


@app.route("/job/<job_id>", methods=["GET"])
def job_status(job_id: str) -> Response | tuple[Response, int]:
    if not JOB_ID_RE.fullmatch(job_id):
        return jsonify({"error": "Invalid job_id"}), 400
    with _jobs_lock:
        job = dict(_jobs.get(job_id, {}))
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(
        {
            "job_id": job_id,
            "status": job.get("status"),
            "progress": job.get("progress", 0.0),
            "fps": job.get("fps", 0.0),
            "frame": job.get("frame", 0),
            "size_mb": job.get("size_mb", 0.0),
            "eta_sec": job.get("eta_sec", 0),
            "done": bool(job.get("done", False)),
            "error": job.get("error"),
            "output": job.get("output"),
            "command": job.get("command"),
        }
    )


# ── Startup ──────────────────────────────────────────────────────────────────
def _log_startup_banner() -> None:
    logger.info("Checking FFmpeg capabilities...")
    caps = _get_capabilities()
    logger.info("  FFmpeg  : %s (available=%s)", caps["version"], caps["has_ffmpeg"])
    logger.info("  FFprobe : available=%s", caps["has_ffprobe"])
    logger.info("  Encoders: %s", caps["encoders"])
    logger.info("  HW Accel: %s", caps["hwaccel"])
    if not (DIST_DIR / "index.html").is_file():
        logger.warning(
            "Frontend build missing at %s. Run 'npm run build' from the repository root first.",
            DIST_DIR / "index.html",
        )
    logger.info("Starting server at http://127.0.0.1:5000")


if __name__ == "__main__":
    _log_startup_banner()
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
