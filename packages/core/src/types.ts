export type ProcessingMode = 'convert' | 'audio' | 'remux' | 'merge' | 'thumbnail' | 'gif';

export interface CommandOptions {
  mode: ProcessingMode;
  input?: string; // the input filename or path
  
  // Format & Codec
  fmt: string;
  vc: string; // Video codec
  ac: string; // Audio codec
  hwaccel?: 'none' | 'cuda' | 'qsv';
  
  // Video Options
  crf?: string;
  vbr?: string;
  tsz?: string; // target size
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
  gFps?: string;
  gW?: string;
  gLoop?: string;
  
  // Thumbnail Specific
  thTime?: string;
  thFmt?: string;
  thQ?: string;
}
