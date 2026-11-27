import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, ReactNode, SetStateAction } from 'react';
import { TerminalOutput } from './TerminalOutput';
import { SettingsModal } from './SettingsModal';
import { AboutModal } from './AboutModal';
import { getPlatformCapabilities, reconcileOptionsForFormat } from '@ffmpeg-ui/core';
import type { AudioCodec, CommandOptions, RuntimePlatform, VideoCodec } from '@ffmpeg-ui/core';
import {
  Film,
  Music,
  Sun,
  Moon,
  Upload,
  List,
  Plus,
  Archive,
  X,
  BarChart,
  AlertCircle,
  Play,
  CheckCircle,
  StopCircle,
  Layers,
  Settings2,
  HelpCircle,
} from 'lucide-react';

export interface MediaInfo {
  format_name?: string;
  duration?: number;
  size_mb?: number | string;
  bitrate_kbps?: number | string;
  video_codec?: string;
  audio_codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  sample_rate?: number | string;
  channels?: number;
}

export interface MediaItem {
  id: string;
  name: string;
  path?: string;
  previewUrl?: string;
  file?: File;
  probe?: MediaInfo | null;
}

export interface BatchExecutionItem {
  item: MediaItem;
  options: CommandOptions;
}

export interface ProgressInfo {
  percent: number;
  fps?: number;
  frame?: number;
  speed?: string | number;
  sizeMb?: number;
  etaSec?: number;
  timeSec?: number;
}

export interface BatchStatus {
  current: number;
  total: number;
  currentName?: string;
}

export interface MediaEditorProps {
  capabilities: { has_ffmpeg: boolean; version: string } | null;
  onAddFiles: () => void;
  onDropFiles: (files: File[]) => void;
  onExecute: (jobs: BatchExecutionItem[], isBatch: boolean) => void | Promise<void>;
  onCancel: () => void;
  isProcessing: boolean;
  isDone: boolean;
  terminalLogs: string[];
  progress: ProgressInfo | null;
  queue: MediaItem[];
  setQueue: Dispatch<SetStateAction<MediaItem[]>>;
  activeFileId: string | null;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  mediaInfo: MediaInfo | null;
  options: CommandOptions;
  setOptions: Dispatch<SetStateAction<CommandOptions>>;
  /** Set false on desktop (Tauri) where a native title bar already exists */
  showInternalHeader?: boolean;
  /** Runtime platform used for capability gating */
  platform?: RuntimePlatform;
  /** Optional display label shown in About modal */
  platformLabel?: string;
  /** Dismissible error message shown prominently above the workspace */
  errorMessage?: string | null;
  onDismissError?: () => void;
  /** External URL opener (e.g. Tauri opener plugin) for About modal links */
  onOpenExternalUrl?: (url: string) => void;
  /** Batch progress status during multi-file conversions */
  batchStatus?: BatchStatus | null;
  /** Optional controlled theme */
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

// ── File type detection ───────────────────────────────────────────
const RE_VIDEO = /\.(mp4|mkv|mov|avi|webm|flv|wmv|m4v|ts|3gp|ogv|gif|mpg|mpeg)$/i;
const RE_AUDIO = /\.(mp3|wav|ogg|flac|m4a|aac|opus|wma|aiff|ac3)$/i;

function detectType(name: string): 'video' | 'audio' | 'unknown' {
  if (RE_VIDEO.test(name)) return 'video';
  if (RE_AUDIO.test(name)) return 'audio';
  return 'unknown';
}

function formatChannels(channels: number): string {
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels}ch`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (mins > 0) return `${mins}:${String(secs).padStart(2, '0')}`;
  return `${secs}s`;
}

function formatSpeed(speed: string | number): string {
  if (typeof speed === 'string') return speed.endsWith('x') ? speed : `${speed}x`;
  return `${speed.toFixed(2)}x`;
}

// ── Format lists ─────────────────────────────────────────────────
const VIDEO_FMTS = [
  { label: 'MP4', value: 'mp4' },
  { label: 'MKV', value: 'mkv' },
  { label: 'WebM', value: 'webm' },
  { label: 'AVI', value: 'avi' },
  { label: 'MOV', value: 'mov' },
  { label: 'GIF', value: 'gif' },
];
const AUDIO_FMTS = [
  { label: 'MP3', value: 'mp3' },
  { label: 'M4A', value: 'm4a' },
  { label: 'OGG', value: 'ogg' },
  { label: 'WAV', value: 'wav' },
  { label: 'FLAC', value: 'flac' },
];

// ── Unified type-labelled presets ────────────────────────────────
type PresetDef = {
  label: string;
  type: 'video' | 'audio';
  icon: ReactNode;
  opts: Partial<CommandOptions>;
};

const ALL_PRESETS: PresetDef[] = [
  {
    label: 'TikTok / IG',
    type: 'video',
    icon: <Film size={11} />,
    opts: { mode: 'convert', fmt: 'mp4', vc: 'libx264', ac: 'aac', crf: '23' },
  },
  {
    label: 'YouTube',
    type: 'video',
    icon: <Film size={11} />,
    opts: { mode: 'convert', fmt: 'mp4', vc: 'libx264', ac: 'aac', crf: '20' },
  },
  {
    label: 'Discord <8MB',
    type: 'video',
    icon: <Film size={11} />,
    opts: { mode: 'convert', fmt: 'mp4', vc: 'libx264', ac: 'aac', crf: '32' },
  },
  {
    label: 'Archival MKV',
    type: 'video',
    icon: <Archive size={11} />,
    opts: { mode: 'convert', fmt: 'mkv', vc: 'libx265', ac: 'aac', crf: '24' },
  },
  {
    label: 'HQ MP3',
    type: 'audio',
    icon: <Music size={11} />,
    opts: { mode: 'audio', fmt: 'mp3', ac: 'libmp3lame', ab: '320k' },
  },
  {
    label: 'Apple AAC',
    type: 'audio',
    icon: <Music size={11} />,
    opts: { mode: 'audio', fmt: 'm4a', ac: 'aac', ab: '256k' },
  },
  {
    label: 'Voice (Opus)',
    type: 'audio',
    icon: <Music size={11} />,
    opts: { mode: 'audio', fmt: 'ogg', ac: 'libopus', ab: '64k' },
  },
  {
    label: 'Lossless WAV',
    type: 'audio',
    icon: <Music size={11} />,
    opts: { mode: 'audio', fmt: 'wav', ac: 'pcm_s16le' },
  },
];

const VIDEO_PRESETS = ALL_PRESETS.filter(p => p.type === 'video');
const AUDIO_PRESETS = ALL_PRESETS.filter(p => p.type === 'audio');

const THEME_STORAGE_KEY = 'ffmpeg-ui-theme';

export function MediaEditor(props: MediaEditorProps) {
  const {
    capabilities,
    onAddFiles,
    onDropFiles,
    onExecute,
    onCancel,
    isProcessing,
    isDone,
    terminalLogs,
    progress,
    queue,
    setQueue,
    activeFileId,
    setActiveFileId,
    mediaInfo,
    options,
    setOptions,
    showInternalHeader = true,
    platform = 'desktop',
    platformLabel,
    errorMessage = null,
    onDismissError,
    onOpenExternalUrl,
    batchStatus = null,
    theme: controlledTheme,
    onToggleTheme,
  } = props;

  const platformCaps = getPlatformCapabilities(platform);
  const resolvedPlatformLabel = platformLabel ?? platformCaps.displayName;

  const [itemOptionsMap, setItemOptionsMap] = useState<Map<string, CommandOptions>>(() => new Map());
  const [modalItemId, setModalItemId] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<'info' | 'preview'>('info');
  const [showLogs, setShowLogs] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [globalFmt, setGlobalFmt] = useState('');
  const [activePresetLabel, setActivePresetLabel] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [internalTheme, setInternalTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'dark' || saved === 'light') return saved;
      } catch {
        // ignore storage errors
      }
    }
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }
    return 'dark';
  });

  const activeTheme = controlledTheme ?? internalTheme;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', activeTheme);
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
      } catch {
        // ignore storage errors
      }
    }
  }, [activeTheme]);

  const handleToggleTheme = () => {
    if (onToggleTheme) {
      onToggleTheme();
    } else {
      setInternalTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    }
  };

  // Auto-dismissing completion toast without synchronous setState in effect
  useEffect(() => {
    if (!isDone) return;
    const showTimer = window.setTimeout(() => setToastVisible(true), 0);
    const hideTimer = window.setTimeout(() => setToastVisible(false), 3000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [isDone]);

  // Revoke any blob: preview URLs still in queue on unmount
  const queueRef = useRef<MediaItem[]>(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    return () => {
      queueRef.current.forEach(item => {
        if (item.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  // ── Per-item helpers (auto-reconciled by detected file type & platform) ──
  const getDefaultOptsForItem = useCallback(
    (item: MediaItem): CommandOptions => {
      const t = detectType(item.name);
      if (t === 'audio') {
        return reconcileOptionsForFormat(
          { ...options, mode: 'audio', fmt: 'mp3', ac: 'libmp3lame', ab: '320k' },
          'mp3',
          platform,
        );
      }
      return reconcileOptionsForFormat({ ...options }, options.fmt || 'mp4', platform);
    },
    [options, platform],
  );

  const getItemOpts = useCallback(
    (item: MediaItem): CommandOptions => {
      const existing = itemOptionsMap.get(item.id);
      if (existing) return existing;
      return getDefaultOptsForItem(item);
    },
    [itemOptionsMap, getDefaultOptsForItem],
  );

  const setItemOpts = useCallback((id: string, opts: CommandOptions) => {
    setItemOptionsMap(prev => new Map(prev).set(id, opts));
  }, []);

  // ── Preset availability check ─────────────────────────────────
  const getPresetDisabledReason = (preset: PresetDef): string | null => {
    if (preset.opts.mode && !platformCaps.modes.includes(preset.opts.mode)) {
      return platformCaps.disabledReasons.modes[preset.opts.mode] ?? 'Unavailable on this platform';
    }
    if (preset.opts.vc && !platformCaps.videoCodecs.includes(preset.opts.vc as VideoCodec)) {
      return platformCaps.disabledReasons.videoCodecs[preset.opts.vc] ?? 'Unavailable on this platform';
    }
    if (preset.opts.ac && !platformCaps.audioCodecs.includes(preset.opts.ac as AudioCodec)) {
      return platformCaps.disabledReasons.audioCodecs[preset.opts.ac] ?? 'Unavailable on this platform';
    }
    if (
      preset.type === 'video' &&
      preset.opts.fmt &&
      !platformCaps.videoContainers.includes(preset.opts.fmt)
    ) {
      return platformCaps.disabledReasons.containers[preset.opts.fmt] ?? 'Unavailable on this platform';
    }
    if (
      preset.type === 'audio' &&
      preset.opts.fmt &&
      !platformCaps.audioContainers.includes(preset.opts.fmt)
    ) {
      return platformCaps.disabledReasons.containers[preset.opts.fmt] ?? 'Unavailable on this platform';
    }
    return null;
  };

  // ── Smart type-aware preset application ───────────────────────
  const applyPreset = (preset: PresetDef) => {
    if (getPresetDisabledReason(preset)) return;
    setActivePresetLabel(preset.label);
    setItemOptionsMap(prev => {
      const next = new Map(prev);
      queue.forEach(item => {
        const t = detectType(item.name);
        if (t === 'unknown' || t === preset.type) {
          const base = prev.get(item.id) ?? getDefaultOptsForItem(item);
          const merged: CommandOptions = { ...base, ...preset.opts };
          next.set(item.id, reconcileOptionsForFormat(merged, merged.fmt, platform));
        }
      });
      return next;
    });
    if (preset.type === 'video' || queue.length === 0) {
      setOptions(prev =>
        reconcileOptionsForFormat({ ...prev, ...preset.opts }, preset.opts.fmt || prev.fmt, platform),
      );
    }
  };

  // ── Smart global format selector ──────────────────────────────
  const applyGlobalFormat = (fmt: string) => {
    if (!fmt) return;
    setGlobalFmt(fmt);
    const fmtType = VIDEO_FMTS.some(f => f.value === fmt) ? 'video' : 'audio';
    setItemOptionsMap(prev => {
      const next = new Map(prev);
      queue.forEach(item => {
        const t = detectType(item.name);
        if (t === 'unknown' || t === fmtType) {
          const base = prev.get(item.id) ?? getDefaultOptsForItem(item);
          next.set(item.id, reconcileOptionsForFormat(base, fmt, platform));
        }
      });
      return next;
    });
  };

  // ── Remove item cleanly (revokes blob URL + updates active selection) ──
  const handleRemoveItem = (item: MediaItem, idx: number) => {
    if (item.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(item.previewUrl);
    }
    const remaining = queue.filter(i => i.id !== item.id);
    setQueue(remaining);
    setItemOptionsMap(prev => {
      const next = new Map(prev);
      next.delete(item.id);
      return next;
    });
    if (activeFileId === item.id) {
      const nextItem = remaining[Math.min(idx, remaining.length - 1)] ?? null;
      setActiveFileId(nextItem ? nextItem.id : null);
    }
  };

  // ── Execute handlers (passing per-item reconciled options) ────
  const activeItem = queue.find(q => q.id === activeFileId) || null;

  const buildJob = (item: MediaItem): BatchExecutionItem => {
    const raw = getItemOpts(item);
    const reconciled =
      raw.mode === 'thumbnail' || raw.mode === 'remux' || raw.mode === 'merge'
        ? raw
        : reconcileOptionsForFormat(raw, raw.fmt, platform);
    return { item, options: reconciled };
  };

  const handleExecuteSelected = () => {
    if (!activeItem) return;
    void onExecute([buildJob(activeItem)], false);
  };

  const handleExecuteAll = () => {
    if (queue.length === 0) return;
    void onExecute(queue.map(buildJob), true);
  };

  // ── Queue type mix detection ──────────────────────────────────
  const hasVideo = queue.some(i => detectType(i.name) === 'video');
  const hasAudio = queue.some(i => detectType(i.name) === 'audio');
  const isMixed = hasVideo && hasAudio;
  const isEmpty = queue.length === 0;

  // ── Modal state ───────────────────────────────────────────────
  const modalItem = modalItemId ? queue.find(q => q.id === modalItemId) ?? null : null;
  const modalOpts = modalItem ? getItemOpts(modalItem) : options;

  // ── Inline format options per item ────────────────────────────
  const getInlineFmts = (name: string) => {
    const t = detectType(name);
    if (t === 'audio') return AUDIO_FMTS;
    if (t === 'video') return VIDEO_FMTS;
    return [...VIDEO_FMTS, ...AUDIO_FMTS];
  };

  const handleDropzoneKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onAddFiles();
    }
  };

  const handleQueueItemKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveFileId(id);
    }
  };

  const progressPct = Math.min(100, Math.max(0, Math.round(progress?.percent ?? 0)));

  return (
    <div className="app-layout app-layout-full">
      {/* ── Header (suppressed on desktop) ── */}
      {showInternalHeader && (
        <header
          className="app-header"
          style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}
        >
          <div className="app-brand">FFmpeg Web UI</div>
          <div className="header-right">
            {capabilities && (
              <span className="cap-badge" style={{ fontSize: '0.65rem' }}>
                {capabilities.has_ffmpeg ? '🟢' : '🔴'} {capabilities.version.split('-')[0].trim()}
              </span>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              title="About FFmpeg UI"
              aria-label="About FFmpeg UI"
              style={{ padding: '6px' }}
              onClick={() => setAboutOpen(true)}
            >
              <HelpCircle size={16} />
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              title="Toggle theme"
              aria-label={`Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} theme`}
              style={{ padding: '6px' }}
              onClick={handleToggleTheme}
            >
              {activeTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
      )}

      {/* ── Main content ── */}
      <div className="main-scrollable">
        {/* Unified Error Banner */}
        {errorMessage && (
          <div className="ffmpeg-error-banner visible" role="alert" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="feb-title">
                  <AlertCircle size={14} aria-hidden="true" />
                  <span>Processing Error</span>
                </div>
                <div style={{ color: 'var(--text-1)', wordBreak: 'break-word' }}>{errorMessage}</div>
              </div>
              {onDismissError && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onDismissError}
                  title="Dismiss error"
                  aria-label="Dismiss error"
                  style={{ padding: 4, flexShrink: 0 }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Drop + Info */}
        <div className="main-top">
          <div className="card" style={{ flex: 1 }}>
            <div
              className={`drop-zone ${isDragOver ? 'dz-over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Drop media files here or press Enter to browse"
              onClick={onAddFiles}
              onKeyDown={handleDropzoneKeyDown}
              onDragOver={e => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={e => {
                e.preventDefault();
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setIsDragOver(false);
                }
              }}
              onDrop={e => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.length) onDropFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={36} className="dz-icon" aria-hidden="true" />
              <p className="dz-title">Drop files here or click to browse</p>
              <p className="dz-sub">Any video or audio — multiple files supported</p>
            </div>
          </div>

          {/* Media Info */}
          <div className="card meta-card">
            <div className="card-header">
              <span className="card-title">
                <BarChart size={12} style={{ marginRight: 6 }} aria-hidden="true" /> Media Info
              </span>
              <div style={{ display: 'flex', gap: 2 }} role="tablist" aria-label="Media inspector tabs">
                {(['info', 'preview'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={infoTab === tab}
                    className={`info-tab-btn ${infoTab === tab ? 'active' : ''}`}
                    onClick={() => setInfoTab(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ minHeight: 130, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {infoTab === 'preview' ? (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    background: '#000',
                    borderRadius: '0 0 8px 8px',
                    overflow: 'hidden',
                    minHeight: 130,
                  }}
                >
                  {!activeItem ? (
                    <span style={{ color: '#999', fontSize: '.75rem' }}>Select a file to preview</span>
                  ) : activeItem.previewUrl ? (
                    RE_AUDIO.test(activeItem.name) ? (
                      <audio controls src={activeItem.previewUrl} style={{ width: '85%' }} />
                    ) : (
                      <video
                        controls
                        src={activeItem.previewUrl}
                        style={{ maxWidth: '100%', maxHeight: '180px' }}
                      />
                    )
                  ) : (
                    <span style={{ color: '#999', fontSize: '.75rem' }}>No preview available</span>
                  )}
                </div>
              ) : !mediaInfo ? (
                <div className="media-info-empty" style={{ flex: 1 }}>
                  <Film size={32} className="mi-icon" aria-hidden="true" />
                  <p>
                    {activeItem
                      ? 'Metadata unavailable — use Preview tab to play'
                      : 'Drop a file to inspect'}
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    padding: 12,
                    fontSize: '.75rem',
                    flex: 1,
                    overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '4px 12px',
                    alignContent: 'start',
                  }}
                >
                  {mediaInfo.format_name && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <strong>Format:</strong> {mediaInfo.format_name.split(',')[0]}
                    </div>
                  )}
                  {mediaInfo.duration != null && Number.isFinite(Number(mediaInfo.duration)) && (
                    <div>
                      <strong>Duration:</strong> {formatDuration(Number(mediaInfo.duration))}
                    </div>
                  )}
                  {mediaInfo.size_mb != null && mediaInfo.size_mb !== '' && (
                    <div>
                      <strong>Size:</strong> {mediaInfo.size_mb} MB
                    </div>
                  )}
                  {mediaInfo.bitrate_kbps != null && mediaInfo.bitrate_kbps !== '' && Number(mediaInfo.bitrate_kbps) > 0 && (
                    <div>
                      <strong>Bitrate:</strong> {mediaInfo.bitrate_kbps} kbps
                    </div>
                  )}
                  {mediaInfo.video_codec && (
                    <>
                      <div>
                        <strong>Video:</strong> {mediaInfo.video_codec.toUpperCase()}
                      </div>
                      {mediaInfo.width != null && mediaInfo.height != null && mediaInfo.width > 0 && (
                        <div>
                          <strong>Res:</strong> {mediaInfo.width}×{mediaInfo.height}
                        </div>
                      )}
                    </>
                  )}
                  {mediaInfo.audio_codec && (
                    <>
                      <div>
                        <strong>Audio:</strong> {mediaInfo.audio_codec.toUpperCase()}
                      </div>
                      {mediaInfo.channels != null && mediaInfo.channels > 0 && (
                        <div>
                          <strong>Ch:</strong> {formatChannels(mediaInfo.channels)}
                        </div>
                      )}
                    </>
                  )}
                  {mediaInfo.audio_codec && !mediaInfo.video_codec && activeItem && (
                    <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const audioOpts = reconcileOptionsForFormat(
                            { ...getItemOpts(activeItem), mode: 'audio', fmt: 'mp3', ac: 'libmp3lame', ab: '320k' },
                            'mp3',
                            platform,
                          );
                          setItemOpts(activeItem.id, audioOpts);
                          setOptions(audioOpts);
                        }}
                      >
                        <AlertCircle size={11} style={{ marginRight: 4 }} /> Switch to Audio Mode
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Preset Pills (type-aware, platform-gated) ── */}
        <div className="presets-bar">
          {(isEmpty || hasVideo) && (
            <>
              {isMixed && (
                <span className="presets-label" style={{ fontSize: '.60rem' }}>
                  VIDEO
                </span>
              )}
              {!isMixed && !hasAudio && <span className="presets-label">Quick Presets</span>}
              <div className="presets-group">
                {VIDEO_PRESETS.map(p => {
                  const disabledReason = getPresetDisabledReason(p);
                  return (
                    <button
                      key={p.label}
                      type="button"
                      disabled={Boolean(disabledReason)}
                      className={`preset-btn ${activePresetLabel === p.label ? 'active' : ''}`}
                      onClick={() => applyPreset(p)}
                      title={disabledReason ?? 'Apply to video files only'}
                    >
                      {p.icon} {p.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {isMixed && <div style={{ width: '100%', height: 1, background: 'var(--border)' }} />}
          {(isEmpty || hasAudio) && (
            <>
              {isMixed && (
                <span className="presets-label" style={{ fontSize: '.60rem' }}>
                  AUDIO
                </span>
              )}
              {!isMixed && hasAudio && <span className="presets-label">Audio Presets</span>}
              <div className="presets-group">
                {AUDIO_PRESETS.map(p => {
                  const disabledReason = getPresetDisabledReason(p);
                  return (
                    <button
                      key={p.label}
                      type="button"
                      disabled={Boolean(disabledReason)}
                      className={`preset-btn ${activePresetLabel === p.label ? 'active' : ''}`}
                      onClick={() => applyPreset(p)}
                      title={disabledReason ?? 'Apply to audio files only'}
                    >
                      {p.icon} {p.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Batch Queue ── */}
        <div className="card batch-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title">
              <List size={12} style={{ marginRight: 6 }} aria-hidden="true" /> Batch Queue
              <span style={{ marginLeft: 8, opacity: 0.5, fontWeight: 400 }}>
                {queue.length} file{queue.length !== 1 ? 's' : ''}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Global "All→ format" */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    fontSize: '.62rem',
                    color: 'var(--text-2)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '.05em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  All→
                </span>
                <select
                  aria-label="Apply output format to matching queue items"
                  value={globalFmt}
                  onChange={e => applyGlobalFormat(e.target.value)}
                  style={{ padding: '3px 22px 3px 7px', fontSize: '.72rem', borderRadius: 5, minWidth: 70 }}
                  title="Apply format to matching files"
                >
                  <option value="">Format</option>
                  {(isEmpty || hasVideo) && (
                    <optgroup label="Video">
                      {VIDEO_FMTS.map(f => {
                        const disabled = !platformCaps.videoContainers.includes(f.value);
                        return (
                          <option key={f.value} value={f.value} disabled={disabled}>
                            {f.label}
                            {disabled ? ' (Desktop / Local Server)' : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  {(isEmpty || hasAudio) && (
                    <optgroup label="Audio">
                      {AUDIO_FMTS.map(f => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onAddFiles}>
                <Plus size={12} style={{ marginRight: 4 }} /> Add
              </button>
              {!showInternalHeader && !onToggleTheme && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Toggle theme"
                  aria-label={`Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} theme`}
                  style={{ padding: '4px 6px' }}
                  onClick={handleToggleTheme}
                >
                  {activeTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </button>
              )}
            </div>
          </div>

          <div className="queue-list">
            {queue.length === 0 ? (
              <div className="queue-empty">Drop files above to add them to the queue</div>
            ) : (
              queue.map((item, idx) => {
                const iOpts = getItemOpts(item);
                const isActive = activeFileId === item.id;
                const fmtList = getInlineFmts(item.name);
                const fileType = detectType(item.name);
                const subExt =
                  iOpts.mode === 'thumbnail'
                    ? (iOpts.thFmt || 'jpg').toUpperCase()
                    : iOpts.mode === 'gif'
                      ? 'GIF'
                      : (iOpts.fmt || 'auto').toUpperCase();
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isActive}
                    className={`queue-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveFileId(item.id)}
                    onKeyDown={e => handleQueueItemKeyDown(e, item.id)}
                  >
                    <div className="qi-status" aria-hidden="true">
                      {fileType === 'audio' ? <Music size={13} /> : <Film size={13} />}
                    </div>
                    <div className="qi-info">
                      <div className="qi-name">{item.name}</div>
                      <div className="qi-sub">
                        {subExt} · {iOpts.mode ?? 'convert'}
                      </div>
                    </div>
                    <div className="qi-inline-fmt" onClick={e => e.stopPropagation()}>
                      <select
                        aria-label={`Output format for ${item.name}`}
                        value={iOpts.fmt || fmtList[0]?.value}
                        onChange={e =>
                          setItemOpts(item.id, reconcileOptionsForFormat(iOpts, e.target.value, platform))
                        }
                        className="qi-fmt-select"
                        title="Output format"
                      >
                        {fmtList.map(f => {
                          const isVideoFmt = VIDEO_FMTS.some(vf => vf.value === f.value);
                          const disabled = isVideoFmt && !platformCaps.videoContainers.includes(f.value);
                          return (
                            <option key={f.value} value={f.value} disabled={disabled}>
                              {f.label}
                              {disabled ? ' (Desktop)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div className="qi-actions" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        title={`Settings for ${item.name}`}
                        aria-label={`Configure settings for ${item.name}`}
                        onClick={() => setModalItemId(item.id)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: 4,
                          borderRadius: 4,
                          color: 'var(--text-2)',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Settings2 size={13} />
                      </button>
                      <button
                        type="button"
                        title={`Remove ${item.name}`}
                        aria-label={`Remove ${item.name} from queue`}
                        onClick={() => handleRemoveItem(item, idx)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: 4,
                          borderRadius: 4,
                          color: 'var(--text-3)',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Logs toggle */}
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: '.72rem', padding: '3px 10px', opacity: 0.7, alignSelf: 'flex-start' }}
          onClick={() => setShowLogs(v => !v)}
        >
          <BarChart size={12} style={{ marginRight: 4 }} aria-hidden="true" />
          {showLogs ? 'Hide Logs' : 'Show Logs'}
        </button>

        {showLogs && (
          <div className="terminal-dock" style={{ borderTop: 'none', background: 'transparent' }}>
            <TerminalOutput logs={terminalLogs} title="FFmpeg Log Console" />
          </div>
        )}

        <div style={{ height: 24, flexShrink: 0 }} />
      </div>

      {/* ── Live Progress Bar (always visible during processing) ── */}
      {isProcessing && (
        <div className="progress-dock" role="region" aria-label="Conversion progress">
          <div className="progress-header">
            <span className="progress-label">
              {batchStatus
                ? `Processing ${batchStatus.current} / ${batchStatus.total}${
                    batchStatus.currentName ? ` · ${batchStatus.currentName}` : ''
                  }`
                : 'Processing…'}
            </span>
            <span className="progress-pct-lbl">{progressPct}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          {progress && (
            <div className="progress-stats">
              {progress.fps != null && progress.fps > 0 && (
                <div className="progress-stat">
                  <span>FPS</span>
                  <span className="ps-val">{Math.round(progress.fps)}</span>
                </div>
              )}
              {progress.speed != null && progress.speed !== '' && (
                <div className="progress-stat">
                  <span>Speed</span>
                  <span className="ps-val">{formatSpeed(progress.speed)}</span>
                </div>
              )}
              {progress.timeSec != null && progress.timeSec > 0 && (
                <div className="progress-stat">
                  <span>Time</span>
                  <span className="ps-val">{formatDuration(progress.timeSec)}</span>
                </div>
              )}
              {progress.sizeMb != null && progress.sizeMb > 0 && (
                <div className="progress-stat">
                  <span>Size</span>
                  <span className="ps-val">{progress.sizeMb.toFixed(2)} MB</span>
                </div>
              )}
              {progress.etaSec != null && progress.etaSec > 0 && (
                <div className="progress-stat">
                  <span>ETA</span>
                  <span className="ps-val">{formatDuration(progress.etaSec)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Anchored CTA Bar ── */}
      <div className="cta-bar">
        {isProcessing ? (
          <button type="button" className="btn btn-secondary" style={{ padding: '9px 18px' }} onClick={onCancel}>
            <StopCircle size={15} style={{ marginRight: 6 }} /> Stop Task
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '9px 18px' }}
              onClick={handleExecuteSelected}
              disabled={isProcessing || !activeItem}
            >
              <Play size={14} style={{ marginRight: 6 }} /> Convert Selected
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '9px 22px' }}
              onClick={handleExecuteAll}
              disabled={isProcessing || queue.length === 0}
            >
              <Layers size={14} style={{ marginRight: 6 }} /> Convert All ({queue.length})
            </button>
          </>
        )}
      </div>

      {/* Settings Modal */}
      {modalItem && (
        <SettingsModal
          fileName={modalItem.name}
          options={modalOpts}
          platform={platform}
          onChange={opts => {
            setItemOpts(modalItem.id, opts);
            setOptions(opts);
          }}
          onClose={() => setModalItemId(null)}
        />
      )}

      {/* About Modal */}
      {aboutOpen && (
        <AboutModal
          platform={resolvedPlatformLabel}
          ffmpegVersion={capabilities?.version ?? null}
          onOpenExternalUrl={onOpenExternalUrl}
          onClose={() => setAboutOpen(false)}
        />
      )}

      {/* Toast */}
      {isDone && toastVisible && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--success)',
            color: '#fff',
            padding: '10px 22px',
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
            zIndex: 9999,
            fontWeight: 600,
            fontSize: '.88rem',
          }}
        >
          <CheckCircle size={16} /> Processing Complete!
        </div>
      )}
    </div>
  );
}
