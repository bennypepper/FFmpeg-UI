import { useState, useEffect, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Store } from '@tauri-apps/plugin-store';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { MediaEditor } from '@ffmpeg-ui/ui';
import type { MediaItem } from '@ffmpeg-ui/ui';
import { buildFFmpegArgs } from '@ffmpeg-ui/core';
import type { CommandOptions } from '@ffmpeg-ui/core';

interface Capabilities {
  has_ffmpeg: boolean;
  has_ffprobe: boolean;
  version: string;
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

function makeJobId(): string {
  return 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export default function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState<any>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [isDownloadingEngine, setIsDownloadingEngine] = useState(false);
  const currentJobId = useRef<string | null>(null);
  const unlisteners = useRef<UnlistenFn[]>([]);

  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert',
    input: '',
    fmt: 'mp4',
    vc: 'libx264',
    ac: 'aac',
    crf: '23',
  });

  useEffect(() => {
    Store.load('ffmpeg-settings.json').then(s => {
      setStore(s);
      s.get<CommandOptions>('options').then(savedOpts => {
        if (savedOpts) {
          setOptions(savedOpts);
          setTerminalLogs(prev => [...prev.slice(-199), '[System] Loaded settings']);
        }
      });
    }).catch(err => setTerminalLogs(prev => [...prev.slice(-199), '[Warning] Could not load settings store: ' + err]));

    invoke<Capabilities>('get_capabilities')
      .then(res => {
        setCapabilities(res);
        setTerminalLogs(prev => [...prev.slice(-199), '[System] ' + res.version]);
      })
      .catch(err => setTerminalLogs(prev => [...prev.slice(-199), '[Error] ' + err]));

    const setupListeners = async () => {
      const u1 = await listen<ProgressPayload>('progress-update', e => {
        if (e.payload.job_id !== currentJobId.current) return;
        setProgress(e.payload);
      });

      const u2 = await listen<LogPayload>('log-update', e => {
        if (e.payload.job_id !== currentJobId.current) return;
        setTerminalLogs(prev => [...prev.slice(-199), '[' + e.payload.level + '] ' + e.payload.message]);
        
        if (e.payload.level === 'done') {
          setIsProcessing(false);
          setIsDone(true);
          currentJobId.current = null;
          setProgress(null);
          sendNotification({ title: 'FFmpeg UI', body: '✅ Conversion successfully completed!' });
        } else if (e.payload.level === 'error') {
          setIsProcessing(false);
          setIsDone(false);
          currentJobId.current = null;
          setProgress(null);
          sendNotification({ title: 'FFmpeg UI', body: '❌ Conversion failed.' });
        }
      });
      unlisteners.current = [u1, u2];
    };
    setupListeners();

    return () => {
      unlisteners.current.forEach(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (store) store.set('options', options);
  }, [options, store]);

  const fetchMediaInfo = async (path: string) => {
    try {
      const probeJsonStr = await invoke<string>('probe_file', { path });
      const info = JSON.parse(probeJsonStr);
      let merged = { ...info.format };
      
      if (info.streams && info.streams.length > 0) {
        const vStream = info.streams.find((s: any) => s.codec_type === 'video');
        const aStream = info.streams.find((s: any) => s.codec_type === 'audio');
        
        if (vStream) {
          merged.video_codec = vStream.codec_name;
          merged.width = vStream.width;
          merged.height = vStream.height;
          // r_frame_rate is usually a fraction like "30000/1001"
          if (vStream.r_frame_rate) {
             const parts = vStream.r_frame_rate.split('/');
             if (parts.length === 2 && parts[1] !== '0') {
                 merged.fps = parseInt(parts[0]) / parseInt(parts[1]);
             }
          }
        }
        if (aStream) {
          merged.audio_codec = aStream.codec_name;
          merged.sample_rate = aStream.sample_rate;
          merged.channels = aStream.channels;
        }
      }
      setMediaInfo(merged);
    } catch (err) {
      setTerminalLogs(prev => [...prev.slice(-199), '[Warning] ffprobe failed: ' + err]);
      setMediaInfo(null);
    }
  };

  useEffect(() => {
    const active = queue.find(q => q.id === activeFileId);
    if (active && active.path) fetchMediaInfo(active.path);
    else setMediaInfo(null);
  }, [activeFileId, queue]);

  const handleExecute = async (opts: CommandOptions, activeItem: MediaItem | null, q: MediaItem[], convertAll: boolean = false) => {
    if (q.length === 0 || isProcessing) return;

    const itemsToProcess = convertAll ? q : (activeItem ? [activeItem] : [q[0]]);
    if (itemsToProcess.length === 0) return;


    const selectedDir = await open({
      directory: true,
      multiple: false,
      title: 'Select Destination Folder'
    });

    if (!selectedDir) return;

    setIsProcessing(true);
    setIsDone(false);


    for (let i = 0; i < itemsToProcess.length; i++) {
      const itemToProcess = itemsToProcess[i];
      if (!itemToProcess.path) continue;


      setActiveFileId(itemToProcess.id);

      const jobId = makeJobId();
      currentJobId.current = jobId;
      setProgress(null);

      const sep = itemToProcess.path.includes('/') ? '/' : '\\';
      const rawName = itemToProcess.path.split(sep).pop() || 'output';
      const nameNoExt = rawName.replace(/\.[^\.]+$/, '');
      

      const outputPath = `${selectedDir}${sep}${nameNoExt}_converted.${opts.fmt}`;

      const ffmpegArgs = buildFFmpegArgs({ ...opts, input: itemToProcess.path });
      ffmpegArgs[ffmpegArgs.length - 1] = outputPath;

      setTerminalLogs(prev => [...prev.slice(-199), `[Command] Processing ${i+1}/${itemsToProcess.length}: ffmpeg ${ffmpegArgs.join(' ')}`]);

      try {
        await invoke('start_convert', {
          params: {
            job_id: jobId,
            input_path: itemToProcess.path,
            output_path: outputPath,
            args: ffmpegArgs,
          },
        });


        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (currentJobId.current !== jobId) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 300);
        });

      } catch (err) {
        setTerminalLogs(prev => [...prev.slice(-199), '[Fatal] ' + err]);
        break;
      }
    }


    setIsProcessing(false);
    setIsDone(true);
    sendNotification({ title: 'FFmpeg UI', body: '✅ All conversions completed successfully!' });
  };

  const handleAddFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Media', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'mp3', 'aac', 'wav', 'flac', 'm4a'] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const newItems = paths.map(p => {
        const sep = p.includes('/') ? '/' : '\\';
        return { id: p, name: p.split(sep).pop() || 'Unknown', path: p, previewUrl: convertFileSrc(p) };
      });
      setQueue(old => [...old, ...newItems]);
      if (!activeFileId && newItems.length > 0) setActiveFileId(newItems[0].id);
    } catch (err) {
      setTerminalLogs(prev => [...prev.slice(-199), '[Error] File dialog error: ' + err]);
    }
  };

  const handleDownloadEngine = async () => {
    try {
      setIsDownloadingEngine(true);
      setTerminalLogs(prev => [...prev.slice(-199), '[System] Downloading engine...']);
      await invoke('download_ffmpeg');
      const res = await invoke<Capabilities>('get_capabilities');
      setCapabilities(res);
      setTerminalLogs(prev => [...prev.slice(-199), '[System] ' + res.version]);
    } catch (err) {
      setTerminalLogs(prev => [...prev.slice(-199), '[Error] Failed to install engine: ' + err]);
    } finally {
      setIsDownloadingEngine(false);
    }
  };

  const showMissingOverlay = capabilities && !capabilities.has_ffmpeg && !isDownloadingEngine;
  const showDownloadingOverlay = isDownloadingEngine;

  return (
    <div style={{ padding: '0', display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)', userSelect: 'none' }}>
      

      <div 
        data-tauri-drag-region 
        style={{ 
          height: '40px', background: 'var(--bg-panel)', display: 'flex', alignItems: 'center', 
          justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid var(--border-light)' 
        }}
      >
        <span data-tauri-drag-region style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', pointerEvents: 'none' }}>
          FFmpeg UI <span style={{ color: 'var(--accent-primary)', fontSize: '0.8em', marginLeft: '4px' }}>NATIVE</span>
        </span>
        {capabilities && (
          <span style={{ fontSize: '0.75rem', opacity: 0.5, pointerEvents: 'none' }}>
            {capabilities.has_ffmpeg ? '🟢' : '🔴'} {capabilities.version.split('-')[0].trim()}
          </span>
        )}
      </div>


      {(showMissingOverlay || showDownloadingOverlay) && (
        <div style={{
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
        }}>
          <div style={{
            background: 'var(--glass, rgba(30,30,30,0.95))',
            border: '1px solid var(--border, #333)',
            borderRadius: '16px',
            padding: '40px 48px',
            maxWidth: '480px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            {showDownloadingOverlay ? (
              <>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏬</div>
                <h2 style={{ color: 'var(--text-1, #f5f5f5)', fontSize: '1.3rem', fontWeight: 700, margin: '0 0 8px' }}>
                  Downloading FFmpeg Core...
                </h2>
                <p style={{ color: 'var(--text-2, #aaa)', fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 20px' }}>
                  Fetching prebuilt FFmpeg binaries. This may take a minute depending on your connection.
                </p>
                <div style={{
                  width: '100%',
                  height: '4px',
                  background: 'var(--border, #333)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  marginBottom: '16px',
                }}>
                  <div style={{
                    width: '100%',
                    height: '100%',
                    background: 'var(--active, #f5f5f5)',
                    borderRadius: '2px',
                    animation: 'downloadPulse 1.5s ease-in-out infinite',
                  }} />
                </div>
                <div style={{
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
                }}>
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
                  FFmpeg is required to process media files but was not detected on this machine. 
                  Click below to automatically download the required binaries.
                </p>
                <button
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
                  ⬇️ Download FFmpeg Core
                </button>
                <p style={{ color: 'var(--text-3, #666)', fontSize: '0.72rem', marginTop: '16px', lineHeight: 1.4 }}>
                  Downloads ~80 MB of prebuilt binaries.
                  <br />Alternatively, install FFmpeg to your system PATH manually.
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

      <div style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
        <MediaEditor
          capabilities={capabilities}
          onAddFiles={handleAddFiles}
          onDropFiles={(files) => {
            const newItems = files.map((f: any) => {
              const p = f.path;
              const sep = p ? (p.includes('/') ? '/' : '\\') : '/';
              return { id: p || Math.random().toString(), name: p ? p.split(sep).pop() : f.name, path: p, file: f, previewUrl: p ? convertFileSrc(p) : URL.createObjectURL(f) };
            });
            setQueue(old => [...old, ...newItems]);
            if (!activeFileId && newItems.length > 0) setActiveFileId(newItems[0].id);
          }}
          onExecute={handleExecute}
          onCancel={async () => {
            if (!currentJobId.current) return;
            await invoke('cancel_job', { jobId: currentJobId.current });
            setTerminalLogs(prev => [...prev.slice(-199), '[Cancelled] Job ' + currentJobId.current + ' cancelled.']);
            setIsProcessing(false);
            currentJobId.current = null;
            setProgress(null);
          }}
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
        />
      </div>
    </div>
  );
}

