import { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { MediaEditor } from '@ffmpeg-ui/ui';
import type { MediaItem } from '@ffmpeg-ui/ui';
import { buildFFmpegArgs } from '@ffmpeg-ui/core';
import type { CommandOptions } from '@ffmpeg-ui/core';

// Use a consistent core version that matches the installed @ffmpeg/ffmpeg
const CORE_VERSION = '0.12.6';
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const FFMPEG_LIB_VERSION = '0.12.15';

type LoadStatus =
  | { step: 'idle' }
  | { step: 'core-js'; pct: number }
  | { step: 'wasm'; pct: number }
  | { step: 'worker'; pct: number }
  | { step: 'init' }
  | { step: 'done' }
  | { step: 'error'; msg: string };

const STEP_LABELS: Record<string, string> = {
  'idle': 'Waiting...',
  'core-js': 'Downloading core module',
  'wasm': 'Downloading WASM binary (~30 MB)',
  'worker': 'Downloading worker',
  'init': 'Initializing FFmpeg engine...',
  'done': 'Ready',
  'error': 'Failed',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function App() {
  const ffmpegRef = useRef(new FFmpeg());
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>({ step: 'idle' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert', input: '', fmt: 'mp4', vc: 'libx264', ac: 'aac', crf: '23',
  });

  const isLoading = !isLoaded && !loadError && loadStatus.step !== 'idle';

  const log = useCallback((msg: string) => {
    setTerminalLogs(prev => [...prev.slice(-199), msg]);
  }, []);

  const probeHTML5 = (file: File): Promise<any> => {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const name = file.name.toLowerCase();
        let el: HTMLVideoElement | HTMLAudioElement;
        const isVideo = name.match(/\.(mp4|webm|mov|mkv|avi)$/i);
        const isAudio = name.match(/\.(mp3|wav|ogg|flac|m4a|aac)$/i);
        
        if (isVideo) el = document.createElement('video');
        else if (isAudio) el = document.createElement('audio');
        else {
            resolve({ size_mb: (file.size / (1024*1024)).toFixed(2) });
            return;
        }

        el.onloadedmetadata = () => {
            resolve({
                duration: el.duration,
                width: (el as HTMLVideoElement).videoWidth,
                height: (el as HTMLVideoElement).videoHeight,
                size_mb: (file.size / (1024*1024)).toFixed(2),
                format_name: file.type || undefined,
                video_codec: isVideo ? 'html5_video' : undefined,
                audio_codec: isAudio ? 'html5_audio' : undefined
            });
        };
        el.onerror = () => resolve({ size_mb: (file.size / (1024*1024)).toFixed(2) });
        el.src = url;
    });
  };

  const makeProgressCb = (stepName: LoadStatus['step'] & string, label: string) => {
    return ({ received, total, done }: { received: number; total: number; done: boolean }) => {
      const pct = total > 0 ? Math.round((received / total) * 100) : -1;
      setLoadStatus({ step: stepName, pct } as any);
      if (done) {
        log(`[Download] ${label}: ${formatBytes(received)} ✓`);
      }
    };
  };

  const load = useCallback(async () => {
    if (isLoaded || isLoading) return;
    setLoadError(null);

    try {
      const ffmpeg = ffmpegRef.current;
      
      ffmpeg.on('log', ({ message }) => {
        setTerminalLogs(prev => [...prev.slice(-199), message]);
      });
      
      ffmpeg.on('progress', ({ progress, time }) => {
        setProgress({
          frame: 0, fps: 0, speed: 1, size_kb: 0,
          time_s: time / 1000000, bitrate_kbps: 0, fps_ratio: progress,
        });
      });
      
      const t0 = performance.now();
      log(`[System] Loading FFmpeg WASM core v${CORE_VERSION}...`);

      // Step 1: Download core JS (~300 KB)
      setLoadStatus({ step: 'core-js', pct: 0 });
      log('[Download] Fetching ffmpeg-core.js...');
      const coreURL = await toBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript',
        true, makeProgressCb('core-js', 'ffmpeg-core.js')
      );

      // Step 2: Download WASM binary (~30 MB)
      setLoadStatus({ step: 'wasm', pct: 0 });
      log('[Download] Fetching ffmpeg-core.wasm (~30 MB)...');
      const wasmURL = await toBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm',
        true, makeProgressCb('wasm', 'ffmpeg-core.wasm')
      );

      // Step 3: Download @ffmpeg/ffmpeg's worker (bypasses Vite bundling)
      setLoadStatus({ step: 'worker', pct: 0 });
      log('[Download] Fetching library worker...');
      const classWorkerURL = await toBlobURL(
        `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_LIB_VERSION}/dist/esm/worker.js`,
        'text/javascript',
        true, makeProgressCb('worker', 'worker.js')
      );

      // Step 4: Initialize the FFmpeg engine
      setLoadStatus({ step: 'init' });
      log('[System] All files downloaded. Initializing FFmpeg WASM engine...');
      await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
      
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      log(`[System] ✅ FFmpeg WebAssembly loaded successfully in ${elapsed}s`);
      setLoadStatus({ step: 'done' });
      setIsLoaded(true);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('FFmpeg WASM load failed:', err);
      setLoadStatus({ step: 'error', msg: errMsg });
      setLoadError(errMsg);
      log(`[Error] Failed to load FFmpeg WASM: ${errMsg}`);
    }
  }, [isLoaded, isLoading]);

  useEffect(() => {
    load();
  }, []);

  const handleExecute = async (opts: CommandOptions, activeItem: MediaItem | null, q: MediaItem[]) => {
    if (q.length === 0 || isProcessing || !isLoaded) return;

    const ffmpeg = ffmpegRef.current;
    setIsProcessing(true);
    setIsDone(false);

    try {
      for (const item of q) {
        if (!item.file) continue;

        const inName = item.name.replace(/\s+/g, '_');
        log(`[System] Writing ${inName} to WASM filesystem...`);
        await ffmpeg.writeFile(inName, await fetchFile(item.file));

        const ext = inName.lastIndexOf('.') > 0 ? inName.substring(0, inName.lastIndexOf('.')) : inName;
        const outName = ext + '_converted.' + opts.fmt;

        const args = buildFFmpegArgs({ ...opts, input: inName });
        args[args.length - 1] = outName;

        log(`[Command] ffmpeg ${args.join(' ')}`);
        await ffmpeg.exec(args);

        const data = await ffmpeg.readFile(outName);
        const blob = new Blob([data as any], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = outName;
        a.click();
        URL.revokeObjectURL(url);
        log(`[System] ✅ ${outName} downloaded`);
      }
      setIsDone(true);
    } catch(e) {
      log(`[Error] ${e}`);
      setIsDone(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = useCallback(() => {
    ffmpegRef.current.terminate();
    setIsProcessing(false);
    setIsLoaded(false);
    setLoadStatus({ step: 'idle' });
    ffmpegRef.current = new FFmpeg();
    setTimeout(() => load(), 100);
  }, [load]);

  // Compute loading bar percentage
  const loadPct = (() => {
    if (loadStatus.step === 'done') return 100;
    if (loadStatus.step === 'core-js') return (loadStatus as any).pct * 0.05; // 0-5%
    if (loadStatus.step === 'wasm') return 5 + (loadStatus as any).pct * 0.85; // 5-90%
    if (loadStatus.step === 'worker') return 90 + (loadStatus as any).pct * 0.05; // 90-95%
    if (loadStatus.step === 'init') return 95;
    return 0;
  })();

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
       {/* Titlebar */}
       <div style={{ 
         height: '40px', background: 'var(--bg-panel)', display: 'flex', alignItems: 'center', 
         justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid var(--border-light)',
         flexShrink: 0,
       }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            FFmpeg UI <span style={{ color: '#f7df1e', fontSize: '0.8em', marginLeft: '4px' }}>WEB-ASSEMBLY</span>
          </span>
          <span style={{ fontSize: '0.72rem', opacity: 0.5 }}>
            {isLoaded ? '🟢 Ready' : isLoading ? '🟡 Loading...' : loadError ? '🔴 Error' : '⚪ Idle'}
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
               <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #f7df1e', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
               {STEP_LABELS[loadStatus.step] || 'Loading...'}
             </span>
             <span style={{ fontSize: '0.72rem', color: 'var(--text-2, #999)', fontFamily: 'monospace' }}>
               {loadPct > 0 ? `${Math.round(loadPct)}%` : ''}
             </span>
           </div>
           <div style={{
             width: '100%', height: '3px', background: 'rgba(255,255,255,0.1)',
             borderRadius: '2px', overflow: 'hidden',
           }}>
             <div style={{
               width: `${loadPct}%`, height: '100%', background: '#f7df1e',
               borderRadius: '2px', transition: 'width 0.3s ease',
             }} />
           </div>
           <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
         </div>
       )}

       {/* Load error banner */}
       {loadError && (
         <div style={{
           padding: '12px 20px',
           background: 'rgba(220, 38, 38, 0.1)',
           borderBottom: '1px solid rgba(220, 38, 38, 0.3)',
           color: '#dc2626',
           fontSize: '0.82rem',
           display: 'flex',
           alignItems: 'center',
           justifyContent: 'space-between',
           gap: '12px',
           flexShrink: 0,
         }}>
           <span>⚠️ FFmpeg WASM failed to load: {loadError}</span>
           <button
             onClick={() => { setLoadError(null); setLoadStatus({ step: 'idle' }); load(); }}
             style={{
               padding: '6px 16px',
               background: '#dc2626',
               color: '#fff',
               border: 'none',
               borderRadius: '6px',
               cursor: 'pointer',
               fontSize: '0.78rem',
               fontWeight: 600,
               fontFamily: 'inherit',
               flexShrink: 0,
             }}
           >
             Retry
           </button>
         </div>
       )}

       <div style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
          <MediaEditor
             capabilities={isLoaded ? { has_ffmpeg: true, version: '7.1' } : null}
             onAddFiles={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.onchange = async (e) => {
                  const files = Array.from((e.target as HTMLInputElement).files || []);
                  const newItems = await Promise.all(files.map(async (f: any) => ({
                    id: Math.random().toString(),
                    name: f.name,
                    file: f,
                    previewUrl: URL.createObjectURL(f),
                    probe: await probeHTML5(f)
                  })));
                  setQueue(old => [...old, ...newItems]);
                };
                input.click();
             }}
             onDropFiles={async (files) => {
                const newItems = await Promise.all(files.map(async (f: any) => ({
                  id: Math.random().toString(),
                  name: f.name,
                  file: f,
                  previewUrl: URL.createObjectURL(f),
                  probe: await probeHTML5(f)
                })));
                setQueue(old => [...old, ...newItems]);
             }}
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
             mediaInfo={activeFileId ? queue.find(q => q.id === activeFileId)?.probe : null}
             options={options}
             setOptions={setOptions}
          />
       </div>
    </div>
  );
}
