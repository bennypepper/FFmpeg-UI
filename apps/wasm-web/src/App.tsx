import { useState, useCallback, useRef } from 'react';
import { MediaEditor } from '@ffmpeg-ui/ui';
import type { BatchExecutionItem, BatchStatus, MediaInfo, MediaItem } from '@ffmpeg-ui/ui';
import { planFFmpegJob } from '@ffmpeg-ui/core';
import type { CommandOptions } from '@ffmpeg-ui/core';
import {
  useFFmpeg,
  WASM_FFMPEG_VERSION,
  isFFmpegCancelledError,
  sanitizeVfsExtension,
} from './useFFmpeg';

const LARGE_FILE_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB
const PROBE_TIMEOUT_MS = 5000;
const DOWNLOAD_REVOKE_DELAY_MS = 10_000;

const RE_VIDEO_FILE = /\.(mp4|webm|mov|mkv|avi|m4v|ogv|flv|wmv|ts|3gp|gif|mpg|mpeg)$/i;
const RE_AUDIO_FILE = /\.(mp3|wav|ogg|flac|m4a|aac|opus|wma|aiff|ac3)$/i;

let jobCounter = 0;

function nextJobId(): string {
  jobCounter += 1;
  return `${jobCounter}_${Date.now().toString(36)}`;
}

function createItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getFileExtension(name: string): string {
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? name.slice(dotIdx + 1) : '';
}

function buildDownloadFilename(originalName: string, outputExt: string): string {
  const cleanExt = sanitizeVfsExtension(outputExt, 'bin');
  const dotIdx = originalName.lastIndexOf('.');
  const rawBase = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const safeBase =
    rawBase
      .replace(/^[-.\s]+/, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .trim() || 'output';
  return `${safeBase}_converted.${cleanExt}`;
}

function probeHTML5(file: File): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    const name = file.name.toLowerCase();
    const isVideo = RE_VIDEO_FILE.test(name);
    const isAudio = RE_AUDIO_FILE.test(name);

    if (!isVideo && !isAudio) {
      resolve({ size_mb: sizeMb });
      return;
    }

    const url = URL.createObjectURL(file);
    const el: HTMLVideoElement | HTMLAudioElement = isVideo
      ? document.createElement('video')
      : document.createElement('audio');
    el.preload = 'metadata';

    let settled = false;
    const finish = (info: MediaInfo) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      resolve(info);
    };

    const timeoutId = window.setTimeout(() => {
      finish({ size_mb: sizeMb, format_name: file.type || undefined });
    }, PROBE_TIMEOUT_MS);

    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;
      const videoEl = isVideo ? (el as HTMLVideoElement) : null;
      finish({
        duration,
        width: videoEl && videoEl.videoWidth > 0 ? videoEl.videoWidth : undefined,
        height: videoEl && videoEl.videoHeight > 0 ? videoEl.videoHeight : undefined,
        size_mb: sizeMb,
        format_name: file.type || undefined,
        video_codec: isVideo ? 'html5_video' : undefined,
        audio_codec: isAudio ? 'html5_audio' : undefined,
      });
    };

    el.onerror = () => {
      finish({ size_mb: sizeMb, format_name: file.type || undefined });
    };

    el.src = url;
  });
}

async function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;

    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.onchange = null;
      input.removeEventListener('cancel', onCancel);
      resolve(files);
    };

    const onCancel = () => done([]);
    input.addEventListener('cancel', onCancel, { once: true });
    input.onchange = (e) => {
      done(Array.from((e.target as HTMLInputElement).files ?? []));
    };
    input.click();
  });
}

export default function App() {
  const { state, isReady, logs, progress, appendLog, retry, exec, cancel } = useFFmpeg();

  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [largeFileWarning, setLargeFileWarning] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert',
    input: '',
    fmt: 'mp4',
    vc: 'libx264',
    ac: 'aac',
    crf: '23',
  });

  const cancelledRef = useRef(false);
  const isLoading = state.step === 'idle' || state.step === 'loading';

  const buildItems = useCallback(
    async (files: File[]): Promise<MediaItem[]> => {
      const oversized = files.filter(f => f.size > LARGE_FILE_THRESHOLD_BYTES);
      if (oversized.length > 0) {
        const names = oversized
          .map(f => `${f.name} (${(f.size / (1024 * 1024)).toFixed(0)} MB)`)
          .join(', ');
        const warning =
          `Large file warning: ${names} exceeds 500 MB. Browser WebAssembly holds media in tab RAM and may run out of memory — consider the Native Desktop App for large files.`;
        setLargeFileWarning(warning);
        appendLog(`[App] ⚠️ ${warning}`);
      }

      return Promise.all(
        files.map(async (f) => ({
          id: createItemId(),
          name: f.name,
          file: f,
          previewUrl: URL.createObjectURL(f),
          probe: await probeHTML5(f),
        })),
      );
    },
    [appendLog],
  );

  const enqueueFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const newItems = await buildItems(files);
      setQueue(prev => [...prev, ...newItems]);
      setActiveFileId(prev => prev ?? newItems[0]?.id ?? null);
    },
    [buildItems],
  );

  const handleAddFiles = useCallback(async () => {
    const files = await pickFiles();
    await enqueueFiles(files);
  }, [enqueueFiles]);

  const handleDropFiles = useCallback(
    async (files: File[]) => {
      await enqueueFiles(files);
    },
    [enqueueFiles],
  );

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    setIsDone(false);
    cancel();
  }, [cancel]);

  const handleExecute = useCallback(
    async (jobs: BatchExecutionItem[], isBatch: boolean) => {
      if (jobs.length === 0 || isProcessing) return;
      if (!isReady) {
        const msg = 'FFmpeg WebAssembly is still loading. Please wait until Ready.';
        setErrorMessage(msg);
        appendLog(`[App] ❌ ${msg}`);
        return;
      }

      cancelledRef.current = false;
      setIsProcessing(true);
      setIsDone(false);
      setErrorMessage(null);

      let completedCount = 0;

      try {
        for (let i = 0; i < jobs.length; i += 1) {
          if (cancelledRef.current) break;

          const { item, options: jobOpts } = jobs[i];
          if (!item.file) {
            throw new Error(`${item.name}: Missing browser file reference.`);
          }

          setBatchStatus({
            current: i + 1,
            total: jobs.length,
            currentName: item.name,
          });

          const jobId = nextJobId();
          const safeInExt = sanitizeVfsExtension(getFileExtension(item.name), 'bin');
          const vfsInputName = `in_${jobId}.${safeInExt}`;
          const durationSec =
            typeof item.probe?.duration === 'number' && Number.isFinite(item.probe.duration)
              ? item.probe.duration
              : undefined;

          const initialPlan = planFFmpegJob(
            { ...jobOpts, input: vfsInputName, output: undefined, durationSec },
            'wasm',
          );

          if (initialPlan.errors.length > 0) {
            throw new Error(`${item.name}: ${initialPlan.errors.join(' ')}`);
          }

          for (const warning of initialPlan.warnings) {
            appendLog(`[Planner] ⚠️ ${item.name}: ${warning}`);
          }

          const safeOutExt = sanitizeVfsExtension(initialPlan.outputExt, 'bin');
          const vfsOutputName = `out_${jobId}.${safeOutExt}`;

          const finalPlan = planFFmpegJob(
            {
              ...jobOpts,
              input: vfsInputName,
              output: vfsOutputName,
              durationSec,
            },
            'wasm',
          );

          if (finalPlan.errors.length > 0) {
            throw new Error(`${item.name}: ${finalPlan.errors.join(' ')}`);
          }

          const blob = await exec({
            args: finalPlan.args,
            inputFile: item.file,
            vfsInputName,
            vfsOutputName,
          });

          if (cancelledRef.current) break;

          if (blob.size === 0) {
            throw new Error(`${item.name}: FFmpeg produced an empty (0-byte) output file.`);
          }

          const downloadName = buildDownloadFilename(item.name, finalPlan.outputExt);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = downloadName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS);

          appendLog(
            `[App] ✅ ${isBatch ? `[${i + 1}/${jobs.length}] ` : ''}Saved ${downloadName} (${(blob.size / 1024).toFixed(1)} KB)`,
          );
          completedCount += 1;
        }

        if (!cancelledRef.current && completedCount > 0) {
          setIsDone(true);
        }
      } catch (err) {
        if (isFFmpegCancelledError(err) || cancelledRef.current) {
          appendLog('[App] Conversion cancelled.');
          setIsDone(false);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          appendLog(`[App] ❌ ${msg}`);
          setErrorMessage(msg);
          setIsDone(false);
        }
      } finally {
        setIsProcessing(false);
        setBatchStatus(null);
      }
    },
    [isProcessing, isReady, appendLog, exec],
  );

  const activeMediaInfo = activeFileId
    ? (queue.find(q => q.id === activeFileId)?.probe ?? null)
    : null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '8px 20px',
            background: 'var(--bg-warning)',
            borderBottom: '1px solid var(--border-warning)',
            color: 'var(--text-warning)',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'wasm-spin 0.8s linear infinite',
              flexShrink: 0,
            }}
          />
          <span>
            <strong>Loading FFmpeg {WASM_FFMPEG_VERSION}…</strong> Fetching and compiling WebAssembly core (~32 MB, cached locally after first load).
          </span>
        </div>
      )}

      {state.step === 'error' && (
        <div
          role="alert"
          style={{
            padding: '10px 20px',
            background: 'rgba(220, 38, 38, 0.1)',
            borderBottom: '1px solid rgba(220, 38, 38, 0.3)',
            color: 'var(--danger)',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexShrink: 0,
          }}
        >
          <span>⚠️ FFmpeg WASM failed to load: {state.errorMessage}</span>
          <button
            type="button"
            onClick={retry}
            style={{
              padding: '5px 14px',
              background: 'var(--danger)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {largeFileWarning && (
        <div
          role="status"
          style={{
            padding: '8px 20px',
            background: 'var(--bg-warning)',
            borderBottom: '1px solid var(--border-warning)',
            color: 'var(--text-warning)',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexShrink: 0,
          }}
        >
          <span>⚠️ {largeFileWarning}</span>
          <button
            type="button"
            onClick={() => setLargeFileWarning(null)}
            aria-label="Dismiss large file warning"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div
        style={{
          padding: '7px 20px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-light)',
          color: 'var(--text-secondary)',
          fontSize: '0.74rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          flexShrink: 0,
        }}
      >
        <span>
          <strong>Browser WASM Sandbox:</strong> 100% local in-tab conversion (no uploads, single-threaded CPU). For hardware acceleration, H.265/VP9, or files over 500 MB, use the Native Desktop App.
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <MediaEditor
          capabilities={isReady ? { has_ffmpeg: true, version: WASM_FFMPEG_VERSION } : null}
          onAddFiles={handleAddFiles}
          onDropFiles={handleDropFiles}
          onExecute={handleExecute}
          onCancel={handleCancel}
          isProcessing={isProcessing}
          isDone={isDone}
          terminalLogs={logs}
          progress={progress}
          queue={queue}
          setQueue={setQueue}
          activeFileId={activeFileId}
          setActiveFileId={setActiveFileId}
          mediaInfo={activeMediaInfo}
          options={options}
          setOptions={setOptions}
          platform="wasm"
          platformLabel="Browser WASM"
          errorMessage={errorMessage}
          onDismissError={() => setErrorMessage(null)}
          batchStatus={batchStatus}
        />
      </div>
    </div>
  );
}
