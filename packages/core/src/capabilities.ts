import type {
  AudioCodec,
  CommandOptions,
  CompatibleCodecs,
  HwAccel,
  PlatformCapabilities,
  ProcessingMode,
  RuntimePlatform,
  ValidationResult,
  VideoCodec,
} from './types';

export const DEFAULT_PLATFORM: RuntimePlatform = 'desktop';

export const AUDIO_ONLY_FORMATS = new Set(['mp3', 'm4a', 'ogg', 'wav', 'flac']);
export const VIDEO_FORMATS = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov', 'gif']);
export const THUMBNAIL_FORMATS = new Set(['jpg', 'png', 'webp']);

export const PLATFORM_CAPABILITIES: Record<RuntimePlatform, PlatformCapabilities> = {
  wasm: {
    platform: 'wasm',
    displayName: 'Web (WebAssembly)',
    modes: ['convert', 'audio', 'remux', 'thumbnail', 'gif'],
    videoCodecs: ['libx264', 'prores_ks', 'copy'],
    audioCodecs: ['aac', 'libmp3lame', 'libopus', 'flac', 'pcm_s16le', 'copy'],
    hwaccels: ['none'],
    videoContainers: ['mp4', 'mkv', 'avi', 'mov', 'gif'],
    audioContainers: ['mp3', 'm4a', 'ogg', 'wav', 'flac'],
    disabledReasons: {
      modes: {
        merge: 'Merge requires multi-file concat on Local Server (Desktop / Local Server only)',
      },
      videoCodecs: {
        libx265: 'H.265 (libx265) deadlocks single-threaded browser WASM (Desktop / Local Server only)',
        'libvpx-vp9': 'VP9 (libvpx-vp9) crashes browser WASM with OOB memory error (Desktop / Local Server only)',
      },
      audioCodecs: {},
      hwaccels: {
        cuda: 'NVIDIA CUDA is unavailable in browser WebAssembly (Desktop / Local Server only)',
        qsv: 'Intel QSV is unavailable in browser WebAssembly (Desktop / Local Server only)',
      },
      containers: {
        webm: 'WebM encoding requires VP9, which is unsupported in browser WASM (Desktop / Local Server only)',
      },
    },
  },
  desktop: {
    platform: 'desktop',
    displayName: 'Desktop (Tauri)',
    modes: ['convert', 'audio', 'remux', 'thumbnail', 'gif'],
    videoCodecs: ['libx264', 'libx265', 'libvpx-vp9', 'prores_ks', 'copy'],
    audioCodecs: ['aac', 'libmp3lame', 'libopus', 'flac', 'pcm_s16le', 'copy'],
    hwaccels: ['none', 'cuda', 'qsv'],
    videoContainers: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'gif'],
    audioContainers: ['mp3', 'm4a', 'ogg', 'wav', 'flac'],
    disabledReasons: {
      modes: {
        merge: 'Merge is currently supported on Local Server only',
      },
      videoCodecs: {},
      audioCodecs: {},
      hwaccels: {},
      containers: {},
    },
  },
  'local-server': {
    platform: 'local-server',
    displayName: 'Web (Local Server)',
    modes: ['convert', 'audio', 'remux', 'thumbnail', 'gif', 'merge'],
    videoCodecs: ['libx264', 'libx265', 'libvpx-vp9', 'prores_ks', 'copy'],
    audioCodecs: ['aac', 'libmp3lame', 'libopus', 'flac', 'pcm_s16le', 'copy'],
    hwaccels: ['none', 'cuda', 'qsv'],
    videoContainers: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'gif'],
    audioContainers: ['mp3', 'm4a', 'ogg', 'wav', 'flac'],
    disabledReasons: {
      modes: {},
      videoCodecs: {},
      audioCodecs: {},
      hwaccels: {},
      containers: {},
    },
  },
};

interface ContainerRule {
  video: readonly VideoCodec[];
  audio: readonly AudioCodec[];
  defaultVideo?: VideoCodec;
  defaultAudio?: AudioCodec;
  isAudioOnly: boolean;
  isGif: boolean;
}

const CONTAINER_RULES: Record<string, ContainerRule> = {
  mp4: {
    video: ['libx264', 'libx265', 'copy'],
    audio: ['aac', 'libmp3lame', 'libopus', 'copy'],
    defaultVideo: 'libx264',
    defaultAudio: 'aac',
    isAudioOnly: false,
    isGif: false,
  },
  mkv: {
    video: ['libx264', 'libx265', 'libvpx-vp9', 'prores_ks', 'copy'],
    audio: ['aac', 'libmp3lame', 'libopus', 'flac', 'pcm_s16le', 'copy'],
    defaultVideo: 'libx264',
    defaultAudio: 'aac',
    isAudioOnly: false,
    isGif: false,
  },
  webm: {
    video: ['libvpx-vp9', 'copy'],
    audio: ['libopus', 'copy'],
    defaultVideo: 'libvpx-vp9',
    defaultAudio: 'libopus',
    isAudioOnly: false,
    isGif: false,
  },
  mov: {
    video: ['libx264', 'libx265', 'prores_ks', 'copy'],
    audio: ['aac', 'libmp3lame', 'pcm_s16le', 'copy'],
    defaultVideo: 'libx264',
    defaultAudio: 'aac',
    isAudioOnly: false,
    isGif: false,
  },
  avi: {
    video: ['libx264', 'copy'],
    audio: ['libmp3lame', 'aac', 'pcm_s16le', 'copy'],
    defaultVideo: 'libx264',
    defaultAudio: 'libmp3lame',
    isAudioOnly: false,
    isGif: false,
  },
  gif: {
    video: [],
    audio: [],
    isAudioOnly: false,
    isGif: true,
  },
  mp3: {
    video: [],
    audio: ['libmp3lame', 'copy'],
    defaultAudio: 'libmp3lame',
    isAudioOnly: true,
    isGif: false,
  },
  m4a: {
    video: [],
    audio: ['aac', 'copy'],
    defaultAudio: 'aac',
    isAudioOnly: true,
    isGif: false,
  },
  ogg: {
    video: [],
    audio: ['libopus', 'flac', 'copy'],
    defaultAudio: 'libopus',
    isAudioOnly: true,
    isGif: false,
  },
  wav: {
    video: [],
    audio: ['pcm_s16le', 'copy'],
    defaultAudio: 'pcm_s16le',
    isAudioOnly: true,
    isGif: false,
  },
  flac: {
    video: [],
    audio: ['flac', 'copy'],
    defaultAudio: 'flac',
    isAudioOnly: true,
    isGif: false,
  },
};

export interface AudioCodecConstraints {
  allowedSampleRates?: readonly number[];
  maxSampleRate?: number;
  maxChannels?: number;
  supportsBitrate: boolean;
}

export const AUDIO_CODEC_CONSTRAINTS: Record<AudioCodec, AudioCodecConstraints> = {
  aac: {
    allowedSampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000],
    maxSampleRate: 96000,
    maxChannels: 6,
    supportsBitrate: true,
  },
  libmp3lame: {
    allowedSampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
    maxSampleRate: 48000,
    maxChannels: 2,
    supportsBitrate: true,
  },
  libopus: {
    allowedSampleRates: [8000, 12000, 16000, 24000, 48000],
    maxSampleRate: 48000,
    maxChannels: 8,
    supportsBitrate: true,
  },
  flac: {
    maxChannels: 8,
    supportsBitrate: false,
  },
  pcm_s16le: {
    maxChannels: 8,
    supportsBitrate: false,
  },
  copy: {
    supportsBitrate: false,
  },
};

export function getPlatformCapabilities(platform: RuntimePlatform = DEFAULT_PLATFORM): PlatformCapabilities {
  return PLATFORM_CAPABILITIES[platform] ?? PLATFORM_CAPABILITIES[DEFAULT_PLATFORM];
}

/**
 * Normalizes legacy or shorthand audio codec identifiers to canonical FFmpeg encoder names.
 */
export function normalizeAudioCodec(ac?: string): AudioCodec | string {
  if (!ac) return 'aac';
  const trimmed = ac.trim().toLowerCase();
  if (trimmed === 'mp3') return 'libmp3lame';
  if (trimmed === 'opus') return 'libopus';
  if (trimmed === 'wav' || trimmed === 'pcm') return 'pcm_s16le';
  return trimmed;
}

/**
 * Parses FFmpeg-style timestamps:
 * - HH:MM:SS(.ms)
 * - MM:SS(.ms)
 * - raw seconds (e.g. "12", "12.5")
 * Returns seconds as a non-negative number, or null if invalid.
 */
export function parseTimestamp(ts?: string): number | null {
  if (ts === undefined || ts === null) return null;
  const trimmed = ts.trim();
  if (!trimmed) return null;

  // Pure numeric seconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const parts = trimmed.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  if (parts.length === 2) {
    const [mStr, sStr] = parts;
    if (!/^\d+$/.test(mStr) || !/^\d+(\.\d+)?$/.test(sStr)) return null;
    const mins = Number(mStr);
    const secs = Number(sStr);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) return null;
    return mins * 60 + secs;
  }

  const [hStr, mStr, sStr] = parts;
  if (!/^\d+$/.test(hStr) || !/^\d+$/.test(mStr) || !/^\d+(\.\d+)?$/.test(sStr)) return null;
  const hours = Number(hStr);
  const mins = Number(mStr);
  const secs = Number(sStr);
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || !Number.isFinite(secs) || mins >= 60 || secs >= 60) {
    return null;
  }
  return hours * 3600 + mins * 60 + secs;
}

export function getCompatibleCodecs(
  fmt: string,
  platform: RuntimePlatform = DEFAULT_PLATFORM,
): CompatibleCodecs {
  const normalizedFmt = (fmt || 'mp4').trim().toLowerCase();
  const caps = getPlatformCapabilities(platform);
  const rule = CONTAINER_RULES[normalizedFmt];

  if (!rule) {
    return {
      video: [...caps.videoCodecs],
      audio: [...caps.audioCodecs],
      defaultVideo: caps.videoCodecs[0],
      defaultAudio: caps.audioCodecs[0],
      isAudioOnly: AUDIO_ONLY_FORMATS.has(normalizedFmt),
      isGif: normalizedFmt === 'gif',
    };
  }

  const video = rule.video.filter(c => caps.videoCodecs.includes(c));
  const audio = rule.audio.filter(c => caps.audioCodecs.includes(c));

  const defaultVideo =
    rule.defaultVideo && video.includes(rule.defaultVideo)
      ? rule.defaultVideo
      : video.find(c => c !== 'copy') ?? video[0];

  const defaultAudio =
    rule.defaultAudio && audio.includes(rule.defaultAudio)
      ? rule.defaultAudio
      : audio.find(c => c !== 'copy') ?? audio[0];

  return {
    video,
    audio,
    defaultVideo,
    defaultAudio,
    isAudioOnly: rule.isAudioOnly,
    isGif: rule.isGif,
  };
}

function reconcileAudioParamsForCodec(opts: CommandOptions, ac: string): Partial<CommandOptions> {
  const constraints = AUDIO_CODEC_CONSTRAINTS[ac as AudioCodec];
  if (!constraints) return {};

  const patch: Partial<CommandOptions> = {};
  if (ac === 'copy') {
    patch.sr = '';
    patch.ch = '';
    patch.ab = '';
    return patch;
  }

  if (!constraints.supportsBitrate) {
    patch.ab = '';
  }

  if (opts.sr) {
    const srNum = Number(opts.sr);
    if (Number.isFinite(srNum)) {
      if (constraints.allowedSampleRates && !constraints.allowedSampleRates.includes(srNum)) {
        // Pick nearest supported sample rate (defaulting to 48000 when available)
        patch.sr = constraints.allowedSampleRates.includes(48000) ? '48000' : String(constraints.allowedSampleRates[constraints.allowedSampleRates.length - 1]);
      } else if (constraints.maxSampleRate && srNum > constraints.maxSampleRate) {
        patch.sr = String(constraints.maxSampleRate);
      }
    }
  }

  if (opts.ch) {
    const chNum = Number(opts.ch);
    if (Number.isFinite(chNum) && constraints.maxChannels && chNum > constraints.maxChannels) {
      patch.ch = String(constraints.maxChannels);
    }
  }

  return patch;
}

/**
 * Reconciles CommandOptions when switching container format (or initializing for a platform),
 * ensuring compatible mode, video codec, audio codec, hwaccel, and audio parameters.
 */
export function reconcileOptionsForFormat(
  opts: CommandOptions,
  newFmt: string,
  platform: RuntimePlatform = DEFAULT_PLATFORM,
): CommandOptions {
  const fmt = (newFmt || opts.fmt || 'mp4').trim().toLowerCase();
  const caps = getPlatformCapabilities(platform);
  const compat = getCompatibleCodecs(fmt, platform);
  const next: CommandOptions = { ...opts, fmt };

  // Reconcile hwaccel against platform capabilities
  const hw: HwAccel = next.hwaccel ?? 'none';
  if (!caps.hwaccels.includes(hw)) {
    next.hwaccel = 'none';
  }

  // Handle GIF container
  if (compat.isGif) {
    next.mode = 'gif';
    next.fmt = 'gif';
    next.noAudio = true;
    next.gFps = next.gifFps || next.gFps || '15';
    next.gW = next.gifW || next.gW || '480';
    return next;
  }

  // Handle Audio-only containers
  if (compat.isAudioOnly) {
    next.mode = 'audio';
    next.noAudio = false;
    const normalizedAc = normalizeAudioCodec(next.ac);
    const chosenAc = compat.audio.includes(normalizedAc as AudioCodec)
      ? (normalizedAc as AudioCodec)
      : (compat.defaultAudio ?? 'aac');
    next.ac = chosenAc;
    Object.assign(next, reconcileAudioParamsForCodec(next, chosenAc));
    return next;
  }

  // Video container
  if (next.mode === 'audio' || next.mode === 'gif') {
    next.mode = 'convert';
  }

  // Reconcile video codec
  if (next.mode === 'convert') {
    const currentVc = (next.vc || 'libx264').trim().toLowerCase();
    if (!compat.video.includes(currentVc as VideoCodec)) {
      next.vc = compat.defaultVideo ?? 'libx264';
    } else {
      next.vc = currentVc;
    }

    // Reconcile audio codec
    const normalizedAc = normalizeAudioCodec(next.ac);
    const chosenAc = compat.audio.includes(normalizedAc as AudioCodec)
      ? (normalizedAc as AudioCodec)
      : (compat.defaultAudio ?? 'aac');
    next.ac = chosenAc;
    Object.assign(next, reconcileAudioParamsForCodec(next, chosenAc));
  } else {
    // Normalize audio codec in case user switches back to convert later
    next.ac = normalizeAudioCodec(next.ac);
  }

  return next;
}

export function isModeSupported(mode: ProcessingMode, platform: RuntimePlatform = DEFAULT_PLATFORM): boolean {
  return getPlatformCapabilities(platform).modes.includes(mode);
}

export function isVideoCodecSupported(vc: string, platform: RuntimePlatform = DEFAULT_PLATFORM): boolean {
  return getPlatformCapabilities(platform).videoCodecs.includes(vc as VideoCodec);
}

export function isHwAccelSupported(hw: HwAccel, platform: RuntimePlatform = DEFAULT_PLATFORM): boolean {
  return getPlatformCapabilities(platform).hwaccels.includes(hw);
}

export function isContainerSupported(fmt: string, platform: RuntimePlatform = DEFAULT_PLATFORM): boolean {
  const caps = getPlatformCapabilities(platform);
  const f = fmt.trim().toLowerCase();
  return caps.videoContainers.includes(f) || caps.audioContainers.includes(f);
}

/**
 * Validates CommandOptions against container rules, codec parameter limits, trim timestamps,
 * and runtime platform capabilities.
 */
export function validateOptions(
  opts: CommandOptions,
  platform: RuntimePlatform = DEFAULT_PLATFORM,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const caps = getPlatformCapabilities(platform);

  const effectiveMode: ProcessingMode =
    opts.mode === 'convert' && opts.fmt?.trim().toLowerCase() === 'gif'
      ? 'gif'
      : opts.mode;

  // 1. Platform mode support
  if (!caps.modes.includes(effectiveMode)) {
    const reason = caps.disabledReasons.modes[effectiveMode];
    errors.push(reason ?? `Mode "${effectiveMode}" is not supported on platform "${platform}".`);
  }

  // 2. Trim timestamp validation
  const rawStart = opts.ts_start?.trim();
  const rawEnd = opts.ts_end?.trim();
  const startSec = rawStart ? parseTimestamp(rawStart) : null;
  const endSec = rawEnd ? parseTimestamp(rawEnd) : null;

  if (rawStart && startSec === null) {
    errors.push(`Invalid trim start timestamp "${rawStart}". Use HH:MM:SS, MM:SS, or seconds.`);
  }
  if (rawEnd && endSec === null) {
    errors.push(`Invalid trim end timestamp "${rawEnd}". Use HH:MM:SS, MM:SS, or seconds.`);
  }
  if (startSec !== null && endSec !== null && endSec > 0 && endSec <= startSec) {
    errors.push(`Trim end time (${rawEnd}) must be greater than start time (${rawStart}).`);
  }

  // 3. Hardware acceleration support
  const hw: HwAccel = opts.hwaccel ?? 'none';
  if (effectiveMode === 'convert' && !caps.hwaccels.includes(hw)) {
    const reason = caps.disabledReasons.hwaccels[hw];
    errors.push(reason ?? `Hardware acceleration "${hw}" is not supported on platform "${platform}".`);
  }

  // 4. Thumbnail mode checks
  if (effectiveMode === 'thumbnail') {
    const thFmt = (opts.thFmt || 'jpg').trim().toLowerCase();
    if (!THUMBNAIL_FORMATS.has(thFmt)) {
      errors.push(`Unsupported thumbnail format "${thFmt}". Supported formats: jpg, png, webp.`);
    }
    if (opts.thTime && parseTimestamp(opts.thTime) === null) {
      errors.push(`Invalid thumbnail timestamp "${opts.thTime}". Use HH:MM:SS, MM:SS, or seconds.`);
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  // 5. GIF mode checks
  if (effectiveMode === 'gif') {
    const gifFps = Number(opts.gifFps || opts.gFps || '15');
    const gifW = Number(opts.gifW || opts.gW || '480');
    if (!Number.isFinite(gifFps) || gifFps <= 0 || gifFps > 60) {
      errors.push(`GIF FPS must be between 1 and 60 (got "${opts.gifFps || opts.gFps}").`);
    }
    if (!Number.isFinite(gifW) || gifW < 16 || gifW > 4096) {
      errors.push(`GIF width must be between 16 and 4096 pixels (got "${opts.gifW || opts.gW}").`);
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  // 6. Remux / Merge checks
  if (effectiveMode === 'remux') {
    const fmt = (opts.fmt || '').trim().toLowerCase();
    if (!fmt) {
      errors.push('Output format is required for remux mode.');
    } else if (fmt === 'gif') {
      errors.push('Cannot remux directly into GIF. Use GIF mode instead.');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  if (effectiveMode === 'merge') {
    return { valid: errors.length === 0, errors, warnings };
  }

  // 7. Container & codec checks for convert & audio modes
  const fmt = (opts.fmt || '').trim().toLowerCase();
  if (!fmt) {
    errors.push('Output format is required.');
    return { valid: false, errors, warnings };
  }

  const rule = CONTAINER_RULES[fmt];
  const normalizedAc = normalizeAudioCodec(opts.ac);

  // Audio-only mode
  if (effectiveMode === 'audio') {
    if (rule && !rule.isAudioOnly && rule.audio.length === 0) {
      errors.push(`Format "${fmt}" does not support audio output.`);
    }
    if (!caps.audioCodecs.includes(normalizedAc as AudioCodec)) {
      const reason = caps.disabledReasons.audioCodecs[normalizedAc];
      errors.push(reason ?? `Audio codec "${normalizedAc}" is not supported on platform "${platform}".`);
    } else if (rule && !rule.audio.includes(normalizedAc as AudioCodec)) {
      errors.push(`Audio codec "${normalizedAc}" is not compatible with container "${fmt}". Allowed: ${rule.audio.join(', ')}.`);
    }

    validateAudioParams(opts, normalizedAc, errors, warnings);
    return { valid: errors.length === 0, errors, warnings };
  }

  // Convert mode
  if (rule?.isAudioOnly) {
    errors.push(`Container "${fmt}" is audio-only. Use audio mode instead of convert mode.`);
  }

  const vc = (opts.vc || 'libx264').trim().toLowerCase();
  if (!caps.videoCodecs.includes(vc as VideoCodec)) {
    const reason = caps.disabledReasons.videoCodecs[vc];
    errors.push(reason ?? `Video codec "${vc}" is not supported on platform "${platform}".`);
  } else if (rule && rule.video.length > 0 && !rule.video.includes(vc as VideoCodec)) {
    errors.push(`Video codec "${vc}" is not compatible with container "${fmt}". Allowed: ${rule.video.join(', ')}.`);
  }

  // Check if video filters are set while vc === 'copy'
  const hasVideoFilters = Boolean(
    (opts.res && opts.res !== 'original') ||
      opts.rotate ||
      (opts.speed !== undefined && opts.speed !== 1.0) ||
      (opts.cropW && opts.cropH) ||
      opts.deint ||
      opts.gray ||
      opts.den ||
      opts.sharp ||
      (opts.hasSub && opts.subMode === 'burn' && opts.subPath) ||
      (opts.hasWm && opts.wmPath),
  );
  if (vc === 'copy' && hasVideoFilters) {
    warnings.push('Video filters, watermarks, and subtitle burn-in are ignored when Video Codec is set to Copy.');
  }

  if (opts.tune && opts.tune !== 'none' && (!['libx264', 'libx265'].includes(vc) || hw !== 'none')) {
    warnings.push(`Option -tune "${opts.tune}" is only supported for CPU libx264/libx265 and will be skipped.`);
  }

  if (opts.tsz && !opts.durationSec) {
    warnings.push('Target file size requires media duration to compute bitrate and will be skipped.');
  }

  // Audio in convert mode
  if (!opts.noAudio) {
    if (!caps.audioCodecs.includes(normalizedAc as AudioCodec)) {
      const reason = caps.disabledReasons.audioCodecs[normalizedAc];
      errors.push(reason ?? `Audio codec "${normalizedAc}" is not supported on platform "${platform}".`);
    } else if (rule && rule.audio.length > 0 && !rule.audio.includes(normalizedAc as AudioCodec)) {
      errors.push(`Audio codec "${normalizedAc}" is not compatible with container "${fmt}". Allowed: ${rule.audio.join(', ')}.`);
    }

    validateAudioParams(opts, normalizedAc, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateAudioParams(
  opts: CommandOptions,
  normalizedAc: string,
  errors: string[],
  warnings: string[],
): void {
  if (normalizedAc === 'copy') {
    const hasAudioTransforms = Boolean(
      opts.sr ||
        opts.ch ||
        (opts.vol !== undefined && opts.vol !== 1.0) ||
        opts.norm ||
        (opts.speed !== undefined && opts.speed !== 1.0),
    );
    if (hasAudioTransforms) {
      warnings.push('Audio sample rate, channel layout, and audio filters are ignored when Audio Codec is set to Copy.');
    }
    return;
  }

  const constraints = AUDIO_CODEC_CONSTRAINTS[normalizedAc as AudioCodec];
  if (!constraints) return;

  if (opts.sr) {
    const srNum = Number(opts.sr);
    if (!Number.isFinite(srNum) || srNum <= 0) {
      errors.push(`Invalid audio sample rate "${opts.sr}".`);
    } else if (constraints.allowedSampleRates && !constraints.allowedSampleRates.includes(srNum)) {
      errors.push(
        `Sample rate ${srNum} Hz is not supported by "${normalizedAc}". Allowed: ${constraints.allowedSampleRates.join(', ')} Hz.`,
      );
    } else if (constraints.maxSampleRate && srNum > constraints.maxSampleRate) {
      errors.push(`Sample rate ${srNum} Hz exceeds maximum ${constraints.maxSampleRate} Hz for "${normalizedAc}".`);
    }
  }

  if (opts.ch) {
    const chNum = Number(opts.ch);
    if (!Number.isFinite(chNum) || chNum <= 0) {
      errors.push(`Invalid audio channel count "${opts.ch}".`);
    } else if (constraints.maxChannels && chNum > constraints.maxChannels) {
      errors.push(`Channel count ${chNum} exceeds maximum ${constraints.maxChannels} for "${normalizedAc}".`);
    }
  }
}
