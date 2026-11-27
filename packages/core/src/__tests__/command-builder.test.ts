import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildAtempoChain,
  buildFFmpegArgs,
  deriveOutputPath,
  escapeSubtitlePath,
  getCompatibleCodecs,
  getPlatformCapabilities,
  normalizeAudioCodec,
  normalizeBitrate,
  parseTimestamp,
  planFFmpegJob,
  reconcileOptionsForFormat,
  tokenizeCustomArgs,
  validateOptions,
} from '../index';
import type { CommandOptions } from '../types';

const BASE_CONVERT: CommandOptions = {
  mode: 'convert',
  input: 'sample.mp4',
  fmt: 'mp4',
  vc: 'libx264',
  ac: 'aac',
  crf: '23',
};

describe('@ffmpeg-ui/core — Capabilities & Normalization', () => {
  it('exposes accurate platform capabilities for wasm, desktop, and local-server', () => {
    const wasm = getPlatformCapabilities('wasm');
    expect(wasm.modes).toEqual(['convert', 'audio', 'remux', 'thumbnail', 'gif']);
    expect(wasm.modes).not.toContain('merge');
    expect(wasm.videoCodecs).toEqual(['libx264', 'prores_ks', 'copy']);
    expect(wasm.videoCodecs).not.toContain('libx265');
    expect(wasm.videoCodecs).not.toContain('libvpx-vp9');
    expect(wasm.hwaccels).toEqual(['none']);
    expect(wasm.audioCodecs).toEqual(['aac', 'libmp3lame', 'libopus', 'flac', 'pcm_s16le', 'copy']);
    expect(wasm.disabledReasons.videoCodecs.libx265).toBeTruthy();
    expect(wasm.disabledReasons.videoCodecs['libvpx-vp9']).toBeTruthy();
    expect(wasm.disabledReasons.hwaccels.cuda).toBeTruthy();

    const desktop = getPlatformCapabilities('desktop');
    expect(desktop.videoCodecs).toContain('libx265');
    expect(desktop.videoCodecs).toContain('libvpx-vp9');
    expect(desktop.hwaccels).toEqual(['none', 'cuda', 'qsv']);
    expect(desktop.modes).not.toContain('merge');

    const localServer = getPlatformCapabilities('local-server');
    expect(localServer.modes).toContain('merge');
    expect(localServer.videoCodecs).toContain('libx265');
    expect(localServer.hwaccels).toEqual(['none', 'cuda', 'qsv']);
  });

  it('normalizes legacy audio codec identifiers', () => {
    expect(normalizeAudioCodec('mp3')).toBe('libmp3lame');
    expect(normalizeAudioCodec('opus')).toBe('libopus');
    expect(normalizeAudioCodec('MP3')).toBe('libmp3lame');
    expect(normalizeAudioCodec('OPUS')).toBe('libopus');
    expect(normalizeAudioCodec('aac')).toBe('aac');
    expect(normalizeAudioCodec('libmp3lame')).toBe('libmp3lame');
    expect(normalizeAudioCodec('libopus')).toBe('libopus');
  });

  it('reconciles options cleanly across container formats and platforms', () => {
    // Switching MP4 -> WebM on desktop switches codecs to VP9 + libopus
    const webm = reconcileOptionsForFormat(BASE_CONVERT, 'webm', 'desktop');
    expect(webm.fmt).toBe('webm');
    expect(webm.vc).toBe('libvpx-vp9');
    expect(webm.ac).toBe('libopus');

    // Switching MP4 -> MP3 switches to audio mode with libmp3lame and clamps 6ch/96kHz
    const mp3 = reconcileOptionsForFormat(
      { ...BASE_CONVERT, sr: '96000', ch: '6' },
      'mp3',
      'wasm',
    );
    expect(mp3.mode).toBe('audio');
    expect(mp3.fmt).toBe('mp3');
    expect(mp3.ac).toBe('libmp3lame');
    expect(mp3.sr).toBe('48000');
    expect(mp3.ch).toBe('2');

    // Switching to OGG reconciles 44100 Hz -> 48000 Hz for libopus
    const ogg = reconcileOptionsForFormat({ ...BASE_CONVERT, sr: '44100' }, 'ogg', 'wasm');
    expect(ogg.mode).toBe('audio');
    expect(ogg.ac).toBe('libopus');
    expect(ogg.sr).toBe('48000');

    // Switching to GIF switches to gif mode
    const gif = reconcileOptionsForFormat(BASE_CONVERT, 'gif', 'wasm');
    expect(gif.mode).toBe('gif');
    expect(gif.fmt).toBe('gif');
    expect(gif.noAudio).toBe(true);

    // Reconciling HEVC + CUDA onto WASM resets to libx264 + none
    const wasmSafe = reconcileOptionsForFormat(
      { ...BASE_CONVERT, vc: 'libx265', hwaccel: 'cuda' },
      'mp4',
      'wasm',
    );
    expect(wasmSafe.vc).toBe('libx264');
    expect(wasmSafe.hwaccel).toBe('none');
  });

  it('returns compatible codecs filtered by platform', () => {
    const webmDesktop = getCompatibleCodecs('webm', 'desktop');
    expect(webmDesktop.video).toEqual(['libvpx-vp9', 'copy']);
    expect(webmDesktop.audio).toEqual(['libopus', 'copy']);

    const webmWasm = getCompatibleCodecs('webm', 'wasm');
    expect(webmWasm.video).toEqual(['copy']);
  });
});

describe('@ffmpeg-ui/core — Helper Utilities', () => {
  it('parses HH:MM:SS, MM:SS, fractional, and raw second timestamps', () => {
    expect(parseTimestamp('00:00:04')).toBe(4);
    expect(parseTimestamp('00:01:30.5')).toBe(90.5);
    expect(parseTimestamp('02:15')).toBe(135);
    expect(parseTimestamp('02:15.25')).toBe(135.25);
    expect(parseTimestamp('12')).toBe(12);
    expect(parseTimestamp('12.75')).toBe(12.75);
    expect(parseTimestamp('00:00:00')).toBe(0);
    expect(parseTimestamp('-5')).toBeNull();
    expect(parseTimestamp('00:75:00')).toBeNull();
    expect(parseTimestamp('not-a-time')).toBeNull();
  });

  it('chains atempo properly for speeds < 0.5 and > 2.0', () => {
    expect(buildAtempoChain(1.0)).toEqual([]);
    expect(buildAtempoChain(0.5)).toEqual(['atempo=0.5']);
    expect(buildAtempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(buildAtempoChain(2.0)).toEqual(['atempo=2.0']);
    expect(buildAtempoChain(4.0)).toEqual(['atempo=2.0', 'atempo=2.0']);
    expect(buildAtempoChain(0.125)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.5']);
    expect(buildAtempoChain(3.0)).toEqual(['atempo=2.0', 'atempo=1.5']);
  });

  it('derives output paths safely without corrupting dotted directories or overwriting input', () => {
    expect(deriveOutputPath('dir.with.dots/clip_noext', 'mkv')).toEqual({
      outputName: 'dir.with.dots/clip_noext_converted.mkv',
      outputExt: 'mkv',
    });
    expect(deriveOutputPath('C:\\dir.with.dots\\clip_noext', 'mp4')).toEqual({
      outputName: 'C:\\dir.with.dots\\clip_noext_converted.mp4',
      outputExt: 'mp4',
    });
    expect(deriveOutputPath('sample.mp4', 'mp4')).toEqual({
      outputName: 'sample_converted.mp4',
      outputExt: 'mp4',
    });
    expect(deriveOutputPath('sample.mp4', 'mp4', 'custom_out.mp4')).toEqual({
      outputName: 'custom_out.mp4',
      outputExt: 'mp4',
    });
  });

  it('normalizes video bitrate suffixes without mangling units', () => {
    expect(normalizeBitrate('5M')).toBe('5M');
    expect(normalizeBitrate('2500k')).toBe('2500k');
    expect(normalizeBitrate('2500')).toBe('2500k');
  });

  it('tokenizes custom FFmpeg arguments preserving quotes and skipping empties', () => {
    expect(tokenizeCustomArgs('   ')).toEqual([]);
    expect(tokenizeCustomArgs('-bufsize 2M   -maxrate 4M')).toEqual(['-bufsize', '2M', '-maxrate', '4M']);
    expect(tokenizeCustomArgs('-metadata title="My Great Video" -movflags +faststart')).toEqual([
      '-metadata',
      'title=My Great Video',
      '-movflags',
      '+faststart',
    ]);
    expect(tokenizeCustomArgs("-metadata comment='hello world'")).toEqual([
      '-metadata',
      'comment=hello world',
    ]);
  });

  it('escapes Windows and lavfi special characters in subtitle paths', () => {
    const escaped = escapeSubtitlePath("C:\\Users\\Test [1]\\sub's.srt");
    expect(escaped).toBe("C\\:/Users/Test \\[1\\]/sub'\\''s.srt");
  });
});

describe('@ffmpeg-ui/core — Command Planner Bug Fixes', () => {
  it('places -hwaccel BEFORE -i and maps HEVC NVENC/QSV with -cq / -global_quality', () => {
    const cudaPlan = planFFmpegJob(
      { ...BASE_CONVERT, vc: 'libx265', hwaccel: 'cuda', crf: '24' },
      'desktop',
    );
    expect(cudaPlan.errors).toEqual([]);
    const hwIdx = cudaPlan.args.indexOf('-hwaccel');
    const inIdx = cudaPlan.args.indexOf('-i');
    expect(hwIdx).toBeGreaterThan(-1);
    expect(hwIdx).toBeLessThan(inIdx);
    expect(cudaPlan.args[hwIdx + 1]).toBe('cuda');
    expect(cudaPlan.args).toContain('hevc_nvenc');
    expect(cudaPlan.args).toContain('-cq');
    expect(cudaPlan.args).toContain('24');

    const qsvPlan = planFFmpegJob(
      { ...BASE_CONVERT, vc: 'libx265', hwaccel: 'qsv', crf: '22' },
      'desktop',
    );
    expect(qsvPlan.errors).toEqual([]);
    expect(qsvPlan.args.indexOf('-hwaccel')).toBeLessThan(qsvPlan.args.indexOf('-i'));
    expect(qsvPlan.args).toContain('hevc_qsv');
    expect(qsvPlan.args).toContain('-global_quality');
    expect(qsvPlan.args).toContain('22');
  });

  it('computes accurate trim duration -t (end - start) placed AFTER all -i inputs and rejects end <= start', () => {
    const trimPlan = planFFmpegJob({
      ...BASE_CONVERT,
      ts_start: '00:00:04',
      ts_end: '00:00:06',
      hasWm: true,
      wmPath: 'logo.png',
    });
    expect(trimPlan.errors).toEqual([]);
    const ssIdx = trimPlan.args.indexOf('-ss');
    const firstInIdx = trimPlan.args.indexOf('-i');
    const secondInIdx = trimPlan.args.lastIndexOf('-i');
    const tIdx = trimPlan.args.indexOf('-t');
    expect(ssIdx).toBeLessThan(firstInIdx);
    expect(secondInIdx).toBeGreaterThan(firstInIdx);
    expect(tIdx).toBeGreaterThan(secondInIdx);
    expect(trimPlan.args[tIdx + 1]).toBe('2');

    const badTrim = planFFmpegJob({
      ...BASE_CONVERT,
      ts_start: '00:00:06',
      ts_end: '00:00:04',
    });
    expect(badTrim.errors.length).toBeGreaterThan(0);

    const equalTrim = planFFmpegJob({
      ...BASE_CONVERT,
      ts_start: '00:00:04',
      ts_end: '00:00:04',
    });
    expect(equalTrim.errors.length).toBeGreaterThan(0);
  });

  it('prepends format=rgba for watermarks and honors wmOpa: 0', () => {
    const plan = planFFmpegJob({
      ...BASE_CONVERT,
      hasWm: true,
      wmPath: 'logo.jpg',
      wmOpa: 0,
    });
    expect(plan.errors).toEqual([]);
    const fcIdx = plan.args.indexOf('-filter_complex');
    expect(fcIdx).toBeGreaterThan(-1);
    expect(plan.args[fcIdx + 1]).toContain('format=rgba,colorchannelmixer=aa=0');
  });

  it('honors vol: 0 (mute) in both convert and audio modes', () => {
    const convertPlan = planFFmpegJob({ ...BASE_CONVERT, vol: 0 });
    expect(convertPlan.errors).toEqual([]);
    expect(convertPlan.args).toContain('-filter:a');
    expect(convertPlan.args).toContain('volume=0.00');

    const audioPlan = planFFmpegJob({
      mode: 'audio',
      input: 'clip.mp4',
      fmt: 'mp3',
      vc: '',
      ac: 'mp3',
      vol: 0,
    });
    expect(audioPlan.errors).toEqual([]);
    expect(audioPlan.args).toContain('libmp3lame');
    expect(audioPlan.args).toContain('volume=0.00');
  });

  it('builds single-pass palettegen GIF command for both mode="gif" and fmt="gif"', () => {
    const gifPlan = planFFmpegJob({
      mode: 'gif',
      input: 'clip.mp4',
      fmt: 'gif',
      vc: 'libx264',
      ac: 'aac',
      gifFps: '12',
      gifW: '320',
    });
    expect(gifPlan.errors).toEqual([]);
    expect(gifPlan.outputExt).toBe('gif');
    expect(gifPlan.outputName).toBe('clip_converted.gif');
    expect(gifPlan.args).toContain('-an');
    const vfIdx = gifPlan.args.indexOf('-vf');
    expect(gifPlan.args[vfIdx + 1]).toBe(
      'fps=12,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
    );

    const autoGif = planFFmpegJob({ ...BASE_CONVERT, fmt: 'gif' });
    expect(autoGif.errors).toEqual([]);
    expect(autoGif.outputExt).toBe('gif');
    expect(autoGif.args).toContain('-an');
  });

  it('builds thumbnail command honoring thTime, thFmt, thQ, and returns matching outputExt', () => {
    const plan = planFFmpegJob({
      mode: 'thumbnail',
      input: 'clip.mp4',
      fmt: 'mp4',
      vc: 'libx264',
      ac: 'aac',
      thTime: '00:00:02',
      thFmt: 'webp',
      thQ: '80',
    });
    expect(plan.errors).toEqual([]);
    expect(plan.outputExt).toBe('webp');
    expect(plan.outputName).toBe('clip_converted.webp');
    expect(plan.args).toContain('-ss');
    expect(plan.args).toContain('00:00:02');
    expect(plan.args).toContain('-q:v');
    expect(plan.args).toContain('80');

    const shortClipThumb = planFFmpegJob({
      mode: 'thumbnail',
      input: 'short.mp4',
      fmt: 'mp4',
      vc: 'libx264',
      ac: 'aac',
      durationSec: 0.8,
    });
    expect(shortClipThumb.args[shortClipThumb.args.indexOf('-ss') + 1]).toBe('00:00:00');
  });

  it('enforces container/codec/param constraints and platform gating', () => {
    // WebM + libx264 rejected
    const badWebm = validateOptions({ ...BASE_CONVERT, fmt: 'webm', vc: 'libx264', ac: 'aac' }, 'desktop');
    expect(badWebm.valid).toBe(false);
    expect(badWebm.errors.length).toBeGreaterThanOrEqual(2);

    // libopus + 44100 Hz rejected
    const badOpus = validateOptions({ ...BASE_CONVERT, fmt: 'mkv', ac: 'opus', sr: '44100' }, 'desktop');
    expect(badOpus.valid).toBe(false);

    // mp3 + 6 channels rejected
    const badMp3Ch = validateOptions(
      { mode: 'audio', input: 'a.wav', fmt: 'mp3', vc: '', ac: 'libmp3lame', ch: '6' },
      'desktop',
    );
    expect(badMp3Ch.valid).toBe(false);

    // WASM rejects libx265, libvpx-vp9, cuda, merge
    expect(validateOptions({ ...BASE_CONVERT, vc: 'libx265' }, 'wasm').valid).toBe(false);
    expect(validateOptions({ ...BASE_CONVERT, fmt: 'mkv', vc: 'libvpx-vp9' }, 'wasm').valid).toBe(false);
    expect(validateOptions({ ...BASE_CONVERT, hwaccel: 'cuda' }, 'wasm').valid).toBe(false);
    expect(validateOptions({ ...BASE_CONVERT, mode: 'merge' }, 'wasm').valid).toBe(false);

    // Copy drops filters safely with warning
    const copyWithFilters = planFFmpegJob({
      ...BASE_CONVERT,
      vc: 'copy',
      ac: 'copy',
      res: '720p',
      sr: '48000',
      ch: '2',
      vol: 0.5,
    });
    expect(copyWithFilters.errors).toEqual([]);
    expect(copyWithFilters.warnings.length).toBeGreaterThanOrEqual(2);
    expect(copyWithFilters.args).not.toContain('-vf');
    expect(copyWithFilters.args).not.toContain('-ar');
    expect(copyWithFilters.args).not.toContain('-ac');
    expect(copyWithFilters.args).not.toContain('-filter:a');

    // Never emits literal [calc] -pass 2
    const tszNoDur = planFFmpegJob({ ...BASE_CONVERT, tsz: '8' });
    expect(tszNoDur.errors).toEqual([]);
    expect(tszNoDur.args).not.toContain('[calc]');
    expect(tszNoDur.args).not.toContain('-pass');
    expect(tszNoDur.warnings.length).toBeGreaterThan(0);

    // -tune skipped for libvpx-vp9
    const vp9Tune = planFFmpegJob(
      { ...BASE_CONVERT, fmt: 'webm', vc: 'libvpx-vp9', ac: 'libopus', tune: 'film' },
      'desktop',
    );
    expect(vp9Tune.errors).toEqual([]);
    expect(vp9Tune.args).not.toContain('-tune');
    expect(vp9Tune.warnings.length).toBeGreaterThan(0);

    // buildFFmpegArgs throws when plan has errors
    expect(() => buildFFmpegArgs({ ...BASE_CONVERT, vc: 'libx265' }, 'wasm')).toThrow();
  });
});

// ── Real FFmpeg / FFprobe Integration Suite ────────────────────────
function hasBinary(bin: string): boolean {
  const res = spawnSync(bin, ['-version'], { stdio: 'ignore' });
  return res.status === 0;
}

const FFMPEG_AVAILABLE = hasBinary('ffmpeg') && hasBinary('ffprobe');

interface ProbeResult {
  format: { duration?: string; format_name?: string };
  streams: Array<{
    codec_type: string;
    codec_name: string;
    channels?: number;
    sample_rate?: string;
    width?: number;
    height?: number;
  }>;
}

function runFFmpeg(args: string[]): void {
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed (rc=${res.status}):\nargs=${JSON.stringify(args)}\n${res.stderr}`);
  }
}

function probe(filePath: string): ProbeResult {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { encoding: 'utf8' },
  );
  return JSON.parse(out) as ProbeResult;
}

describe.skipIf(!FFMPEG_AVAILABLE)('@ffmpeg-ui/core — Real FFmpeg Integration Suite', () => {
  let tmpDir = '';
  let sampleMp4 = '';
  let sampleWav = '';
  let sampleJpg = '';
  let sampleSrt = '';
  let dottedDirInput = '';

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-ui-core-test-'));
    sampleMp4 = path.join(tmpDir, 'sample.mp4');
    sampleWav = path.join(tmpDir, 'sample.wav');
    sampleJpg = path.join(tmpDir, 'watermark.jpg');
    sampleSrt = path.join(tmpDir, 'subtitles.srt');

    // 8s synthetic H.264 + AAC MP4 (fast 160x120 @ 15fps)
    runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=8:size=160x120:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8:sample_rate=48000',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      sampleMp4,
    ]);

    // 4s synthetic stereo WAV
    runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4:sample_rate=48000',
      '-ac', '2',
      sampleWav,
    ]);

    // Tiny non-alpha JPG watermark
    runFFmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=1',
      '-frames:v', '1',
      sampleJpg,
    ]);

    // Simple SRT subtitle file
    fs.writeFileSync(
      sampleSrt,
      '1\n00:00:00,000 --> 00:00:03,000\nHello FFmpeg UI\n',
      'utf8',
    );

    // Extensionless input inside a dotted directory
    const dottedDir = path.join(tmpDir, 'dir.with.dots');
    fs.mkdirSync(dottedDir, { recursive: true });
    dottedDirInput = path.join(dottedDir, 'clip_noext');
    fs.copyFileSync(sampleMp4, dottedDirInput);
  }, 30000);

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('converts H.264 MP4 cleanly', () => {
    const out = path.join(tmpDir, 'out_h264.mp4');
    const plan = planFFmpegJob({
      mode: 'convert', input: sampleMp4, output: out, fmt: 'mp4', vc: 'libx264', ac: 'aac', crf: '28', preset: 'ultrafast',
    });
    expect(plan.errors).toEqual([]);
    runFFmpeg(plan.args);
    const info = probe(out);
    expect(info.streams.find(s => s.codec_type === 'video')?.codec_name).toBe('h264');
    expect(info.streams.find(s => s.codec_type === 'audio')?.codec_name).toBe('aac');
  });

  it('converts HQ MP3 preset cleanly (libmp3lame)', () => {
    const out = path.join(tmpDir, 'out_hq.mp3');
    const plan = planFFmpegJob({
      mode: 'audio', input: sampleWav, output: out, fmt: 'mp3', vc: '', ac: 'libmp3lame', ab: '320k',
    });
    expect(plan.errors).toEqual([]);
    runFFmpeg(plan.args);
    const info = probe(out);
    expect(info.streams[0]?.codec_name).toBe('mp3');
  });

  it('converts Opus OGG and Opus MKV cleanly', () => {
    const outOgg = path.join(tmpDir, 'out.ogg');
    const oggPlan = planFFmpegJob({
      mode: 'audio', input: sampleWav, output: outOgg, fmt: 'ogg', vc: '', ac: 'opus', ab: '64k',
    });
    expect(oggPlan.errors).toEqual([]);
    runFFmpeg(oggPlan.args);
    expect(probe(outOgg).streams[0]?.codec_name).toBe('opus');

    const outMkv = path.join(tmpDir, 'out_opus.mkv');
    const mkvPlan = planFFmpegJob({
      mode: 'convert', input: sampleMp4, output: outMkv, fmt: 'mkv', vc: 'libx264', ac: 'libopus', preset: 'ultrafast',
    });
    expect(mkvPlan.errors).toEqual([]);
    runFFmpeg(mkvPlan.args);
    const info = probe(outMkv);
    expect(info.streams.find(s => s.codec_type === 'audio')?.codec_name).toBe('opus');
  });

  it('converts lossless FLAC and WAV cleanly', () => {
    const outFlac = path.join(tmpDir, 'out.flac');
    runFFmpeg(buildFFmpegArgs({
      mode: 'audio', input: sampleWav, output: outFlac, fmt: 'flac', vc: '', ac: 'flac',
    }));
    expect(probe(outFlac).streams[0]?.codec_name).toBe('flac');

    const outWav = path.join(tmpDir, 'out.wav');
    runFFmpeg(buildFFmpegArgs({
      mode: 'audio', input: sampleMp4, output: outWav, fmt: 'wav', vc: '', ac: 'pcm_s16le',
    }));
    expect(probe(outWav).streams[0]?.codec_name).toBe('pcm_s16le');
  });

  it('remuxes MP4 to MKV cleanly', () => {
    const out = path.join(tmpDir, 'remux.mkv');
    runFFmpeg(buildFFmpegArgs({
      mode: 'remux', input: sampleMp4, output: out, fmt: 'mkv', vc: 'copy', ac: 'copy',
    }));
    const info = probe(out);
    expect(info.streams.find(s => s.codec_type === 'video')?.codec_name).toBe('h264');
  });

  it('generates palettegen GIF cleanly', () => {
    const out = path.join(tmpDir, 'out.gif');
    const plan = planFFmpegJob({
      mode: 'gif', input: sampleMp4, output: out, fmt: 'gif', vc: '', ac: '', gifFps: '10', gifW: '120', ts_end: '00:00:02',
    });
    expect(plan.errors).toEqual([]);
    expect(plan.outputExt).toBe('gif');
    runFFmpeg(plan.args);
    const info = probe(out);
    expect(info.streams[0]?.codec_name).toBe('gif');
    expect(info.streams.find(s => s.codec_type === 'audio')).toBeUndefined();
  });

  it('extracts JPG thumbnail cleanly with accurate outputExt', () => {
    const out = path.join(tmpDir, 'thumb.jpg');
    const plan = planFFmpegJob({
      mode: 'thumbnail', input: sampleMp4, output: out, fmt: 'mp4', vc: '', ac: '', thTime: '00:00:01', thFmt: 'jpg', thQ: '2',
    });
    expect(plan.errors).toEqual([]);
    expect(plan.outputExt).toBe('jpg');
    runFFmpeg(plan.args);
    const info = probe(out);
    expect(info.streams[0]?.codec_name).toBe('mjpeg');
  });

  it('trims 00:00:04 -> 00:00:06 to ~2.0s duration', () => {
    const out = path.join(tmpDir, 'trimmed.mp4');
    runFFmpeg(buildFFmpegArgs({
      mode: 'convert', input: sampleMp4, output: out, fmt: 'mp4', vc: 'libx264', ac: 'aac', preset: 'ultrafast',
      ts_start: '00:00:04', ts_end: '00:00:06',
    }));
    const dur = Number(probe(out).format.duration);
    expect(dur).toBeGreaterThan(1.7);
    expect(dur).toBeLessThan(2.3);
  });

  it('applies 0.25x and 4.0x speed using chained atempo cleanly', () => {
    const outSlow = path.join(tmpDir, 'slow.mp4');
    runFFmpeg(buildFFmpegArgs({
      mode: 'convert', input: sampleMp4, output: outSlow, fmt: 'mp4', vc: 'libx264', ac: 'aac', preset: 'ultrafast',
      ts_end: '00:00:02', speed: 0.25,
    }));
    expect(fs.statSync(outSlow).size).toBeGreaterThan(0);

    const outFast = path.join(tmpDir, 'fast.mp4');
    runFFmpeg(buildFFmpegArgs({
      mode: 'convert', input: sampleMp4, output: outFast, fmt: 'mp4', vc: 'libx264', ac: 'aac', preset: 'ultrafast',
      speed: 4.0,
    }));
    const fastDur = Number(probe(outFast).format.duration);
    expect(fastDur).toBeGreaterThan(1.5);
    expect(fastDur).toBeLessThan(2.6);
  });

  it('mutes audio with vol: 0', () => {
    const out = path.join(tmpDir, 'muted.mp4');
    runFFmpeg(buildFFmpegArgs({
      mode: 'convert', input: sampleMp4, output: out, fmt: 'mp4', vc: 'libx264', ac: 'aac', preset: 'ultrafast',
      ts_end: '00:00:02', vol: 0,
    }));
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  });

  it('overlays non-alpha JPG watermark with wmOpa: 0 and wmOpa: 0.5', () => {
    const outZero = path.join(tmpDir, 'wm_0.mp4');
    runFFmpeg(buildFFmpegArgs({
      mode: 'convert', input: sampleMp4, output: outZero, fmt: 'mp4', vc: 'libx264', ac: 'aac', preset: 'ultrafast',
      ts_start: '00:00:02', ts_end: '00:00:04', hasWm: true, wmPath: sampleJpg, wmOpa: 0, wmPos: 'br',
    }));
    const durZero = Number(probe(outZero).format.duration);
    expect(durZero).toBeGreaterThan(1.7);
    expect(durZero).toBeLessThan(2.3);

    const outHalf = path.join(tmpDir, 'wm_half.mp4');
    runFFmpeg(buildFFmpegArgs({
      mode: 'convert', input: sampleMp4, output: outHalf, fmt: 'mp4', vc: 'libx264', ac: 'aac', preset: 'ultrafast',
      ts_end: '00:00:02', hasWm: true, wmPath: sampleJpg, wmOpa: 0.5, wmPos: 'center',
    }));
    expect(fs.statSync(outHalf).size).toBeGreaterThan(0);
  });

  it('burns subtitles from native Windows/POSIX path cleanly', () => {
    const out = path.join(tmpDir, 'subbed.mp4');
    runFFmpeg(buildFFmpegArgs({
      mode: 'convert', input: sampleMp4, output: out, fmt: 'mp4', vc: 'libx264', ac: 'aac', preset: 'ultrafast',
      ts_end: '00:00:02', hasSub: true, subMode: 'burn', subPath: sampleSrt,
    }));
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  });

  it('preserves dotted directory for extensionless input path', () => {
    const plan = planFFmpegJob({
      mode: 'remux', input: dottedDirInput, fmt: 'mkv', vc: 'copy', ac: 'copy',
    });
    expect(plan.errors).toEqual([]);
    expect(plan.outputName).toBe(path.join(tmpDir, 'dir.with.dots', 'clip_noext_converted.mkv'));
    runFFmpeg(plan.args);
    expect(fs.existsSync(plan.outputName)).toBe(true);
  });

  it('supports volume + trim in audio mode cleanly', () => {
    const out = path.join(tmpDir, 'audio_trim_vol.mp3');
    runFFmpeg(buildFFmpegArgs({
      mode: 'audio', input: sampleMp4, output: out, fmt: 'mp3', vc: '', ac: 'libmp3lame', ab: '192k',
      vol: 0.5, ts_start: '00:00:02', ts_end: '00:00:04', noMeta: true,
    }));
    const dur = Number(probe(out).format.duration);
    expect(dur).toBeGreaterThan(1.7);
    expect(dur).toBeLessThan(2.3);
  });
});
