import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { Store } from '@tauri-apps/plugin-store';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { MediaEditor, AboutModal } from '@ffmpeg-ui/ui';
import type { BatchExecutionItem, BatchStatus, MediaInfo, MediaItem, ProgressInfo } from '@ffmpeg-ui/ui';
import type { CommandOptions } from '@ffmpeg-ui/core';

// ── IPC contract (mirrors apps/desktop/src-tauri) ──────────────────────────

interface Capabilities {
  has_ffmpeg: boolean;
  has_ffprobe: boolean;
  version: string;
  ffmpeg_path: string | null;
  ffprobe_path: string | null;
}

interface ProgressPayload {
  job_id: string;
  frame: number;
  fps: number;
  speed: number;
  size_kb: number;
  time_s: number;
  bitrate_kbps: number;
}

interface LogPayload {
  job_id: string;
  level: 'info' | 'warning' | 'error' | 'done' | 'started';
  message: string;
}

interface JobFinishedEvent {
  job_id: string;
  success: boolean;
  cancelled: boolean;
  exit_code: number | null;
  output_path: string;
  error: string | null;
}

interface DownloadProgressPayload {
  stage: 'downloading' | 'verifying' | 'complete';
  binary: string;
  downloaded_bytes: number;
  total_bytes: number | null;
  percent: number | null;
}

interface ConvertRequest {
  job_id: string;
  input_path: string;
  output_dir: string;
  options: CommandOptions;
}

// ── ffprobe JSON ───────────────────────────────────────────────────────────

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
}

interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

interface FfprobeResult {
  format?: FfprobeFormat;
  streams?: FfprobeStream[];
}

// ── Constants & helpers ────────────────────────────────────────────────────

const THEME_STORAGE_KEY = 'ffmpeg-ui-theme';
const MAX_LOG_LINES = 200;
const MEDIA_EXTENSIONS = [
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'ts', 'mpg', 'mpeg', '3gp',
  'mp3', 'aac', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'wma',
];

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || 'Unknown';
}

function extensionOf(p: string): string {
  const name = baseName(p);
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

function makeJobId(): string {
  return `job_${crypto.randomUUID().replace(/-/g, '')}`;
}

function readStoredTheme(): 'dark' | 'light' {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // storage unavailable
  }
  return 'dark';
}

function toPersistable(opts: CommandOptions): CommandOptions {
  const copy: CommandOptions = { ...opts };
  delete copy.input; // transient, per-file
  delete copy.output;
  return copy;
}

function toFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function probeMedia(path: string): Promise<MediaInfo> {
  const raw = await invoke<string>('probe_file', { path });
  const info = JSON.parse(raw) as FfprobeResult;
  const format = info.format ?? {};
  const streams = info.streams ?? [];
  const merged: MediaInfo = { format_name: format.format_name };

  const duration = toFiniteNumber(format.duration);
  if (duration !== undefined) merged.duration = duration;
  const sizeBytes = toFiniteNumber(format.size);
  if (sizeBytes !== undefined) merged.size_mb = sizeBytes / (1024 * 1024);
  const bitRate = toFiniteNumber(format.bit_rate);
  if (bitRate !== undefined) merged.bitrate_kbps = Math.round(bitRate / 1000);

  const vStream = streams.find(s => s.codec_type === 'video');
  const aStream = streams.find(s => s.codec_type === 'audio');
  if (vStream) {
    merged.video_codec = vStream.codec_name;
    merged.width = vStream.width;
    merged.height = vStream.height;
    if (vStream.r_frame_rate) {
      const [num, den] = vStream.r_frame_rate.split('/').map(Number);
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) merged.fps = num / den;
    }
  }
  if (aStream) {
    merged.audio_codec = aStream.codec_name;
    merged.sample_rate = aStream.sample_rate;
    merged.channels = aStream.channels;
  }
  return merged;
}

async function notify(body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (granted) sendNotification({ title: 'FFmpeg UI', body });
  } catch (err) {
    console.warn('Notification unavailable:', err);
  }
}

function openExternalUrl(url: string): void {
  void invoke('plugin:opener|open_url', { url }).catch(console.error);
}

export default function App() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [isDownloadingEngine, setIsDownloadingEngine] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressPayload | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(readStoredTheme);

  const currentJobIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const isProcessingRef = useRef(false);
  const activeDurationRef = useRef<number | undefined>(undefined);
  const storeLoadedRef = useRef(false);
  const probeRequestRef = useRef(0);

  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert',
    fmt: 'mp4',
    vc: 'libx264',
    ac: 'aac',
    crf: '23',
  });

  const appendLog = useCallback((line: string) => {
    setTerminalLogs(prev => [...prev.slice(-(MAX_LOG_LINES - 1)), line]);
  }, []);

  // Theme: controlled here, persisted to localStorage.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // storage unavailable
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Register OS-dropped / dialog-picked paths with the asset scope and enqueue them.
  const addPaths = useCallback(
    async (paths: string[]) => {
      const newItems: MediaItem[] = [];
      for (const rawPath of paths) {
        if (!MEDIA_EXTENSIONS.includes(extensionOf(rawPath))) {
          appendLog(`[Warning] Skipped unsupported file: ${baseName(rawPath)}`);
          continue;
        }
        try {
          const canonical = await invoke<string>('allow_asset_file', { path: rawPath });
          newItems.push({
            id: crypto.randomUUID(),
            name: baseName(canonical),
            path: canonical,
            previewUrl: convertFileSrc(canonical),
          });
        } catch (err) {
          appendLog(`[Error] Cannot add ${baseName(rawPath)}: ${errorText(err)}`);
        }
      }
      if (newItems.length === 0) return;
      setQueue(old => [...old, ...newItems]);
      setActiveFileId(prev => prev ?? newItems[0].id);
    },
    [appendLog],
  );

  // Settings store + capabilities (once).
  useEffect(() => {
    let disposed = false;

    Store.load('ffmpeg-settings.json')
      .then(async s => {
        const saved = await s.get<CommandOptions>('options');
        if (disposed) return;
        if (saved) {
          setOptions(prev => ({ ...prev, ...toPersistable(saved) }));
          appendLog('[System] Loaded settings');
        }
        storeLoadedRef.current = true;
        setStore(s);
      })
      .catch(err => {
        if (!disposed) appendLog(`[Warning] Could not load settings store: ${errorText(err)}`);
      });

    invoke<Capabilities>('get_capabilities')
      .then(res => {
        if (disposed) return;
        setCapabilities(res);
        appendLog(`[System] ${res.version}`);
      })
      .catch(err => {
        if (!disposed) appendLog(`[Error] ${errorText(err)}`);
      });

    return () => {
      disposed = true;
    };
  }, [appendLog]);

  // Persist options (never before the saved value has been applied).
  useEffect(() => {
    if (!store || !storeLoadedRef.current) return;
    store.set('options', toPersistable(options)).catch(err => {
      console.warn('Could not persist settings:', err);
    });
  }, [options, store]);

  // Tauri event listeners + native drag & drop (StrictMode-safe).
  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const track = (pending: Promise<UnlistenFn>) => {
      pending
        .then(unlisten => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(err => console.error('Failed to register listener:', err));
    };

    track(
      listen<ProgressPayload>('progress-update', e => {
        if (e.payload.job_id !== currentJobIdRef.current) return;
        const { frame, fps, speed, size_kb, time_s } = e.payload;
        const duration = activeDurationRef.current;
        const hasDuration = duration !== undefined && duration > 0;
        const percent = hasDuration ? Math.min(100, Math.max(0, (time_s / duration) * 100)) : 0;
        const etaSec = hasDuration && speed > 0 ? Math.max(0, (duration - time_s) / speed) : undefined;
        setProgress({ percent, fps, frame, speed, sizeMb: size_kb / 1024, timeSec: time_s, etaSec });
      }),
    );

    track(
      listen<LogPayload>('log-update', e => {
        if (e.payload.job_id !== currentJobIdRef.current) return;
        // Informational only: ffmpeg prints "error" lines for recoverable issues too.
        appendLog(`[${e.payload.level}] ${e.payload.message}`);
      }),
    );

    track(
      listen<JobFinishedEvent>('job-finished', e => {
        const p = e.payload;
        if (p.job_id !== currentJobIdRef.current) return;
        if (p.success) appendLog(`[Done] ${p.output_path}`);
        else if (p.cancelled) appendLog('[Cancelled] Job cancelled.');
        else appendLog(`[Failed] ${p.error ?? `ffmpeg exited with code ${p.exit_code ?? 'unknown'}`}`);
      }),
    );

    track(
      listen<DownloadProgressPayload>('ffmpeg-download-progress', e => {
        setDownloadProgress(e.payload);
      }),
    );

    track(
      getCurrentWebview().onDragDropEvent(event => {
        if (event.payload.type === 'drop') void addPaths(event.payload.paths);
      }),
    );

    return () => {
      disposed = true;
      unlisteners.splice(0).forEach(unlisten => unlisten());
    };
  }, [appendLog, addPaths]);

  // Probe the active item once; cache the result on the queue item.
  const activeItem = queue.find(q => q.id === activeFileId) ?? null;
  const activeId = activeItem?.id ?? null;
  const activePath = activeItem?.path ?? null;
  const activeProbed = activeItem?.probe != null;

  useEffect(() => {
    if (!activeId || !activePath || activeProbed) return;
    const requestId = ++probeRequestRef.current;
    probeMedia(activePath)
      .then(info => {
        setQueue(old => old.map(q => (q.id === activeId ? { ...q, probe: info } : q)));
      })
      .catch(err => {
        if (requestId !== probeRequestRef.current) return;
        appendLog(`[Warning] ffprobe failed: ${errorText(err)}`);
        // Cache an empty result so a failing file is not re-probed in a loop.
        setQueue(old => old.map(q => (q.id === activeId ? { ...q, probe: {} } : q)));
      });
  }, [activeId, activePath, activeProbed, appendLog]);

  const mediaInfo: MediaInfo | null = activeItem?.probe ?? null;

  const handleExecute = async (jobs: BatchExecutionItem[], isBatch: boolean) => {
    if (isProcessingRef.current) return;
    const runnable = jobs.filter(j => !!j.item.path);
    if (runnable.length === 0) {
      setErrorMessage('No local files to convert.');
      return;
    }

    let selectedDir: string | null;
    try {
      selectedDir = await open({ directory: true, multiple: false, title: 'Select Destination Folder' });
    } catch (err) {
      setErrorMessage(`Folder dialog error: ${errorText(err)}`);
      return;
    }
    if (!selectedDir) return; // user cancelled the dialog

    isProcessingRef.current = true;
    cancelledRef.current = false;
    setIsProcessing(true);
    setIsDone(false);
    setErrorMessage(null);

    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;
    const total = runnable.length;

    try {
      for (let i = 0; i < total; i++) {
        if (cancelledRef.current) break;
        const { item, options: jobOptions } = runnable[i];
        const inputPath = item.path as string;

        setActiveFileId(item.id);
        setBatchStatus({ current: i + 1, total, currentName: item.name });
        setProgress({ percent: 0 });

        let duration = item.probe?.duration;
        if (duration === undefined) {
          try {
            duration = (await probeMedia(inputPath)).duration;
          } catch (err) {
            appendLog(`[Warning] ffprobe failed for ${item.name}: ${errorText(err)}`);
          }
        }
        if (cancelledRef.current) break;
        activeDurationRef.current = duration;

        const sanitized: CommandOptions = { ...jobOptions };
        if (sanitized.custom) {
          appendLog('[Warning] Custom FFmpeg arguments are not supported in the desktop app and were ignored.');
        }
        delete sanitized.custom;
        delete sanitized.input;
        delete sanitized.output;
        if (duration !== undefined) sanitized.durationSec = duration;

        const jobId = makeJobId();
        currentJobIdRef.current = jobId;
        const request: ConvertRequest = {
          job_id: jobId,
          input_path: inputPath,
          output_dir: selectedDir,
          options: sanitized,
        };
        appendLog(`[Command] Processing ${i + 1}/${total}: ${item.name}`);

        try {
          const result = await invoke<JobFinishedEvent>('start_convert', { request });
          if (result.success) succeeded++;
          else if (result.cancelled || cancelledRef.current) cancelled++;
          else {
            failed++;
            setErrorMessage(`${item.name}: ${result.error ?? 'Conversion failed.'}`);
          }
        } catch (err) {
          if (cancelledRef.current) {
            cancelled++;
          } else {
            failed++;
            setErrorMessage(`${item.name}: ${errorText(err)}`);
            appendLog(`[Failed] ${item.name}: ${errorText(err)}`);
          }
        } finally {
          currentJobIdRef.current = null;
        }

        if (cancelledRef.current) break;
      }
    } finally {
      const wasCancelled = cancelledRef.current;
      isProcessingRef.current = false;
      activeDurationRef.current = undefined;
      setIsProcessing(false);
      setProgress(null);
      setBatchStatus(null);
      const allOk = !wasCancelled && failed === 0 && succeeded > 0;
      setIsDone(allOk);

      let summary: string;
      if (wasCancelled) {
        summary = `⏹ Cancelled — ${succeeded} succeeded, ${failed} failed.`;
      } else if (failed > 0) {
        summary = `❌ ${failed} of ${total} conversion${total === 1 ? '' : 's'} failed (${succeeded} succeeded).`;
      } else if (isBatch || total > 1) {
        summary = `✅ All ${succeeded} conversions completed successfully!`;
      } else {
        summary = '✅ Conversion completed successfully!';
      }
      if (cancelled > 0 && !wasCancelled) summary += ` ${cancelled} cancelled.`;
      appendLog(`[Summary] ${summary}`);
      void notify(summary);
    }
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    const jobId = currentJobIdRef.current;
    if (!jobId) return;
    try {
      const cancelledJob = await invoke<boolean>('cancel_job', { jobId });
      appendLog(cancelledJob ? `[Cancelled] Job ${jobId} cancelled.` : `[Cancelled] Job ${jobId} was no longer running.`);
    } catch (err) {
      appendLog(`[Error] Cancel failed: ${errorText(err)}`);
    }
  };

  const handleAddFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Media', extensions: MEDIA_EXTENSIONS }],
      });
      if (!selected) return;
      await addPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (err) {
      appendLog(`[Error] File dialog error: ${errorText(err)}`);
    }
  };

  const handleDropFiles = (files: File[]) => {
    // Native drops are delivered through onDragDropEvent with real OS paths.
    // Browser-style drops carry no filesystem path and cannot be processed by FFmpeg.
    if (files.length > 0) {
      appendLog('[Warning] Dropped files had no local path. Use "Add" or drop files from your file manager.');
    }
  };

  const handleDownloadEngine = async () => {
    try {
      setIsDownloadingEngine(true);
      setDownloadError(null);
      setDownloadProgress(null);
      appendLog('[System] Downloading engine...');
      await invoke<string>('download_ffmpeg');
      const res = await invoke<Capabilities>('get_capabilities');
      setCapabilities(res);
      appendLog(`[System] ${res.version}`);
    } catch (err) {
      setDownloadError(errorText(err));
      appendLog(`[Error] Failed to install engine: ${errorText(err)}`);
    } finally {
      setIsDownloadingEngine(false);
      setDownloadProgress(null);
    }
  };

  const showMissingOverlay = capabilities !== null && !capabilities.has_ffmpeg && !isDownloadingEngine;
  const showDownloadingOverlay = isDownloadingEngine;
  const dlPercent = downloadProgress?.percent ?? null;
  const dlStageLabel = downloadProgress
    ? `${downloadProgress.stage === 'verifying' ? 'Verifying' : downloadProgress.stage === 'complete' ? 'Complete' : 'Downloading'} ${downloadProgress.binary}`
    : 'Starting…';
  const dlBytesLabel =
    downloadProgress && downloadProgress.total_bytes
      ? `${(downloadProgress.downloaded_bytes / (1024 * 1024)).toFixed(1)} / ${(downloadProgress.total_bytes / (1024 * 1024)).toFixed(1)} MB`
      : downloadProgress
        ? `${(downloadProgress.downloaded_bytes / (1024 * 1024)).toFixed(1)} MB`
        : '';

  return (
    <>
      <div
        style={{
          position: 'relative',
          padding: '0',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          background: 'var(--bg-base)',
          userSelect: 'none',
        }}
      >
        <div
          data-tauri-drag-region
          style={{
            height: '40px',
            background: 'var(--bg-panel)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            borderBottom: '1px solid var(--border-light)',
          }}
        >
          <span
            data-tauri-drag-region
            style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', pointerEvents: 'none' }}
          >
            FFmpeg UI{' '}
            <span style={{ color: 'var(--accent-primary)', fontSize: '0.8em', marginLeft: '4px' }}>
              Desktop Native
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
            {capabilities && (
              <span style={{ fontSize: '0.70rem', opacity: 0.5 }}>
                {capabilities.has_ffmpeg ? '🟢' : '🔴'} {capabilities.version.split('-')[0].trim()}
              </span>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              title="Toggle theme"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
                borderRadius: 4,
                color: 'var(--text-2, #999)',
                fontSize: '0.85rem',
                fontFamily: 'inherit',
              }}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              title="About FFmpeg UI"
              aria-label="About FFmpeg UI"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
                borderRadius: 4,
                color: 'var(--text-2, #999)',
                fontSize: '0.72rem',
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              ?
            </button>
          </span>
        </div>

        {(showMissingOverlay || showDownloadingOverlay) && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(0, 0, 0, 0.85)',
              backdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: '20px',
              padding: '40px',
            }}
          >
            <div
              style={{
                background: 'var(--glass, rgba(30,30,30,0.95))',
                border: '1px solid var(--border, #333)',
                borderRadius: '16px',
                padding: '40px 48px',
                maxWidth: '480px',
                width: '100%',
                textAlign: 'center',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            >
              {showDownloadingOverlay ? (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏬</div>
                  <h2 style={{ color: 'var(--text-1, #f5f5f5)', fontSize: '1.3rem', fontWeight: 700, margin: '0 0 8px' }}>
                    Downloading FFmpeg Core...
                  </h2>
                  <p style={{ color: 'var(--text-2, #aaa)', fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 20px' }}>
                    {dlStageLabel}
                    {dlPercent !== null ? ` — ${dlPercent.toFixed(0)}%` : ''}
                    {dlBytesLabel ? ` (${dlBytesLabel})` : ''}
                  </p>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={dlPercent !== null ? Math.round(dlPercent) : undefined}
                    style={{
                      width: '100%',
                      height: '6px',
                      background: 'var(--border, #333)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      marginBottom: '16px',
                    }}
                  >
                    <div
                      style={{
                        width: dlPercent !== null ? `${Math.min(100, Math.max(0, dlPercent))}%` : '100%',
                        height: '100%',
                        background: 'var(--active, #f5f5f5)',
                        borderRadius: '3px',
                        transition: 'width 0.2s ease',
                        animation: dlPercent === null ? 'downloadPulse 1.5s ease-in-out infinite' : undefined,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      maxHeight: '120px',
                      overflowY: 'auto',
                      textAlign: 'left',
                      fontFamily: 'monospace',
                      fontSize: '0.72rem',
                      color: 'var(--text-2, #888)',
                      lineHeight: 1.6,
                    }}
                  >
                    {terminalLogs.slice(-8).map((log, i) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                  <h2 style={{ color: 'var(--text-1, #f5f5f5)', fontSize: '1.3rem', fontWeight: 700, margin: '0 0 8px' }}>
                    FFmpeg Not Found
                  </h2>
                  <p style={{ color: 'var(--text-2, #aaa)', fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 24px' }}>
                    FFmpeg is required to process media files but was not detected on this machine. Click below to
                    automatically download the required binaries.
                  </p>
                  {downloadError && (
                    <p role="alert" style={{ color: '#f87171', fontSize: '0.8rem', margin: '0 0 16px', userSelect: 'text' }}>
                      Download failed: {downloadError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleDownloadEngine}
                    style={{
                      width: '100%',
                      padding: '14px 24px',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      background: 'var(--active, #f5f5f5)',
                      color: 'var(--active-fg, #171717)',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'opacity 0.2s ease',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
                    }}
                    onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
                    onMouseOut={e => (e.currentTarget.style.opacity = '1')}
                  >
                    {downloadError ? '🔁 Retry Download' : '⬇️ Download FFmpeg Core'}
                  </button>
                  <p style={{ color: 'var(--text-3, #666)', fontSize: '0.72rem', marginTop: '16px', lineHeight: 1.4 }}>
                    Downloads ~80 MB of prebuilt binaries (SHA-256 verified).
                    <br />
                    Alternatively, install FFmpeg to your system PATH manually.
                  </p>
                </>
              )}
            </div>
            <style>{`
              @keyframes downloadPulse {
                0%, 100% { opacity: 0.4; transform: scaleX(0.3); transform-origin: left; }
                50% { opacity: 1; transform: scaleX(1); transform-origin: left; }
              }
            `}</style>
          </div>
        )}

        <div
          style={{
            flex: 1,
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          <MediaEditor
            capabilities={capabilities}
            onAddFiles={handleAddFiles}
            onDropFiles={handleDropFiles}
            onExecute={handleExecute}
            onCancel={handleCancel}
            isProcessing={isProcessing}
            isDone={isDone}
            terminalLogs={terminalLogs}
            progress={progress}
            queue={queue}
            setQueue={setQueue}
            activeFileId={activeFileId}
            setActiveFileId={setActiveFileId}
            mediaInfo={mediaInfo}
            options={options}
            setOptions={setOptions}
            showInternalHeader={false}
            platform="desktop"
            platformLabel="Desktop Native"
            errorMessage={errorMessage}
            onDismissError={() => setErrorMessage(null)}
            onOpenExternalUrl={openExternalUrl}
            batchStatus={batchStatus}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </div>
      </div>

      {aboutOpen && (
        <AboutModal
          platform="Desktop (Tauri)"
          ffmpegVersion={capabilities?.version ?? null}
          onClose={() => setAboutOpen(false)}
          onOpenExternalUrl={openExternalUrl}
        />
      )}
    </>
  );
}
