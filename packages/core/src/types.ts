export type ProcessingMode = 'convert' | 'audio' | 'remux' | 'merge' | 'thumbnail' | 'gif';

export type RuntimePlatform = 'wasm' | 'desktop' | 'local-server';

export type HwAccel = 'none' | 'cuda' | 'qsv';

export type VideoCodec = 'libx264' | 'libx265' | 'libvpx-vp9' | 'prores_ks' | 'copy';

export type AudioCodec = 'aac' | 'libmp3lame' | 'libopus' | 'flac' | 'pcm_s16le' | 'copy';

export type ThumbnailFormat = 'jpg' | 'png' | 'webp';

export interface CommandOptions {
  mode: ProcessingMode;
  input?: string; // the input filename or path
  output?: string; // optional explicit output filename or path
  durationSec?: number; // optional probed duration in seconds for smart defaults

  // Format & Codec
  fmt: string;
  vc: string; // Video codec
  ac: string; // Audio codec
  hwaccel?: HwAccel;

  // Video Options
  crf?: string;
  vbr?: string;
  tsz?: string; // target size in MB
  preset?: string;
  tune?: string;
  fps?: string;
  pixFmt?: string;
  aspect?: string;
  threads?: string;

  // Filter Options (Video)
  res?: string;
  rotate?: string;
  speed?: number;
  cropW?: string;
  cropH?: string;
  cropX?: string;
  cropY?: string;
  deint?: boolean;
  gray?: boolean;
  den?: boolean;
  sharp?: boolean;

  // Watermark
  hasWm?: boolean;
  wmPath?: string;
  wmPos?: 'tl' | 'tr' | 'bl' | 'br' | 'center';
  wmOpa?: number;

  // Subtitles
  hasSub?: boolean;
  subMode?: 'burn' | 'stream';
  subPath?: string;

  // Audio Options
  ab?: string; // Audio bitrate
  sr?: string; // Sample rate
  ch?: string; // Channels
  vol?: number;
  norm?: boolean;
  noAudio?: boolean;

  // Trim
  ts_start?: string;
  ts_end?: string;

  // Extra
  webOpt?: boolean;
  noMeta?: boolean;
  custom?: string;

  // GIF Specific
  gifFps?: string;
  gifW?: string;
  gFps?: string;
  gW?: string;
  gLoop?: string;

  // Thumbnail Specific
  thTime?: string;
  thFmt?: string;
  thQ?: string;
}

export interface PlatformCapabilities {
  platform: RuntimePlatform;
  displayName: string;
  modes: readonly ProcessingMode[];
  videoCodecs: readonly VideoCodec[];
  audioCodecs: readonly AudioCodec[];
  hwaccels: readonly HwAccel[];
  videoContainers: readonly string[];
  audioContainers: readonly string[];
  disabledReasons: {
    modes: Partial<Record<ProcessingMode, string>>;
    videoCodecs: Partial<Record<string, string>>;
    audioCodecs: Partial<Record<string, string>>;
    hwaccels: Partial<Record<HwAccel, string>>;
    containers: Partial<Record<string, string>>;
  };
}

export interface CompatibleCodecs {
  video: VideoCodec[];
  audio: AudioCodec[];
  defaultVideo?: VideoCodec;
  defaultAudio?: AudioCodec;
  isAudioOnly: boolean;
  isGif: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FFmpegPlan {
  args: string[];
  outputName: string;
  outputExt: string;
  warnings: string[];
  errors: string[];
}
