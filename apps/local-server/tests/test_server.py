from __future__ import annotations

import io
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

# Ensure apps/local-server is importable regardless of pytest invocation cwd
SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import server

if TYPE_CHECKING:
    from flask.testing import FlaskClient


def _make_wav(path: Path, duration_sec: float = 1.0) -> Path:
    res = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={duration_sec}",
            "-ar",
            "44100",
            "-ac",
            "2",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert res.returncode == 0, f"Failed to synthesize WAV: {res.stderr}"
    return path


def _make_mp4(path: Path, duration_sec: float = 2.0) -> Path:
    res = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=duration={duration_sec}:size=320x240:rate=15",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={duration_sec}",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert res.returncode == 0, f"Failed to synthesize MP4: {res.stderr}"
    return path


@pytest.fixture
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """Isolate UPLOAD_DIR, OUTPUT_DIR, and in-memory job tables so real repo folders stay untouched."""
    uploads = tmp_path / "uploads"
    outputs = tmp_path / "outputs"
    uploads.mkdir()
    outputs.mkdir()

    monkeypatch.setattr(server, "UPLOAD_DIR", uploads)
    monkeypatch.setattr(server, "OUTPUT_DIR", outputs)

    with server._jobs_lock:
        server._jobs.clear()
        server._processes.clear()
        server._cancel_flags.clear()
        server._session_uploads.clear()

    return {"uploads": uploads, "outputs": outputs, "root": tmp_path}


@pytest.fixture
def client(isolated_env: dict[str, Path]) -> FlaskClient:
    _ = isolated_env
    server.app.config["TESTING"] = True
    return server.app.test_client()


@pytest.fixture
def auth_headers(client: FlaskClient) -> dict[str, str]:
    resp = client.get("/auth/token", headers={"Origin": "http://localhost:5173"})
    assert resp.status_code == 200
    token = resp.get_json()["token"]
    return {"X-Local-Token": token}


def _upload_file(client: FlaskClient, headers: dict[str, str], path: Path, filename: str) -> dict[str, Any]:
    with path.open("rb") as fh:
        resp = client.post(
            "/upload",
            headers=headers,
            data={"file": (io.BytesIO(fh.read()), filename)},
            content_type="multipart/form-data",
        )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return resp.get_json()


def _wait_for_job(client: FlaskClient, headers: dict[str, str], job_id: str, timeout: float = 20.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/job/{job_id}", headers=headers)
        assert resp.status_code == 200
        body = resp.get_json()
        if body["done"]:
            return body
        time.sleep(0.1)
    raise AssertionError(f"Job {job_id} did not finish within {timeout}s")


# ── 1. CORS & Token Authentication ───────────────────────────────────────────
def test_cors_rejects_untrusted_origin_and_accepts_localhost(client: FlaskClient) -> None:
    bad_token = client.get("/auth/token", headers={"Origin": "https://evil.com"})
    assert bad_token.status_code == 403
    assert "Access-Control-Allow-Origin" not in bad_token.headers

    bad_preflight = client.options(
        "/convert",
        headers={
            "Origin": "https://evil.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type, X-Local-Token",
        },
    )
    assert bad_preflight.status_code == 403
    assert "Access-Control-Allow-Origin" not in bad_preflight.headers

    ok_token = client.get("/auth/token", headers={"Origin": "http://localhost:5173"})
    assert ok_token.status_code == 200
    assert ok_token.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
    assert ok_token.headers.get("Cache-Control") == "no-store"
    assert ok_token.get_json()["token"] == server.BOOT_TOKEN

    ok_preflight = client.options(
        "/convert",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type, X-Local-Token",
        },
    )
    assert ok_preflight.status_code in (200, 204)
    assert ok_preflight.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"


def test_token_auth_enforcement_across_routes(client: FlaskClient, auth_headers: dict[str, str]) -> None:
    fake_id = "a" * 32
    fake_file = f"{'a' * 32}.mp4"

    # Unauthenticated requests to all protected routes must return 401
    assert client.post("/upload").status_code == 401
    assert client.get(f"/probe?file={fake_file}").status_code == 401
    assert client.post("/convert", json={}).status_code == 401
    assert client.post("/merge", json={}).status_code == 401
    assert client.post("/cancel", json={"job_id": fake_id}).status_code == 401
    assert client.post("/download-all", json={"job_ids": [fake_id]}).status_code == 401
    assert client.get(f"/job/{fake_id}").status_code == 401
    assert client.get(f"/progress/{fake_id}").status_code == 401
    assert client.get(f"/download/{fake_id}").status_code == 401
    assert client.get(f"/uploads/{fake_file}").status_code == 401

    # Wrong token must return 401
    assert client.get(f"/job/{fake_id}", headers={"X-Local-Token": "wrong"}).status_code == 401

    # Query param token is NOT accepted on mutation routes
    token = auth_headers["X-Local-Token"]
    assert client.post(f"/convert?token={token}", json={}).status_code == 401

    # Public routes work without token
    caps = client.get("/capabilities")
    assert caps.status_code == 200
    caps_json = caps.get_json()
    assert caps_json["has_ffmpeg"] is True
    assert caps_json["has_ffprobe"] is True
    assert isinstance(caps_json["version"], str) and caps_json["version"] != "unknown"

    # Authenticated unknown job returns 404 (not 200)
    missing = client.get(f"/job/{fake_id}", headers=auth_headers)
    assert missing.status_code == 404


# ── 2. Path Traversal & Upload Allowlist ─────────────────────────────────────
@pytest.mark.parametrize(
    "bad_name",
    [
        "../server.py",
        "..\\server.py",
        "/etc/passwd",
        "C:\\Windows\\win.ini",
        "subdir/abcd.mp4",
        "not-a-hex-uuid.mp4",
        "a" * 32 + ".html",
    ],
)
def test_path_traversal_rejected(
    client: FlaskClient,
    auth_headers: dict[str, str],
    bad_name: str,
) -> None:
    probe_resp = client.get("/probe", query_string={"file": bad_name}, headers=auth_headers)
    if bad_name.endswith(".html"):
        # Valid hex + .html passes STORED_NAME_RE on /probe only if not checked by media ext,
        # OR does not exist -> 404; uploads endpoint must reject .html with 400!
        assert probe_resp.status_code in (400, 404)
    else:
        assert probe_resp.status_code == 400

    conv_resp = client.post(
        "/convert",
        headers=auth_headers,
        json={"stored_name": bad_name, "options": {"mode": "convert", "fmt": "mp4"}},
    )
    if bad_name.endswith(".html"):
        assert conv_resp.status_code in (400, 404)
    else:
        assert conv_resp.status_code == 400

    merge_resp = client.post(
        "/merge",
        headers=auth_headers,
        json={"files": [{"stored_name": bad_name}, {"stored_name": bad_name}], "output_format": "mp4"},
    )
    if bad_name.endswith(".html"):
        assert merge_resp.status_code in (400, 404)
    else:
        assert merge_resp.status_code == 400

    up_resp = client.get(f"/uploads/{bad_name}", headers=auth_headers)
    if bad_name.startswith("/"):
        # Leading slash produces /uploads//etc/passwd -> blocked by Flask routing (404),
        # while _safe_resolve rejects absolute paths directly with ValidationError.
        assert up_resp.status_code in (400, 404)
        with pytest.raises(server.ValidationError):
            server._safe_resolve(server.UPLOAD_DIR, bad_name)
    else:
        assert up_resp.status_code == 400


@pytest.mark.parametrize("bad_filename", ["xss.html", "vector.svg", "payload.js", "run.sh", "run.bat", "bin.exe", "noext"])
def test_upload_rejects_disallowed_extensions(
    client: FlaskClient,
    auth_headers: dict[str, str],
    bad_filename: str,
) -> None:
    resp = client.post(
        "/upload",
        headers=auth_headers,
        data={"file": (io.BytesIO(b"<script>alert(1)</script>"), bad_filename)},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400


def test_upload_allows_media_and_serves_with_nosniff_inline(
    client: FlaskClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    wav = _make_wav(tmp_path / "tone.wav", duration_sec=0.5)
    uploaded = _upload_file(client, auth_headers, wav, "tone.wav")
    stored = uploaded["stored_name"]
    assert server.STORED_NAME_RE.fullmatch(stored)
    assert uploaded["probe"]["duration"] > 0

    # Serve via query token (as <audio>/<video> does)
    token = auth_headers["X-Local-Token"]
    serve_resp = client.get(f"/uploads/{stored}?token={token}")
    assert serve_resp.status_code == 200
    assert serve_resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert "inline" in serve_resp.headers.get("Content-Disposition", "")


def test_probe_corrupt_file_returns_422_and_oversize_returns_413(
    client: FlaskClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad_mp4 = client.post(
        "/upload",
        headers=auth_headers,
        data={"file": (io.BytesIO(b"not a real mp4 file"), "broken.mp4")},
        content_type="multipart/form-data",
    )
    assert bad_mp4.status_code == 200
    stored = bad_mp4.get_json()["stored_name"]

    probe_resp = client.get("/probe", query_string={"file": stored}, headers=auth_headers)
    assert probe_resp.status_code == 422

    monkeypatch.setitem(server.app.config, "MAX_CONTENT_LENGTH", 64)
    big_resp = client.post(
        "/upload",
        headers=auth_headers,
        data={"file": (io.BytesIO(b"0" * 512), "huge.mp4")},
        content_type="multipart/form-data",
    )
    assert big_resp.status_code == 413
    assert "error" in big_resp.get_json()


# ── 3. Server-Side Command Validation & FFmpeg Bug Fixes ─────────────────────
def test_command_builder_rejects_injection_and_invalid_options(
    client: FlaskClient,
    auth_headers: dict[str, str],
    isolated_env: dict[str, Path],
    tmp_path: Path,
) -> None:
    mp4 = _make_mp4(tmp_path / "sample.mp4", duration_sec=1.0)
    uploaded = _upload_file(client, auth_headers, mp4, "sample.mp4")
    stored = uploaded["stored_name"]

    # Raw args[] rejected
    r_args = client.post(
        "/convert",
        headers=auth_headers,
        json={"stored_name": stored, "args": ["-i", "x", "y"], "options": {"mode": "convert", "fmt": "mp4"}},
    )
    assert r_args.status_code == 400

    # custom_args / options.custom rejected
    r_custom = client.post(
        "/convert",
        headers=auth_headers,
        json={"stored_name": stored, "options": {"mode": "convert", "fmt": "mp4", "custom": "-vf movie=/etc/passwd"}},
    )
    assert r_custom.status_code == 400

    # Legacy form-data rejected (415)
    r_form = client.post(
        "/convert",
        headers=auth_headers,
        data={"stored_name": stored, "custom_args": "-h"},
    )
    assert r_form.status_code == 415

    # Unit-test invalid structured options directly
    in_path = isolated_env["uploads"] / stored
    job_id = "b" * 32
    bad_cases = [
        {"mode": "convert", "fmt": "exe"},
        {"mode": "convert", "fmt": "mp4", "vc": "evil_codec"},
        {"mode": "convert", "fmt": "webm", "vc": "libx264"},
        {"mode": "audio", "fmt": "mp3", "ac": "aac"},
        {"mode": "convert", "fmt": "mp4", "ac": "opus"},  # experimental opus rejected; use libopus
        {"mode": "convert", "fmt": "mp4", "crf": 99},
        {"mode": "convert", "fmt": "mp4", "speed": 0},
        {"mode": "convert", "fmt": "mp4", "speed": -1},
        {"mode": "convert", "fmt": "mp4", "ts_start": "00:00:05", "ts_end": "00:00:02"},
        {"mode": "convert", "fmt": "mp4", "vc": "copy", "gray": True},
        {"mode": "audio", "fmt": "mp3", "ac": "copy", "vol": 0.5},
    ]
    for opts in bad_cases:
        with pytest.raises(server.ValidationError):
            server.build_ffmpeg_command(in_path, isolated_env["outputs"], job_id, opts, duration=10.0)


def test_command_builder_fixes_hwaccel_atempo_vol_trim_gif_thumb_and_seconds(
    isolated_env: dict[str, Path],
) -> None:
    in_path = isolated_env["uploads"] / ("c" * 32 + ".mp4")
    in_path.write_bytes(b"stub")
    out_dir = isolated_env["outputs"]
    jid = "d" * 32

    # _seconds handles MM:SS and HH:MM:SS properly
    assert server._seconds("01:30") == pytest.approx(90.0)
    assert server._seconds("01:02:03.5") == pytest.approx(3723.5)
    assert server._seconds("12.5") == pytest.approx(12.5)

    # -hwaccel BEFORE -i (cuda + qsv HEVC)
    cmd_cuda, _, _, _ = server.build_ffmpeg_command(
        in_path, out_dir, jid, {"mode": "convert", "fmt": "mp4", "vc": "libx264", "hw": "cuda"}
    )
    assert cmd_cuda.index("-hwaccel") < cmd_cuda.index("-i")
    assert cmd_cuda[cmd_cuda.index("-c:v") + 1] == "h264_nvenc"

    cmd_qsv, _, _, _ = server.build_ffmpeg_command(
        in_path, out_dir, jid, {"mode": "convert", "fmt": "mp4", "vc": "libx265", "hw": "qsv"}
    )
    assert cmd_qsv.index("-hwaccel") < cmd_qsv.index("-i")
    assert cmd_qsv[cmd_qsv.index("-c:v") + 1] == "hevc_qsv"

    # atempo chaining for 0.25x and 4.0x + vol=0 mute
    cmd_slow, _, _, _ = server.build_ffmpeg_command(
        in_path,
        out_dir,
        jid,
        {"mode": "convert", "fmt": "mp4", "vc": "libx264", "ac": "aac", "speed": 0.25, "vol": 0},
    )
    af_val = cmd_slow[cmd_slow.index("-filter:a") + 1]
    assert "volume=0.00" in af_val
    assert "atempo=0.5,atempo=0.5" in af_val

    cmd_fast, _, _, _ = server.build_ffmpeg_command(
        in_path, out_dir, jid, {"mode": "audio", "fmt": "mp3", "speed": 4.0}
    )
    af_fast = cmd_fast[cmd_fast.index("-filter:a") + 1]
    assert "atempo=2.0,atempo=2" in af_fast

    # Accurate trim: -ss before -i, -t duration after -i (NOT -to)
    cmd_trim, _, _, eff_dur = server.build_ffmpeg_command(
        in_path,
        out_dir,
        jid,
        {"mode": "convert", "fmt": "mp4", "ts_start": "00:00:04", "ts_end": "00:00:06"},
        duration=10.0,
    )
    assert "-to" not in cmd_trim
    assert cmd_trim.index("-ss") < cmd_trim.index("-i") < cmd_trim.index("-t")
    assert float(cmd_trim[cmd_trim.index("-t") + 1]) == pytest.approx(2.0)
    assert eff_dur == pytest.approx(2.0)

    # GIF palettegen filter_complex + .gif output
    cmd_gif, gif_out, _, _ = server.build_ffmpeg_command(
        in_path, out_dir, jid, {"mode": "gif", "gifFps": 10, "gifW": 320}
    )
    assert gif_out.suffix == ".gif"
    fc = cmd_gif[cmd_gif.index("-filter_complex") + 1]
    assert "palettegen" in fc and "paletteuse" in fc

    # Thumbnail uses thFmt (not fmt) and clamps thTime for short videos
    cmd_th, th_out, _, _ = server.build_ffmpeg_command(
        in_path,
        out_dir,
        jid,
        {"mode": "thumbnail", "fmt": "mp4", "thFmt": "png", "thTime": "00:00:05"},
        duration=2.0,
    )
    assert th_out.suffix == ".png"
    assert float(cmd_th[cmd_th.index("-ss") + 1]) < 2.0


# ── 4. End-to-End Real FFmpeg Conversions, SSE, Merge, Cancel, ZIP & Cleanup ─
def test_e2e_wav_to_mp3_sse_download_and_download_all_cleanup(
    client: FlaskClient,
    auth_headers: dict[str, str],
    isolated_env: dict[str, Path],
    tmp_path: Path,
) -> None:
    wav = _make_wav(tmp_path / "my song!.wav", duration_sec=1.0)
    uploaded = _upload_file(client, auth_headers, wav, "my song!.wav")

    conv = client.post(
        "/convert",
        headers=auth_headers,
        json={
            "stored_name": uploaded["stored_name"],
            "original_name": "my song!.wav",
            "options": {"mode": "audio", "fmt": "mp3", "ab": "192k"},
        },
    )
    assert conv.status_code == 200
    body = conv.get_json()
    job_id = body["job_id"]
    # Must never expose host filesystem paths
    assert str(isolated_env["uploads"]) not in body["command"]
    assert str(isolated_env["outputs"]) not in body["command"]

    # Stream SSE progress using ?token= query parameter (EventSource contract)
    token = auth_headers["X-Local-Token"]
    sse = client.get(f"/progress/{job_id}?token={token}")
    assert sse.status_code == 200
    assert "text/event-stream" in sse.content_type
    events = [
        json.loads(line.removeprefix("data: "))
        for line in sse.get_data(as_text=True).splitlines()
        if line.startswith("data: ")
    ]
    assert events, "Expected at least one SSE event"
    assert events[-1]["status"] == "done"
    assert events[-1]["done"] is True
    assert events[-1]["progress"] == 100.0
    assert events[-1]["output"].endswith(".mp3")

    # Download preserves sanitized original_name stem
    dl = client.get(f"/download/{job_id}?token={token}")
    assert dl.status_code == 200
    cd = dl.headers.get("Content-Disposition", "")
    assert "my_song_converted.mp3" in cd
    assert len(dl.data) > 500

    # /download-all streams valid ZIP and leaves NO batch_*.zip in OUTPUT_DIR
    dl_all = client.post("/download-all", headers=auth_headers, json={"job_ids": [job_id]})
    assert dl_all.status_code == 200
    with zipfile.ZipFile(io.BytesIO(dl_all.data)) as zf:
        assert "my_song_converted.mp3" in zf.namelist()
    leaked_zips = list(isolated_env["outputs"].glob("batch_*.zip"))
    assert leaked_zips == []


def test_e2e_mp4_to_gif_thumbnail_trim_and_merge(
    client: FlaskClient,
    auth_headers: dict[str, str],
    isolated_env: dict[str, Path],
    tmp_path: Path,
) -> None:
    mp4 = _make_mp4(tmp_path / "clip.mp4", duration_sec=2.0)
    up1 = _upload_file(client, auth_headers, mp4, "clip1.mp4")
    up2 = _upload_file(client, auth_headers, mp4, "clip2.mp4")

    # 1. GIF (palettegen)
    r_gif = client.post(
        "/convert",
        headers=auth_headers,
        json={
            "stored_name": up1["stored_name"],
            "original_name": "clip1.mp4",
            "options": {"mode": "gif", "gifFps": 10, "gifW": 240},
        },
    )
    assert r_gif.status_code == 200
    gif_job = _wait_for_job(client, auth_headers, r_gif.get_json()["job_id"])
    assert gif_job["status"] == "done", gif_job
    assert (isolated_env["outputs"] / gif_job["output"]).suffix == ".gif"

    # 2. Thumbnail (.png despite fmt='mp4')
    r_th = client.post(
        "/convert",
        headers=auth_headers,
        json={
            "stored_name": up1["stored_name"],
            "original_name": "clip1.mp4",
            "options": {"mode": "thumbnail", "fmt": "mp4", "thFmt": "png", "thTime": "00:00:05"},
        },
    )
    assert r_th.status_code == 200
    th_job = _wait_for_job(client, auth_headers, r_th.get_json()["job_id"])
    assert th_job["status"] == "done", th_job
    th_file = isolated_env["outputs"] / th_job["output"]
    assert th_file.suffix == ".png"
    assert th_file.read_bytes().startswith(b"\x89PNG")

    # 3. Trim accuracy (0.5s -> 1.5s == ~1.0s)
    r_trim = client.post(
        "/convert",
        headers=auth_headers,
        json={
            "stored_name": up1["stored_name"],
            "original_name": "clip1.mp4",
            "options": {
                "mode": "convert",
                "fmt": "mp4",
                "vc": "libx264",
                "preset": "ultrafast",
                "ts_start": "00:00:00.5",
                "ts_end": "00:00:01.5",
            },
        },
    )
    assert r_trim.status_code == 200
    trim_job = _wait_for_job(client, auth_headers, r_trim.get_json()["job_id"])
    assert trim_job["status"] == "done", trim_job
    trim_probe = server._probe(isolated_env["outputs"] / trim_job["output"])
    assert trim_probe is not None
    assert 0.7 <= trim_probe["duration"] <= 1.35

    # 4. Merge without -safe 0, cleaning up concat_*.txt
    r_merge = client.post(
        "/merge",
        headers=auth_headers,
        json={
            "files": [
                {"stored_name": up1["stored_name"]},
                {"stored_name": up2["stored_name"]},
            ],
            "output_format": "mp4",
            "force_reencode": False,
        },
    )
    assert r_merge.status_code == 200
    assert "-safe" not in r_merge.get_json()["command"]
    merge_job = _wait_for_job(client, auth_headers, r_merge.get_json()["job_id"])
    assert merge_job["status"] == "done", merge_job
    assert list(isolated_env["uploads"].glob("concat_*.txt")) == []


def test_cancel_json_error_stderr_ttl_and_missing_dist_503(
    client: FlaskClient,
    auth_headers: dict[str, str],
    isolated_env: dict[str, Path],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. Cancel with JSON returns 200
    job_id = "e" * 32
    with server._jobs_lock:
        server._jobs[job_id] = {
            "job_id": job_id,
            "status": "processing",
            "progress": 10.0,
            "done": False,
            "error": None,
            "output": f"{job_id}.mp4",
            "orig_name": "test",
            "command": "ffmpeg",
            "created_at": time.time(),
            "finished_at": None,
        }
    cancel_resp = client.post("/cancel", headers=auth_headers, json={"job_id": job_id})
    assert cancel_resp.status_code == 200
    assert cancel_resp.get_json()["ok"] is True
    status_resp = client.get(f"/job/{job_id}", headers=auth_headers)
    assert status_resp.get_json()["status"] == "cancelled"

    # 2. Failed job captures real FFmpeg stderr detail
    bad = client.post(
        "/upload",
        headers=auth_headers,
        data={"file": (io.BytesIO(b"corrupt garbage bytes"), "corrupt.mp4")},
        content_type="multipart/form-data",
    )
    r_fail = client.post(
        "/convert",
        headers=auth_headers,
        json={
            "stored_name": bad.get_json()["stored_name"],
            "original_name": "corrupt.mp4",
            "options": {"mode": "convert", "fmt": "mp4", "vc": "libx264"},
        },
    )
    assert r_fail.status_code == 200
    fail_job = _wait_for_job(client, auth_headers, r_fail.get_json()["job_id"])
    assert fail_job["status"] == "error"
    assert fail_job["error"] and "Invalid data" in fail_job["error"]

    # 3. TTL cleanup evicts expired jobs & their outputs
    fake_out = isolated_env["outputs"] / f"{job_id}.mp4"
    fake_out.write_bytes(b"old")
    with server._jobs_lock:
        server._jobs[job_id]["finished_at"] = time.time() - 7200
    evicted = server.cleanup_expired_jobs(ttl_seconds=3600, delete_files=True)
    assert evicted >= 1
    assert not fake_out.exists()
    assert client.get(f"/job/{job_id}", headers=auth_headers).status_code == 404

    # 4. Missing dist/index.html returns helpful 503
    monkeypatch.setattr(server, "DIST_DIR", tmp_path / "missing_dist")
    idx_resp = client.get("/")
    assert idx_resp.status_code == 503
    assert "npm run build" in idx_resp.get_data(as_text=True)


def test_cancel_targets_only_specified_job(
    client: FlaskClient,
    auth_headers: dict[str, str],
) -> None:
    class _StubProc:
        def __init__(self) -> None:
            self.killed = False

        def kill(self) -> None:
            self.killed = True

    jid_a = "1" * 32
    jid_b = "2" * 32
    proc_a = _StubProc()
    proc_b = _StubProc()
    with server._jobs_lock:
        for jid, proc in ((jid_a, proc_a), (jid_b, proc_b)):
            server._jobs[jid] = {
                "job_id": jid,
                "status": "processing",
                "progress": 5.0,
                "done": False,
                "error": None,
                "output": f"{jid}.mp4",
                "orig_name": "clip",
                "command": "ffmpeg",
                "created_at": time.time(),
                "finished_at": None,
            }
            server._processes[jid] = proc  # type: ignore[assignment]

    resp = client.post("/cancel", headers=auth_headers, json={"job_id": jid_a})
    assert resp.status_code == 200
    assert proc_a.killed is True
    assert proc_b.killed is False
    assert client.get(f"/job/{jid_a}", headers=auth_headers).get_json()["status"] == "cancelled"
    assert client.get(f"/job/{jid_b}", headers=auth_headers).get_json()["status"] == "processing"

