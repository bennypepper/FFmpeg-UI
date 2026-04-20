import os
import re
import json
import uuid
import time
import shlex
import zipfile
import threading
import subprocess
from pathlib import Path
from flask import Flask, request, send_file, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).parent
app = Flask(__name__, static_folder=str(BASE_DIR.parent / 'local-server-web' / 'dist'), static_url_path='/')
CORS(app)

UPLOAD_DIR = BASE_DIR / 'uploads'
OUTPUT_DIR = BASE_DIR / 'outputs'
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

_jobs: dict = {}
_jobs_lock = threading.Lock()
_current_process = None
# Per-job cancellation flags: {job_id: threading.Event}
_cancel_flags: dict = {}
CAPABILITIES: dict = {}

# ── Subprocess helper (suppress console on Windows) ─────────────────────────
def _popen_kwargs():
    if os.name == 'nt':
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = subprocess.SW_HIDE
        return {'startupinfo': si}
    return {}

# ── Utilities ────────────────────────────────────────────────────────────────
def _seconds(t: str) -> float:
    try:
        parts = t.strip().split(':')
        h, m, s = (parts + ['0', '0', '0'])[:3]
        return int(h) * 3600 + int(m) * 60 + float(s)
    except Exception:
        return 0.0

def _parse_progress(line: str) -> dict:
    out = {}
    for key, pat in [
        ('time',    r'time=(\d+:\d+:\d+\.\d+)'),
        ('fps',     r'fps=\s*(\d+\.?\d*)'),
        ('frame',   r'frame=\s*(\d+)'),
        ('size_kb', r'size=\s*(\d+)kB'),
    ]:
        m = re.search(pat, line)
        if m:
            out[key] = m.group(1)
    return out

def _probe(path: Path) -> dict | None:
    cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json',
           '-show_format', '-show_streams', str(path)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30, **_popen_kwargs())
        if r.returncode != 0:
            return None
        data = json.loads(r.stdout)
        fmt = data.get('format', {})
        streams = data.get('streams', [])
        vs = next((s for s in streams if s.get('codec_type') == 'video'), None)
        as_ = next((s for s in streams if s.get('codec_type') == 'audio'), None)
        info: dict = {
            'duration':     float(fmt.get('duration', 0)),
            'size_mb':      round(int(fmt.get('size', 0)) / 1_048_576, 2),
            'bitrate_kbps': round(int(fmt.get('bit_rate', 0)) / 1000),
        }
        if vs:
            info['width'] = vs.get('width', 0)
            info['height'] = vs.get('height', 0)
            info['video_codec'] = vs.get('codec_name', 'unknown')
            try:
                num, den = vs.get('r_frame_rate', '0/1').split('/')
                info['fps'] = round(int(num) / int(den), 3) if int(den) else 0
            except Exception:
                info['fps'] = 0
        if as_:
            info['audio_codec'] = as_.get('codec_name', 'unknown')
            info['channels'] = as_.get('channels', 2)
            info['sample_rate'] = as_.get('sample_rate', '44100')
        return info
    except Exception as e:
        print(f'[probe error] {e}')
        return None

def _check_capabilities() -> dict:
    caps = {'encoders': [], 'hwaccel': [], 'ffmpeg_version': 'unknown', 'ffprobe_available': False}
    try:
        enc_r = subprocess.run(['ffmpeg', '-encoders'], capture_output=True, text=True, **_popen_kwargs())
        for enc in ('libx264','libx265','libvpx-vp9','libaom-av1','prores_ks','h264_nvenc','hevc_nvenc','h264_qsv','hevc_qsv'):
            if f' {enc} ' in enc_r.stdout or f'\n {enc} ' in enc_r.stdout:
                caps['encoders'].append(enc)
        ver_r = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True, **_popen_kwargs())
        m = re.search(r'ffmpeg version (\S+)', ver_r.stdout)
        if m:
            caps['ffmpeg_version'] = m.group(1).split('-')[0].strip()
    except Exception as e:
        print(f'[caps encoder error] {e}')
    try:
        hw_r = subprocess.run(['ffmpeg', '-hwaccels'], capture_output=True, text=True, **_popen_kwargs())
        if 'cuda' in hw_r.stdout:
            caps['hwaccel'].append('cuda')
        if 'qsv' in hw_r.stdout:
            caps['hwaccel'].append('qsv')
    except Exception:
        pass
    try:
        subprocess.run(['ffprobe', '-version'], capture_output=True, timeout=5, **_popen_kwargs())
        caps['ffprobe_available'] = True
    except Exception:
        pass
    return caps

# ── FFmpeg Command Builder ───────────────────────────────────────────────────
_RES_MAP = {'4k':'3840:-2','1080p':'1920:-2','720p':'1280:-2','480p':'854:-2','360p':'640:-2'}
_ROT_MAP = {'cw90':'transpose=1','ccw90':'transpose=2','180':'transpose=2,transpose=2','fliph':'hflip','flipv':'vflip'}
_OVERLAY_MAP = {'tl':'10:10','tr':'W-w-10:10','bl':'10:H-h-10','br':'W-w-10:H-h-10','center':'(W-w)/2:(H-h)/2'}

def _g(params, key, default=''):
    v = params.get(key, default)
    return v if v is not None and v != '' else default

def build_command(input_path: str, output_path: str, params: dict, mode: str, fmt: str) -> list:
    cmd = ['ffmpeg', '-y']
    t_start = _g(params, 'trim_start')
    t_end   = _g(params, 'trim_end')
    if t_start and t_start != '00:00:00':
        cmd += ['-ss', t_start]
    cmd += ['-i', input_path]

    sub_stored   = _g(params, 'subtitle_stored_name')
    water_stored = _g(params, 'watermark_stored_name')
    sub_path     = str(UPLOAD_DIR / sub_stored)   if sub_stored   else None
    water_path   = str(UPLOAD_DIR / water_stored) if water_stored else None
    sub_mode     = _g(params, 'subtitle_mode', 'burn')

    if sub_path and Path(sub_path).exists() and sub_mode == 'soft':
        cmd += ['-i', sub_path]
    if water_path and Path(water_path).exists():
        cmd += ['-i', water_path]
    if t_end and t_end != '00:00:00':
        cmd += ['-to', t_end]

    # REMUX
    if mode == 'remux':
        cmd += ['-c:v', 'copy', '-c:a', 'copy', output_path]
        return cmd

    # AUDIO / EXTRACT AUDIO
    if mode in ('extract_audio', 'audio'):
        cmd += ['-vn']
        ac = _g(params, 'codec_audio', 'aac')
        ab = _g(params, 'audio_bitrate', '128k')
        ar = _g(params, 'sample_rate', '')
        ch = _g(params, 'channels', '')
        
        if ac == 'copy':   
            cmd += ['-c:a', 'copy']
        elif ac == 'flac': 
            cmd += ['-c:a', 'flac']
        else:              
            cmd += ['-c:a', ac, '-b:a', ab]
            
        if ar and ac != 'copy':
            cmd += ['-ar', ar]
        if ch and ac != 'copy':
            cmd += ['-ac', ch]
            
        cmd.append(output_path)
        return cmd

    # THUMBNAIL
    if mode == 'thumbnail':
        ts     = _g(params, 'thumbnail_time', '00:00:05')
        t_fmt  = _g(params, 'thumbnail_format', 'jpg')
        qual   = _g(params, 'thumbnail_quality', '90')
        if '-ss' not in cmd:
            cmd.insert(1, ts); cmd.insert(1, '-ss')
        else:
            cmd[cmd.index('-ss') + 1] = ts
        cmd += ['-vframes', '1']
        if t_fmt == 'jpg':
            q = max(1, min(31, int((100 - int(qual)) / 3 + 1)))
            cmd += ['-q:v', str(q)]
        elif t_fmt == 'webp':
            cmd += ['-quality', qual]
        cmd.append(output_path)
        return cmd

    # GIF (special marker — handled in _run_job)
    if fmt == 'gif':
        gfps  = _g(params, 'gif_fps',   '15')
        gw    = _g(params, 'gif_width', '480')
        gloop = _g(params, 'gif_loop',  '0')
        pal   = str(Path(output_path).parent / f'pal_{uuid.uuid4().hex}.png')
        vf_p  = f'fps={gfps},scale={gw}:-2:flags=lanczos,palettegen'
        vf_m  = f'fps={gfps},scale={gw}:-2:flags=lanczos,paletteuse'
        return ['__gif__', input_path, pal, vf_p, vf_m, gloop, output_path]

    # CONVERT
    vf = []
    res = _g(params, 'resolution', 'original')
    if res in _RES_MAP:
        vf.append(f'scale={_RES_MAP[res]}')
    elif ':' in res and res != 'original':
        vf.append(f'scale={res}')

    rot = _g(params, 'rotate')
    if rot in _ROT_MAP:
        vf.append(_ROT_MAP[rot])

    speed = float(_g(params, 'speed', '1.0') or '1.0')
    if speed != 1.0:
        vf.append(f'setpts={1/speed:.4f}*PTS')

    crop = _g(params, 'crop').strip()
    if crop:
        vf.append(f'crop={crop}')

    if _g(params, 'deinterlace') == 'true': vf.append('yadif')
    if _g(params, 'grayscale')   == 'true': vf.append('hue=s=0')
    if _g(params, 'denoise')     == 'true': vf.append('hqdn3d')
    if _g(params, 'sharpen')     == 'true': vf.append('unsharp=5:5:1.0:5:5:0.0')

    if sub_path and Path(sub_path).exists() and sub_mode == 'burn':
        safe = sub_path.replace('\\', '/')
        if os.name == 'nt' and len(safe) >= 2 and safe[1] == ':':
            safe = safe[0] + r'\:' + safe[2:]
        vf.append(f"subtitles='{safe}'")

    has_water = bool(water_path and Path(water_path).exists())
    if has_water:
        opacity  = _g(params, 'watermark_opacity', '0.75')
        pos      = _OVERLAY_MAP.get(_g(params, 'watermark_position', 'br'), 'W-w-10:H-h-10')
        widx     = 2 if (sub_path and Path(sub_path).exists() and sub_mode == 'soft') else 1
        if vf:
            fc = f'[0:v]{",".join(vf)}[base];[{widx}:v]colorchannelmixer=aa={opacity}[wm];[base][wm]overlay={pos}'
        else:
            fc = f'[{widx}:v]colorchannelmixer=aa={opacity}[wm];[0:v][wm]overlay={pos}'
        cmd += ['-filter_complex', fc]
    elif vf:
        cmd += ['-vf', ','.join(vf)]

    # Video codec
    vc     = _g(params, 'codec_video', 'libx264')
    hwaccel = _g(params, 'hwaccel', 'none')

    if vc == 'copy':
        cmd += ['-c:v', 'copy']
    elif hwaccel == 'cuda':
        nvenc = 'hevc_nvenc' if vc == 'libx265' else 'h264_nvenc'
        cmd += ['-hwaccel', 'cuda', '-c:v', nvenc]
    elif hwaccel == 'qsv':
        cmd += ['-hwaccel', 'qsv', '-c:v', 'h264_qsv']
    else:
        cmd += ['-c:v', vc]
        if vc == 'libx265':   cmd += ['-vtag', 'hvc1']
        if vc == 'prores_ks': cmd += ['-profile:v', '3']

        vbr  = _g(params, 'video_bitrate').strip()
        tsz  = _g(params, 'target_size_mb').strip()
        dur  = float(_g(params, 'duration', '0') or '0')
        if tsz and dur > 0:
            bits = float(tsz) * 8 * 1_048_576
            br_k = int(bits / dur / 1000)
            cmd += ['-b:v', f'{br_k}k', '-pass', '2']
        elif vbr:
            cmd += ['-b:v', vbr if 'k' in vbr else f'{vbr}k']
        elif vc not in ('prores_ks', 'copy'):
            crf = _g(params, 'crf', '23')
            if vc in ('libx264', 'libx265'):
                cmd += ['-crf', crf]
            elif vc in ('libvpx-vp9', 'libaom-av1'):
                cmd += ['-crf', crf, '-b:v', '0']

        preset = _g(params, 'preset', 'medium')
        if vc in ('libx264', 'libx265') and hwaccel == 'none':
            cmd += ['-preset', preset]

        tune = _g(params, 'tune')
        if tune and tune != 'none' and vc in ('libx264', 'libx265'):
            cmd += ['-tune', tune]

    fps = _g(params, 'fps')
    if fps and fps not in ('', 'original'):
        cmd += ['-r', fps]

    pix_fmt = _g(params, 'pix_fmt', 'yuv420p')
    if pix_fmt and vc not in ('copy', 'prores_ks'):
        cmd += ['-pix_fmt', pix_fmt]

    aspect = _g(params, 'aspect')
    if aspect and aspect not in ('', 'auto'):
        cmd += ['-aspect', aspect]

    threads = _g(params, 'threads')
    if threads and threads not in ('', 'auto'):
        cmd += ['-threads', threads]

    # Audio
    if _g(params, 'remove_audio') == 'true':
        cmd += ['-an']
    else:
        ac = _g(params, 'codec_audio', 'aac')
        ab = _g(params, 'audio_bitrate', '128k')
        ar = _g(params, 'sample_rate')
        ach = _g(params, 'channels')

        if ac == 'copy':   cmd += ['-c:a', 'copy']
        elif ac == 'flac': cmd += ['-c:a', 'flac']
        else:              cmd += ['-c:a', ac, '-b:a', ab]

        if ar:  cmd += ['-ar', ar]
        if ach: cmd += ['-ac', ach]

        af = []
        vol = float(_g(params, 'volume', '1.0') or '1.0')
        if vol != 1.0: af.append(f'volume={vol:.2f}')
        if _g(params, 'normalize_audio') == 'true': af.append('loudnorm')
        if speed != 1.0:
            sp = min(max(speed, 0.25), 4.0)
            if sp > 2.0:   af += ['atempo=2.0', f'atempo={sp/2.0:.2f}']
            elif sp < 0.5: af += ['atempo=0.5', f'atempo={sp/0.5:.2f}']
            else:          af.append(f'atempo={sp:.2f}')
        if af: cmd += ['-filter:a', ','.join(af)]

        if sub_path and Path(sub_path).exists() and sub_mode == 'soft':
            cmd += ['-c:s', 'mov_text' if fmt == 'mp4' else 'copy']

    if _g(params, 'web_optimize') == 'true' and fmt == 'mp4':
        cmd += ['-movflags', '+faststart']
    if _g(params, 'strip_metadata') == 'true':
        cmd += ['-map_metadata', '-1']

    custom = _g(params, 'custom_args').strip()
    if custom:
        cmd += shlex.split(custom)

    cmd.append(output_path)
    return cmd

# ── Job Runner ───────────────────────────────────────────────────────────────
def _run_job(job_id: str, cmd: list, out_path: Path, duration: float):
    global _current_process
    start = time.time()
    cancel_ev = _cancel_flags.get(job_id, threading.Event())

    def _upd(**kw):
        with _jobs_lock:
            _jobs[job_id].update(kw)

    def _drain_stderr(proc, on_line):
        """Read stderr on a background thread so we never block the main thread."""
        try:
            for line in proc.stderr:
                if cancel_ev.is_set():
                    break
                on_line(line)
        except Exception:
            pass

    def _progress_handler(line):
        pg = _parse_progress(line)
        if 'time' in pg and duration > 0:
            t   = _seconds(pg['time'])
            pct = min(99.9, (t / duration) * 100)
            el  = time.time() - start
            eta = max(0, el / max(pct / 100, 0.001) - el)
            _upd(progress=round(pct, 1),
                 fps=float(pg.get('fps', 0)),
                 frame=int(pg.get('frame', 0)),
                 size_mb=round(int(pg.get('size_kb', 0)) / 1024, 1),
                 eta_sec=round(eta))

    def _kill_proc(proc):
        """Forcefully kill process and drain remaining stderr to unblock pipe."""
        try:
            proc.kill()
        except Exception:
            pass
        try:
            proc.stderr.read()  # drain so the pipe doesn't hang
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            pass

    def _run_proc(proc_cmd):
        """Spawn, monitor, and return (proc, success)."""
        proc = subprocess.Popen(
            proc_cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL,
            text=True, bufsize=1, **_popen_kwargs())
        _current_process = proc

        drain_thread = threading.Thread(target=_drain_stderr, args=(proc, _progress_handler), daemon=True)
        drain_thread.start()

        # Poll: either process exits naturally or cancel flag fires
        while proc.poll() is None:
            if cancel_ev.is_set():
                _kill_proc(proc)
                break
            time.sleep(0.1)

        drain_thread.join(timeout=3)  # give stderr drain thread a moment to finish
        return proc

    # GIF two-pass
    if cmd[0] == '__gif__':
        _, inp, pal, vf_p, vf_m, gloop, outp = cmd
        p1 = subprocess.run(['ffmpeg', '-y', '-i', inp, '-vf', vf_p, pal],
                            capture_output=True, **_popen_kwargs())
        if p1.returncode != 0:
            _upd(status='error', done=True, error='GIF palette pass failed')
            return
        if cancel_ev.is_set():
            _upd(status='cancelled', done=True, error='Cancelled')
            return
        _upd(progress=5)
        try:
            proc = _run_proc(['ffmpeg', '-y', '-i', inp, '-i', pal, '-vf', vf_m, '-loop', gloop, outp])
            if cancel_ev.is_set():
                _upd(status='cancelled', done=True, error='Cancelled')
                out_path.unlink(missing_ok=True)
            elif proc.returncode == 0 and out_path.exists():
                _upd(status='done', progress=100, done=True)
            else:
                _upd(status='error', done=True, error='GIF encode pass failed')
        except Exception as ex:
            _upd(status='error', done=True, error=str(ex))
        finally:
            _current_process = None
            Path(pal).unlink(missing_ok=True)
        return

    # Normal encode
    try:
        proc = _run_proc(cmd)
        if cancel_ev.is_set():
            _upd(status='cancelled', done=True, error='Cancelled')
            out_path.unlink(missing_ok=True)   # remove partial output
        elif proc.returncode == 0 and out_path.exists():
            _upd(status='done', progress=100, done=True)
        else:
            stderr_tail = ''
            try:
                # Collect a brief tail from stderr for friendly error
                stderr_tail = f'FFmpeg exit code {proc.returncode}'
            except Exception:
                pass
            _upd(status='error', done=True, error=stderr_tail)
    except Exception as ex:
        _upd(status='error', done=True, error=str(ex))
    finally:
        _current_process = None
        _cancel_flags.pop(job_id, None)

# ── Routes ───────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

def check_caps_for_client():
    return {
        'has_ffmpeg': CAPABILITIES.get('ffprobe_available', False),
        'version': CAPABILITIES.get('ffmpeg_version', 'Unknown')
    }

@app.route('/capabilities')
def capabilities():
    return jsonify(check_caps_for_client())

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    """Serve uploaded files for in-browser preview."""
    return send_from_directory(UPLOAD_DIR, filename)

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({'error': 'Empty filename'}), 400
    uid  = uuid.uuid4().hex
    ext  = Path(f.filename).suffix.lower()
    name = f'{uid}{ext}'
    path = UPLOAD_DIR / name
    f.save(path)
    return jsonify({'file_id': uid, 'stored_name': name,
                    'original_name': f.filename, 'probe': _probe(path)})

@app.route('/probe')
def probe_route():
    stored = request.args.get('file')
    if not stored:
        return jsonify({'error': 'Missing file'}), 400
    path = UPLOAD_DIR / stored
    if not path.exists():
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_probe(path) or {'error': 'Probe failed'})

@app.route('/merge-probe', methods=['POST'])
def merge_probe():
    files = request.files.getlist('files')
    results = []
    for f in files:
        if not f.filename: continue
        uid  = uuid.uuid4().hex
        ext  = Path(f.filename).suffix.lower()
        name = f'{uid}{ext}'
        path = UPLOAD_DIR / name
        f.save(path)
        results.append({'file_id': uid, 'stored_name': name,
                        'original_name': f.filename, 'probe': _probe(path)})
    mismatches = []
    recommended = {}
    if len(results) > 1:
        probes = [r['probe'] or {} for r in results]
        max_w  = max((p.get('width',  0) for p in probes), default=0)
        max_h  = max((p.get('height', 0) for p in probes), default=0)
        base_vc = probes[0].get('video_codec') if probes else None
        recommended = {'width': max_w, 'height': max_h, 'video_codec': base_vc}
        for r in results:
            p = r.get('probe') or {}
            if p.get('width') != max_w or p.get('height') != max_h:
                mismatches.append(f"Resolution: '{r['original_name']}' is {p.get('width')}×{p.get('height')} (max {max_w}×{max_h})")
            if base_vc and p.get('video_codec') != base_vc:
                mismatches.append(f"Codec: '{r['original_name']}' is {p.get('video_codec')} ≠ {base_vc}")
    return jsonify({'files': results, 'compatible': len(mismatches) == 0,
                    'mismatches': mismatches, 'recommended': recommended})

@app.route('/convert', methods=['POST'])
def convert():
    if request.is_json:
        data = request.get_json()
        mode       = data.get('mode', 'convert')
        fmt        = data.get('fmt', 'mp4')
        raw_input  = data.get('input_path', '')
        input_path = UPLOAD_DIR / raw_input if raw_input else None
        args       = data.get('args', [])
        orig_name  = data.get('original_name', raw_input)
        
        if not input_path or not input_path.exists():
            return jsonify({'error': 'Input file not found'}), 404

        job_id   = uuid.uuid4().hex
        out_name = f'{job_id}_{input_path.stem}.{fmt}'
        out_path = OUTPUT_DIR / out_name
        
        probe  = _probe(input_path)
        dur    = probe.get('duration', 0) if probe else 0
        
        # Override output file in args to be the out_path
        # The frontend builder usually puts the input and output in args
        # But we need to ensure the output path is correct.
        try:
            if '-i' in args:
                idx = args.index('-i')
                args[idx + 1] = str(input_path)
        except ValueError:
            pass

        if args:
            args[-1] = str(out_path)
        else:
            return jsonify({'error': 'No args provided'}), 400
            
        cmd = ['ffmpeg'] + args

    else:
        params     = dict(request.form)
        params     = {k: (v[0] if isinstance(v, list) else v) for k, v in params.items()}
        mode       = _g(params, 'mode', 'convert')
        fmt        = _g(params, 'output_format', 'mp4')
        stored     = _g(params, 'stored_name')
        orig_name  = _g(params, 'original_name', stored)
        input_path = UPLOAD_DIR / stored
        
        if not input_path.exists():
            return jsonify({'error': 'Input file not found'}), 404

        job_id   = uuid.uuid4().hex
        out_name = f'{job_id}_{Path(orig_name).stem}.{fmt}'
        out_path = OUTPUT_DIR / out_name

        probe  = _probe(input_path)
        dur    = probe.get('duration', 0) if probe else 0
        params['duration'] = str(dur)

        # 2-pass first pass (blocking)
        tsz = _g(params, 'target_size_mb', '').strip()
        if tsz and dur > 0:
            bits  = float(tsz) * 8 * 1_048_576
            br_k  = int(bits / dur / 1000)
            vc    = _g(params, 'codec_video', 'libx264')
            null  = 'NUL' if os.name == 'nt' else '/dev/null'
            p1cmd = ['ffmpeg', '-y', '-i', str(input_path), '-c:v', vc,
                     '-b:v', f'{br_k}k', '-pass', '1', '-an', '-f', 'null', null]
            subprocess.run(p1cmd, capture_output=True, **_popen_kwargs())

        try:
            cmd = build_command(str(input_path), str(out_path), params, mode, fmt)
        except Exception as e:
            return jsonify({'error': f'Build failed: {e}'}), 400

    cmd_display = ' '.join(cmd) if cmd[0] != '__gif__' else f'ffmpeg [2-pass GIF] → {out_name}'
    with _jobs_lock:
        _jobs[job_id] = {
            'status': 'processing', 'progress': 0, 'fps': 0, 'frame': 0,
            'size_mb': 0, 'eta_sec': 0, 'done': False, 'error': None,
            'output': out_name, 'orig_name': orig_name, 'command': cmd_display,
        }

    _cancel_flags[job_id] = threading.Event()
    threading.Thread(target=_run_job, args=(job_id, cmd, out_path, dur), daemon=True).start()
    return jsonify({'job_id': job_id, 'command': cmd_display})

@app.route('/merge', methods=['POST'])
def merge():
    data     = request.get_json() or {}
    files    = data.get('files', [])
    fmt      = data.get('output_format', 'mp4')
    reencode = data.get('force_reencode', False)
    re_params = data.get('reencode_params', {})

    if len(files) < 2:
        return jsonify({'error': 'Need at least 2 files'}), 400

    concat_txt = UPLOAD_DIR / f'concat_{uuid.uuid4().hex}.txt'
    with open(concat_txt, 'w') as cf:
        for f in files:
            p = str(UPLOAD_DIR / f['stored_name']).replace('\\', '/')
            cf.write(f"file '{p}'\n")

    job_id   = uuid.uuid4().hex
    out_name = f'{job_id}_merged.{fmt}'
    out_path = OUTPUT_DIR / out_name

    cmd = ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat_txt)]
    if reencode:
        vc  = re_params.get('codec_video', 'libx264')
        crf = re_params.get('crf', '23')
        res = re_params.get('resolution', '')
        cmd += ['-c:v', vc, '-crf', str(crf), '-c:a', 'aac']
        if res:
            cmd += ['-vf', f'scale={res}']
    else:
        cmd += ['-c', 'copy']
    cmd.append(str(out_path))

    total_dur = sum(_probe(UPLOAD_DIR / f['stored_name'] or {}).get('duration', 0)
                    for f in files if (UPLOAD_DIR / f.get('stored_name', '')).exists())

    with _jobs_lock:
        _jobs[job_id] = {
            'status': 'processing', 'progress': 0, 'fps': 0, 'frame': 0,
            'size_mb': 0, 'eta_sec': 0, 'done': False, 'error': None,
            'output': out_name, 'orig_name': 'merged', 'command': ' '.join(cmd),
        }

    def run_and_cleanup():
        _run_job(job_id, cmd, out_path, total_dur)
        concat_txt.unlink(missing_ok=True)

    _cancel_flags[job_id] = threading.Event()
    threading.Thread(target=run_and_cleanup, daemon=True).start()
    return jsonify({'job_id': job_id})

@app.route('/progress/<job_id>')
def progress(job_id):
    def generate():
        while True:
            with _jobs_lock:
                job = dict(_jobs.get(job_id, {}))
            if not job:
                yield f'data: {json.dumps({"error": "not found"})}\n\n'
                return
            payload = {k: job[k] for k in ('progress','fps','frame','size_mb','eta_sec','done','status','error') if k in job}
            if job.get('done') and job.get('status') == 'done':
                payload['output'] = job.get('output')
            yield f'data: {json.dumps(payload)}\n\n'
            if job.get('done'):
                return
            time.sleep(0.4)
    return Response(stream_with_context(generate()), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.route('/cancel', methods=['POST'])
def cancel():
    global _current_process
    data   = request.get_json() or {}
    job_id = data.get('job_id')

    # Set the per-job cancel flag so _run_job's poll loop exits immediately
    if job_id and job_id in _cancel_flags:
        _cancel_flags[job_id].set()

    # Also force-kill the process handle in case it exists
    proc = _current_process
    if proc:
        try:
            proc.kill()          # SIGKILL — immediate, works on Windows & Unix
        except Exception:
            pass
        try:
            proc.stderr.read()   # drain the pipe so the reader thread unblocks
        except Exception:
            pass
        _current_process = None

    if job_id and job_id in _jobs:
        with _jobs_lock:
            _jobs[job_id].update(status='cancelled', done=True, error='Cancelled')
    return jsonify({'ok': True})

@app.route('/download/<job_id>')
def download(job_id):
    with _jobs_lock:
        job = dict(_jobs.get(job_id, {}))
    if not job or not job.get('output'):
        return jsonify({'error': 'Not found'}), 404
    path = OUTPUT_DIR / job['output']
    if not path.exists():
        return jsonify({'error': 'File missing'}), 404
    stem = Path(job.get('orig_name', 'output')).stem
    return send_file(str(path), as_attachment=True, download_name=f'{stem}_converted{path.suffix}')

@app.route('/download-all', methods=['POST'])
def download_all():
    data    = request.get_json() or {}
    job_ids = data.get('job_ids', [])
    zip_path = OUTPUT_DIR / f'batch_{uuid.uuid4().hex}.zip'
    with zipfile.ZipFile(zip_path, 'w') as zf:
        for jid in job_ids:
            with _jobs_lock:
                job = dict(_jobs.get(jid, {}))
            if job.get('status') == 'done' and job.get('output'):
                p = OUTPUT_DIR / job['output']
                if p.exists():
                    stem = Path(job.get('orig_name', 'output')).stem
                    zf.write(p, f'{stem}_converted{p.suffix}')
    return send_file(str(zip_path), as_attachment=True, download_name='batch_converted.zip')

@app.route('/job/<job_id>')
def job_status(job_id):
    with _jobs_lock:
        job = dict(_jobs.get(job_id, {}))
    return jsonify(job or {'error': 'Not found'})

# ── Startup ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print('Checking FFmpeg capabilities...')
    CAPABILITIES.update(_check_capabilities())
    print(f"  FFmpeg  : {CAPABILITIES['ffmpeg_version']}")
    print(f"  Encoders: {CAPABILITIES['encoders']}")
    print(f"  HW Accel: {CAPABILITIES['hwaccel']}")
    print('Starting server at http://127.0.0.1:5000')
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
