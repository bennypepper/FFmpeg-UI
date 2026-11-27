import {
  DEFAULT_PLATFORM,
  normalizeAudioCodec,
  parseTimestamp,
  validateOptions,
} from './capabilities';
import type { CommandOptions, FFmpegPlan, RuntimePlatform } from './types';

const _RES: Record<string, string> = {
  '4k': '3840:-2',
  '1080p': '1920:-2',
  '720p': '1280:-2',
  '480p': '854:-2',
  '360p': '640:-2',
};

const _ROT: Record<string, string> = {
  cw90: 'transpose=1',
  ccw90: 'transpose=2',
  '180': 'transpose=2,transpose=2',
  fliph: 'hflip',
  flipv: 'vflip',
};

const _OVL: Record<string, string> = {
  tl: '10:10',
  tr: 'W-w-10:10',
  bl: '10:H-h-10',
  br: 'W-w-10:H-h-10',
  center: '(W-w)/2:(H-h)/2',
};

/**
 * Derives a non-colliding output path while preserving directory segments that contain dots.
 * e.g. "dir.with.dots/clip_noext" + "mkv" -> "dir.with.dots/clip_noext_converted.mkv"
 */
export function deriveOutputPath(
  input: string,
  ext: string,
  explicitOutput?: string,
): { outputName: string; outputExt: string } {
  const cleanExt = ext.replace(/^\./, '').trim().toLowerCase() || 'mp4';
  if (explicitOutput && explicitOutput.trim()) {
    return { outputName: explicitOutput.trim(), outputExt: cleanExt };
  }

  const lastSlash = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'));
  const dir = lastSlash >= 0 ? input.slice(0, lastSlash + 1) : '';
  const base = lastSlash >= 0 ? input.slice(lastSlash + 1) : input;
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;

  return {
    outputName: `${dir}${stem}_converted.${cleanExt}`,
    outputExt: cleanExt,
  };
}

/**
 * Formats seconds cleanly for FFmpeg -t / -ss arguments.
 */
function formatDurationSeconds(sec: number): string {
  return String(Number(sec.toFixed(3)));
}

/**
 * Escapes a subtitle file path for FFmpeg's libass `subtitles=` filtergraph syntax
 * on both Windows (drive letters + backslashes) and POSIX.
 */
export function escapeSubtitlePath(subPath: string): string {
  // Normalize backslashes to forward slashes first so Windows paths don't collide with lavfi escaping
  const posix = subPath.replace(/\\/g, '/');
  // Inside single-quoted subtitles='...' value, escape special lavfi/filter characters
  return posix
    .replace(/:/g, '\\:')
    .replace(/'/g, "'\\''")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Normalizes a video bitrate string so values with explicit units (e.g. "5M", "2500k")
 * are preserved rather than mangled into "5Mk".
 */
export function normalizeBitrate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/[kKmMgG]$/.test(trimmed)) return trimmed;
  return `${trimmed}k`;
}

/**
 * Chains FFmpeg `atempo` filters for arbitrary speeds (< 0.5 and > 2.0),
 * since each `atempo` instance only accepts values in [0.5, 2.0].
 */
export function buildAtempoChain(speed: number): string[] {
  const clamped = Math.min(Math.max(speed, 0.1), 16.0);
  if (Math.abs(clamped - 1.0) < 1e-4) return [];

  const filters: string[] = [];
  let remaining = clamped;

  while (remaining < 0.5 - 1e-6) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }

  while (remaining > 2.0 + 1e-6) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }

  if (Math.abs(remaining - 1.0) > 1e-4 || filters.length === 0) {
    const formatted =
      Math.abs(remaining - 0.5) < 1e-4
        ? '0.5'
        : Math.abs(remaining - 2.0) < 1e-4
          ? '2.0'
          : String(Number(remaining.toFixed(4)));
    filters.push(`atempo=${formatted}`);
  }

  return filters;
}

/**
 * Safely tokenizes custom FFmpeg CLI arguments, preserving quoted strings
 * and skipping empty whitespace tokens.
 */
export function tokenizeCustomArgs(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === '\\' && quote !== "'") {
      // Only escape whitespace or quotes so Windows paths aren't stripped unexpectedly
      const next = raw[i + 1];
      if (next === '"' || next === "'" || next === '\\' || next === ' ') {
        escaping = true;
        continue;
      }
      current += ch;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function buildAudioFilterChain(opts: CommandOptions): string[] {
  const af: string[] = [];
  if (opts.vol !== undefined && opts.vol !== 1.0) {
    const clampedVol = Math.max(0, opts.vol);
    af.push(`volume=${clampedVol.toFixed(2)}`);
  }
  if (opts.norm) {
    af.push('loudnorm');
  }
  if (opts.speed !== undefined && opts.speed !== 1.0) {
    af.push(...buildAtempoChain(opts.speed));
  }
  return af;
}

function buildVideoFilterChain(opts: CommandOptions): string[] {
  const vf: string[] = [];
  if (opts.res && _RES[opts.res]) {
    vf.push(`scale=${_RES[opts.res]}`);
  } else if (opts.res && opts.res.includes(':') && opts.res !== 'original') {
    vf.push(`scale=${opts.res}`);
  }

  if (opts.rotate && _ROT[opts.rotate]) {
    vf.push(_ROT[opts.rotate]);
  }
  if (opts.speed !== undefined && opts.speed !== 1.0) {
    vf.push(`setpts=${(1 / opts.speed).toFixed(4)}*PTS`);
  }
  if (opts.cropW && opts.cropH) {
    vf.push(`crop=${opts.cropW}:${opts.cropH}:${opts.cropX || '0'}:${opts.cropY || '0'}`);
  }
  if (opts.deint) vf.push('yadif');
  if (opts.gray) vf.push('hue=s=0');
  if (opts.den) vf.push('hqdn3d');
  if (opts.sharp) vf.push('unsharp=5:5:1.0:5:5:0.0');

  if (opts.hasSub && opts.subMode === 'burn' && opts.subPath) {
    vf.push(`subtitles='${escapeSubtitlePath(opts.subPath)}'`);
  }

  return vf;
}

/**
 * Validated FFmpeg command planner.
 * Returns { args, outputName, outputExt, warnings, errors }.
 */
export function planFFmpegJob(
  opts: CommandOptions,
  platform: RuntimePlatform = DEFAULT_PLATFORM,
): FFmpegPlan {
  const input = opts.input?.trim() || '';
  const validation = validateOptions(opts, platform);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (!input) {
    errors.unshift('Input file path is required.');
  }

  const effectiveMode =
    opts.mode === 'convert' && opts.fmt?.trim().toLowerCase() === 'gif'
      ? 'gif'
      : opts.mode;

  if (effectiveMode === 'merge') {
    if (errors.length === 0) {
      errors.push('Merge mode requires multiple input files via the Local Server /merge endpoint.');
    }
    const { outputName, outputExt } = deriveOutputPath(input || 'merged', opts.fmt || 'mp4', opts.output);
    return { args: [], outputName, outputExt, warnings, errors };
  }

  // Derive target extension early so even error responses carry clean output metadata
  const targetExt =
    effectiveMode === 'thumbnail'
      ? (opts.thFmt || 'jpg').trim().toLowerCase()
      : effectiveMode === 'gif'
        ? 'gif'
        : (opts.fmt || 'mp4').trim().toLowerCase();

  const { outputName, outputExt } = deriveOutputPath(input || 'output', targetExt, opts.output);

  if (errors.length > 0) {
    return { args: [], outputName, outputExt, warnings, errors };
  }

  const startSec = opts.ts_start ? parseTimestamp(opts.ts_start) : null;
  const endSec = opts.ts_end ? parseTimestamp(opts.ts_end) : null;
  const hasStart = startSec !== null && startSec > 0;
  const hasEnd = endSec !== null && endSec > 0;
  const durationSec = hasEnd ? (hasStart ? endSec - startSec : endSec) : null;

  const args: string[] = ['-y'];

  // ── THUMBNAIL MODE ────────────────────────────────────────────
  if (effectiveMode === 'thumbnail') {
    const defaultTime =
      opts.durationSec !== undefined && opts.durationSec < 1.5 ? '00:00:00' : '00:00:01';
    const seekTime = opts.thTime?.trim() ? opts.thTime.trim() : defaultTime;

    args.push('-ss', seekTime);
    args.push('-i', input);
    args.push('-frames:v', '1');
    if (opts.thQ && opts.thQ.trim() && outputExt !== 'png') {
      args.push('-q:v', opts.thQ.trim());
    }
    if (opts.threads && opts.threads !== 'auto') args.push('-threads', opts.threads);
    if (opts.noMeta) args.push('-map_metadata', '-1');
    args.push(...tokenizeCustomArgs(opts.custom));
    args.push(outputName);

    return { args, outputName, outputExt, warnings, errors };
  }

  // ── GIF MODE (single-pass palettegen/paletteuse) ──────────────
  if (effectiveMode === 'gif') {
    if (hasStart) args.push('-ss', opts.ts_start!.trim());
    args.push('-i', input);
    if (durationSec !== null) args.push('-t', formatDurationSeconds(durationSec));

    const gifFps = (opts.gifFps || opts.gFps || '15').trim();
    const gifW = (opts.gifW || opts.gW || '480').trim();
    const preFilters = buildVideoFilterChain({ ...opts, res: undefined });
    const preChain = preFilters.length > 0 ? `${preFilters.join(',')},` : '';
    const paletteFilter = `${preChain}fps=${gifFps},scale=${gifW}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

    args.push('-vf', paletteFilter);
    args.push('-an');
    if (opts.gLoop !== undefined && opts.gLoop !== '') {
      args.push('-loop', opts.gLoop);
    }
    if (opts.threads && opts.threads !== 'auto') args.push('-threads', opts.threads);
    if (opts.noMeta) args.push('-map_metadata', '-1');
    args.push(...tokenizeCustomArgs(opts.custom));
    args.push(outputName);

    return { args, outputName, outputExt, warnings, errors };
  }

  // ── REMUX MODE ────────────────────────────────────────────────
  if (effectiveMode === 'remux') {
    if (hasStart) args.push('-ss', opts.ts_start!.trim());
    args.push('-i', input);
    if (durationSec !== null) args.push('-t', formatDurationSeconds(durationSec));

    args.push('-c:v', 'copy');
    if (opts.noAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'copy');
    }
    if (opts.webOpt && outputExt === 'mp4') args.push('-movflags', '+faststart');
    if (opts.noMeta) args.push('-map_metadata', '-1');
    if (opts.threads && opts.threads !== 'auto') args.push('-threads', opts.threads);
    args.push(...tokenizeCustomArgs(opts.custom));
    args.push(outputName);

    return { args, outputName, outputExt, warnings, errors };
  }

  // ── AUDIO MODE ────────────────────────────────────────────────
  if (effectiveMode === 'audio') {
    const ac = normalizeAudioCodec(opts.ac);
    if (hasStart) args.push('-ss', opts.ts_start!.trim());
    args.push('-i', input);
    if (durationSec !== null) args.push('-t', formatDurationSeconds(durationSec));

    args.push('-vn');

    if (ac === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', ac);
      if (ac !== 'flac' && ac !== 'pcm_s16le' && opts.ab) {
        args.push('-b:a', normalizeBitrate(opts.ab));
      }
      if (opts.sr) args.push('-ar', opts.sr);
      if (opts.ch) args.push('-ac', opts.ch);

      const af = buildAudioFilterChain(opts);
      if (af.length > 0) {
        args.push('-filter:a', af.join(','));
      }
    }

    if (opts.noMeta) args.push('-map_metadata', '-1');
    if (opts.threads && opts.threads !== 'auto') args.push('-threads', opts.threads);
    args.push(...tokenizeCustomArgs(opts.custom));
    args.push(outputName);

    return { args, outputName, outputExt, warnings, errors };
  }

  // ── CONVERT MODE ──────────────────────────────────────────────
  const vc = (opts.vc || 'libx264').trim().toLowerCase();
  const hw = opts.hwaccel || 'none';
  const useWatermark = Boolean(opts.hasWm && opts.wmPath && vc !== 'copy');

  // 1. Input options BEFORE -i (hwaccel MUST precede -i!)
  if (vc !== 'copy' && (hw === 'cuda' || hw === 'qsv')) {
    args.push('-hwaccel', hw);
  }
  if (hasStart) {
    args.push('-ss', opts.ts_start!.trim());
  }

  // 2. ALL -i inputs BEFORE output options & filters
  args.push('-i', input);
  if (useWatermark && opts.wmPath) {
    args.push('-i', opts.wmPath);
  }

  // 3. Output trim duration AFTER all -i inputs
  if (durationSec !== null) {
    args.push('-t', formatDurationSeconds(durationSec));
  }

  // 4. Video filters (only when not stream-copying video)
  if (vc !== 'copy') {
    const vf = buildVideoFilterChain(opts);
    if (useWatermark) {
      const pos = opts.wmPos ? (_OVL[opts.wmPos] || 'W-w-10:H-h-10') : 'W-w-10:H-h-10';
      const wmOpa = Math.min(Math.max(opts.wmOpa ?? 0.75, 0), 1);
      const chain = vf.length
        ? `[0:v]${vf.join(',')}[base];[1:v]format=rgba,colorchannelmixer=aa=${wmOpa}[wm];[base][wm]overlay=${pos}`
        : `[1:v]format=rgba,colorchannelmixer=aa=${wmOpa}[wm];[0:v][wm]overlay=${pos}`;
      args.push('-filter_complex', chain);
    } else if (vf.length > 0) {
      args.push('-vf', vf.join(','));
    }
  }

  // 5. Video codec & rate control
  if (vc === 'copy') {
    args.push('-c:v', 'copy');
  } else if (hw === 'cuda') {
    const nvenc = vc === 'libx265' ? 'hevc_nvenc' : 'h264_nvenc';
    args.push('-c:v', nvenc);
    if (vc === 'libx265') args.push('-vtag', 'hvc1');
    if (opts.vbr) {
      args.push('-b:v', normalizeBitrate(opts.vbr));
    } else {
      args.push('-cq', opts.crf || '23');
    }
  } else if (hw === 'qsv') {
    const qsv = vc === 'libx265' ? 'hevc_qsv' : 'h264_qsv';
    args.push('-c:v', qsv);
    if (vc === 'libx265') args.push('-vtag', 'hvc1');
    if (opts.vbr) {
      args.push('-b:v', normalizeBitrate(opts.vbr));
    } else {
      args.push('-global_quality', opts.crf || '23');
    }
  } else {
    args.push('-c:v', vc);
    if (vc === 'libx265') args.push('-vtag', 'hvc1');
    if (vc === 'prores_ks') args.push('-profile:v', '3');

    if (opts.vbr) {
      args.push('-b:v', normalizeBitrate(opts.vbr));
    } else if (opts.tsz && opts.durationSec && opts.durationSec > 0) {
      const targetMb = Number(opts.tsz);
      if (Number.isFinite(targetMb) && targetMb > 0) {
        const totalKbps = (targetMb * 8192) / opts.durationSec;
        const audioKbps = opts.noAudio ? 0 : 128;
        const videoKbps = Math.max(100, Math.floor(totalKbps - audioKbps));
        args.push('-b:v', `${videoKbps}k`);
      }
    } else if (vc === 'libx264' || vc === 'libx265') {
      args.push('-crf', opts.crf || '23');
    } else if (vc === 'libvpx-vp9') {
      args.push('-crf', opts.crf || '30', '-b:v', '0');
    }

    if ((vc === 'libx264' || vc === 'libx265') && opts.preset) {
      args.push('-preset', opts.preset);
    }
    if ((vc === 'libx264' || vc === 'libx265') && opts.tune && opts.tune !== 'none') {
      args.push('-tune', opts.tune);
    }
  }

  if (opts.fps && opts.fps !== 'original' && vc !== 'copy') args.push('-r', opts.fps);
  if (opts.pixFmt && vc !== 'copy') args.push('-pix_fmt', opts.pixFmt);
  if (opts.aspect && opts.aspect !== 'auto' && vc !== 'copy') args.push('-aspect', opts.aspect);
  if (opts.threads && opts.threads !== 'auto') args.push('-threads', opts.threads);

  // 6. Audio
  if (opts.noAudio) {
    args.push('-an');
  } else {
    const ac = normalizeAudioCodec(opts.ac);
    if (ac === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', ac);
      if (ac !== 'flac' && ac !== 'pcm_s16le' && opts.ab) {
        args.push('-b:a', normalizeBitrate(opts.ab));
      }
      if (opts.sr) args.push('-ar', opts.sr);
      if (opts.ch) args.push('-ac', opts.ch);

      const af = buildAudioFilterChain(opts);
      if (af.length > 0) {
        args.push('-filter:a', af.join(','));
      }
    }
  }

  // 7. Container & extra options
  if (opts.webOpt && outputExt === 'mp4') args.push('-movflags', '+faststart');
  if (opts.noMeta) args.push('-map_metadata', '-1');
  args.push(...tokenizeCustomArgs(opts.custom));
  args.push(outputName);

  return { args, outputName, outputExt, warnings, errors };
}

/**
 * Builds the validated array of arguments to be passed to FFmpeg.
 * Throws an Error if validation fails.
 */
export function buildFFmpegArgs(
  opts: CommandOptions,
  platform: RuntimePlatform = DEFAULT_PLATFORM,
): string[] {
  const plan = planFFmpegJob(opts, platform);
  if (plan.errors.length > 0) {
    throw new Error(plan.errors.join('; '));
  }
  return plan.args;
}
