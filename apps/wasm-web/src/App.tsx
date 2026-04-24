import { useState, useCallback } from 'react';
import { MediaEditor } from '@ffmpeg-ui/ui';
import type { MediaItem } from '@ffmpeg-ui/ui';
import { buildFFmpegArgs } from '@ffmpeg-ui/core';
import type { CommandOptions } from '@ffmpeg-ui/core';
import { useFFmpeg, type FFmpegStep } from './useFFmpeg';

// ---------------------------------------------------------------------------
// Step label map for the loading banner
// ---------------------------------------------------------------------------
const STEP_LABELS: Record<FFmpegStep, string> = {
  idle:         'Waiting…',
  downloading:  'Downloading WASM binary (~30 MB)…',
  initializing: 'Compiling and initializing FFmpeg engine…',
  ready:        'Ready',
  error:        'Failed',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function probeHTML5(file: File): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const url  = URL.createObjectURL(file);
    const name = file.name.toLowerCase();
    const isVideo = /\.(mp4|webm|mov|mkv|avi)$/i.test(name);
    const isAudio = /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(name);

    if (!isVideo && !isAudio) {
      resolve({ size_mb: (file.size / (1024 * 1024)).toFixed(2) });
      return;
    }

    const el: HTMLVideoElement | HTMLAudioElement = isVideo
      ? document.createElement('video')
      : document.createElement('audio');

    el.onloadedmetadata = () => {
      resolve({
        duration:    el.duration,
        width:       (el as HTMLVideoElement).videoWidth,
        height:      (el as HTMLVideoElement).videoHeight,
        size_mb:     (file.size / (1024 * 1024)).toFixed(2),
        format_name: file.type || undefined,
        video_codec: isVideo ? 'html5_video' : undefined,
        audio_codec: isAudio ? 'html5_audio' : undefined,
      });
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      resolve({ size_mb: (file.size / (1024 * 1024)).toFixed(2) });
      URL.revokeObjectURL(url);
    };
    el.src = url;
  });
}

async function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      resolve(Array.from((e.target as HTMLInputElement).files ?? []));
    };
    input.click();
  });
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const { state, isReady, logs, progress, retry, exec, cancel } = useFFmpeg();

  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone,       setIsDone]       = useState(false);
  const [queue,        setQueue]        = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [options,      setOptions]      = useState<CommandOptions>({
    mode: 'convert', input: '', fmt: 'mp4', vc: 'libx264', ac: 'aac', crf: '23',
  });

  const isLoading = state.step === 'downloading' || state.step === 'initializing';

  // Compute overall loading bar percentage
  const loadPct = (() => {
    if (state.step === 'ready')        return 100;
    if (state.step === 'downloading')  return Math.round(state.downloadPct * 0.9); // 0-90%
    if (state.step === 'initializing') return 90 + Math.round(state.downloadPct * 0.1); // 90-100%
    return 0;
  })();

  // ---------------------------------------------------------------------------
  // File adding
  // ---------------------------------------------------------------------------

  const buildItems = useCallback(async (files: File[]): Promise<MediaItem[]> => {
    return Promise.all(
      files.map(async (f) => ({
        id:         Math.random().toString(36).slice(2),
        name:       f.name,
        file:       f,
        previewUrl: URL.createObjectURL(f),
        probe:      await probeHTML5(f),
      })),
    );
  }, []);

  const handleAddFiles = useCallback(async () => {
    const files = await pickFiles();
    if (files.length === 0) return;
    const newItems = await buildItems(files);
    setQueue(prev => [...prev, ...newItems]);
  }, [buildItems]);

  const handleDropFiles = useCallback(async (files: File[]) => {
    const newItems = await buildItems(files);
    setQueue(prev => [...prev, ...newItems]);
  }, [buildItems]);

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  const handleExecute = useCallback(async (
    opts: CommandOptions,
    _activeItem: MediaItem | null,
    q: MediaItem[],
  ) => {
    if (q.length === 0 || isProcessing || !isReady) return;

    setIsProcessing(true);
    setIsDone(false);

    try {
      for (const item of q) {
        if (!item.file) continue;

        const inName  = item.name.replace(/\s+/g, '_');
        const baseName = inName.includes('.')
          ? inName.substring(0, inName.lastIndexOf('.'))
          : inName;
        const outName = `${baseName}_converted.${opts.fmt}`;

        const args = buildFFmpegArgs({ ...opts, input: inName });
        args[args.length - 1] = outName;

        const blob = await exec(args, item.file, outName);

        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = outName;
        a.click();
        URL.revokeObjectURL(url);
      }
      setIsDone(true);
    } catch (e) {
      console.error('[App] Execution error:', e);
      setIsDone(false);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, isReady, exec]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Titlebar */}
      <div style={{
        height: '40px', background: 'var(--bg-panel)', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid var(--border-light)', flexShrink: 0,
      }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          FFmpeg UI <span style={{ color: '#f7df1e', fontSize: '0.8em', marginLeft: '4px' }}>WEB-ASSEMBLY</span>
        </span>
        <span style={{ fontSize: '0.72rem', opacity: 0.5 }}>
          {isReady       ? '🟢 Ready'
           : isLoading   ? '🟡 Loading…'
           : state.step === 'error' ? '🔴 Error'
           : '⚪ Idle'}
        </span>
      </div>

      {/* Loading progress banner */}
      {isLoading && (
        <div style={{
          padding: '10px 20px',
          background: 'rgba(247, 223, 30, 0.08)',
          borderBottom: '1px solid rgba(247, 223, 30, 0.2)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-1, #f5f5f5)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                display: 'inline-block', width: '12px', height: '12px',
                border: '2px solid #f7df1e', borderTop: '2px solid transparent',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              {STEP_LABELS[state.step]}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-2, #999)', fontFamily: 'monospace' }}>
              {loadPct > 0 ? `${loadPct}%` : ''}
            </span>
          </div>
          <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              width: `${loadPct}%`, height: '100%', background: '#f7df1e',
              borderRadius: '2px', transition: 'width 0.3s ease',
            }} />
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error banner */}
      {state.step === 'error' && (
        <div style={{
          padding: '12px 20px',
          background: 'rgba(220, 38, 38, 0.1)',
          borderBottom: '1px solid rgba(220, 38, 38, 0.3)',
          color: '#dc2626', fontSize: '0.82rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          flexShrink: 0,
        }}>
          <span>⚠️ FFmpeg WASM failed to load: {state.errorMessage}</span>
          <button
            onClick={retry}
            style={{
              padding: '6px 16px', background: '#dc2626', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
        <MediaEditor
          capabilities={isReady ? { has_ffmpeg: true, version: '7.1' } : null}
          onAddFiles={handleAddFiles}
          onDropFiles={handleDropFiles}
          onExecute={handleExecute}
          onCancel={cancel}
          isProcessing={isProcessing}
          isDone={isDone}
          terminalLogs={logs}
          progress={progress ? {
            frame: 0, fps: 0, speed: 1, size_kb: 0,
            time_s: progress.timeUs / 1_000_000,
            bitrate_kbps: 0,
            fps_ratio: progress.ratio,
          } : null}
          queue={queue}
          setQueue={setQueue}
          activeFileId={activeFileId}
          setActiveFileId={setActiveFileId}
          mediaInfo={activeFileId ? queue.find(q => q.id === activeFileId)?.probe : null}
          options={options}
          setOptions={setOptions}
        />
      </div>
    </div>
  );
}
