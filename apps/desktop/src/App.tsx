import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Store } from '@tauri-apps/plugin-store';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { Button, Dropzone, Select, Slider, TerminalOutput } from '@ffmpeg-ui/ui';
import { buildFFmpegArgs, CommandOptions } from '@ffmpeg-ui/core';

// ─── Types matching Rust payloads ──────────────────────────────────────────
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

// Stable job ID generator
function makeJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);       // native FS path
  const [fileName, setFileName] = useState<string>('');
  const [mediaInfo, setMediaInfo] = useState<any>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [isDownloadingEngine, setIsDownloadingEngine] = useState(false);
  const currentJobId = useRef<string | null>(null);
  const unlisteners = useRef<UnlistenFn[]>([]);

  // FFmpeg encoding options (fed to @ffmpeg-ui/core)
  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert',
    input: '',
    fmt: 'mp4',
    vc: 'libx264',
    ac: 'aac',
    crf: '23',
  });

  // ── Boot: check capabilities & subscribe to Tauri events ────────────────
  useEffect(() => {
    // Init settings store
    Store.load('ffmpeg-settings.json').then(s => {
      setStore(s);
      s.get<CommandOptions>('options').then(savedOpts => {
        if (savedOpts) {
          setOptions(savedOpts);
          addLog('[System] Loaded previous settings');
        }
      });
    }).catch(err => addLog(`[Warning] Could not load settings store: ${err}`));

    invoke<Capabilities>('get_capabilities')
      .then(res => {
        setCapabilities(res);
        addLog(`[System] ${res.version}`);
        if (!res.has_ffmpeg) {
          addLog('[Warning] FFmpeg not found on PATH — install it or bundle it.');
        }
      })
      .catch(err => addLog(`[Error] ${err}`));

    // Subscribe to backend events
    const setupListeners = async () => {
      const unlistenProgress = await listen<ProgressPayload>('progress-update', e => {
        if (e.payload.job_id !== currentJobId.current) return;
        setProgress(e.payload);
        addLog(
          `[Progress] Frame ${e.payload.frame} | ${e.payload.fps.toFixed(1)} fps | ${e.payload.speed.toFixed(1)}x speed`
        );
      });

      const unlistenLog = await listen<LogPayload>('log-update', e => {
        if (e.payload.job_id !== currentJobId.current) return;
        const prefix = e.payload.level === 'error' || e.payload.level === 'warning'
          ? `[${e.payload.level.toUpperCase()}]`
          : `[${e.payload.level}]`;
        addLog(`${prefix} ${e.payload.message}`);
        
        if (e.payload.level === 'done') {
          setIsProcessing(false);
          setIsDone(true);
          currentJobId.current = null;
          setProgress(null);
          
          sendNotification({
            title: 'FFmpeg UI',
            body: '✅ Conversion successfully completed!'
          });
        } else if (e.payload.level === 'error') {
          setIsProcessing(false);
          setIsDone(false);
          currentJobId.current = null;
          setProgress(null);
          
          sendNotification({
            title: 'FFmpeg UI',
            body: '❌ Conversion failed.'
          });
        }
      });

      unlisteners.current = [unlistenProgress, unlistenLog];
    };

    setupListeners();

    // Cleanup listeners on unmount
    return () => {
      unlisteners.current.forEach(fn => fn());
    };
  }, []);

  // ── Auto-save options ────────────────────────────────────────────────────
  useEffect(() => {
    if (store) {
      store.set('options', options);
    }
  }, [options, store]);

  // ── Live command preview whenever options/file change ────────────────────
  useEffect(() => {
    if (fileName) {
      const args = buildFFmpegArgs({ ...options, input: fileName });
      addLog(`[Preview] ffmpeg ${args.join(' ')}`);
    }
  }, [options, fileName]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const addLog = (msg: string) => {
    setTerminalLogs(prev => [...prev.slice(-199), msg]); // keep last 200 lines
  };

  const handleFileDrop = async (selectedFile: File) => {
    // Browsers give us a File object; we need the real FS path for Tauri.
    // Cast to the Tauri-augmented File type which exposes .path
    const nativePath = (selectedFile as any).path as string | undefined;
    if (nativePath) {
      setFilePath(nativePath);
      setFileName(selectedFile.name);
      addLog(`[Loaded] ${nativePath}`);
      await fetchMediaInfo(nativePath);
    } else {
      addLog('[Warning] Could not read native file path — try using the "Open File" button instead.');
    }
  };

  const fetchMediaInfo = async (path: string) => {
    try {
      const probeJsonStr = await invoke<string>('probe_file', { path });
      const info = JSON.parse(probeJsonStr);
      setMediaInfo(info.format || {});
      addLog(`[Media Info] Duration: ${parseFloat(info.format?.duration || '0').toFixed(2)}s | Format: ${info.format?.format_name}`);
    } catch (err) {
      addLog(`[Warning] ffprobe failed: ${err}`);
      setMediaInfo(null);
    }
  };

  const handleOpenDialog = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Media', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'mp3', 'aac', 'wav', 'flac', 'm4a'] }],
      });
      if (typeof selected === 'string') {
        const sep = selected.includes('/') ? '/' : '\\';
        const parts = selected.split(sep);
        setFilePath(selected);
        setFileName(parts[parts.length - 1]);
        addLog(`[Loaded] ${selected}`);
        await fetchMediaInfo(selected);
      }
    } catch (err) {
      addLog(`[Error] File dialog error: ${err}`);
    }
  };

  const handleUpdate = (key: keyof CommandOptions, value: string) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const handleExecute = async () => {
    if (!filePath || isProcessing) return;

    const jobId = makeJobId();
    currentJobId.current = jobId;
    setIsProcessing(true);
    setIsDone(false);
    setProgress(null);

    // Derive output path: same folder, suffixed name
    const sep = filePath.includes('/') ? '/' : '\\';
    const parts = filePath.split(sep);
    const rawName = parts[parts.length - 1];
    const nameNoExt = rawName.replace(/\.[^.]+$/, '');
    parts[parts.length - 1] = `${nameNoExt}_converted.${options.fmt}`;
    const defaultOutputPath = parts.join(sep);

    // Prompt user to select an output location
    const selectedSavePath = await save({
      defaultPath: defaultOutputPath,
      filters: [{ name: 'Media', extensions: [options.fmt] }],
    });

    if (!selectedSavePath) {
      // User cancelled the save dialog
      setIsProcessing(false);
      currentJobId.current = null;
      return;
    }

    // Build the FFmpeg argument list from core
    const ffmpegArgs = buildFFmpegArgs({ ...options, input: filePath });

    addLog(`[Job: ${jobId}] Invoking Rust backend…`);
    addLog(`[Command] ffmpeg -i "${filePath}" ${ffmpegArgs.join(' ')} "${selectedSavePath}" -y`);

    try {
      await invoke('start_convert', {
        params: {
          job_id: jobId,
          input_path: filePath,
          output_path: selectedSavePath,
          args: ffmpegArgs,
        },
      });
    } catch (err) {
      addLog(`[Fatal] ${err}`);
      setIsProcessing(false);
      currentJobId.current = null;
    }
  };

  const handleCancel = async () => {
    if (!currentJobId.current) return;
    await invoke('cancel_job', { jobId: currentJobId.current });
    addLog(`[Cancelled] Job ${currentJobId.current} cancelled.`);
    setIsProcessing(false);
    currentJobId.current = null;
    setProgress(null);
  };

  const handleDownloadEngine = async () => {
    try {
      setIsDownloadingEngine(true);
      addLog('[System] Downloading embedded FFmpeg engine...');
      await invoke('download_ffmpeg');
      addLog('[System] Embedded FFmpeg engine installed successfully!');
      
      // Re-check capabilities
      const res = await invoke<Capabilities>('get_capabilities');
      setCapabilities(res);
      addLog(`[System] ${res.version}`);
    } catch (err) {
      addLog(`[Error] Failed to install engine: ${err}`);
    } finally {
      setIsDownloadingEngine(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>
          FFmpeg UI{' '}
          <span style={{ color: 'var(--accent-primary)', fontSize: '0.45em', verticalAlign: 'middle', letterSpacing: '0.1em' }}>
            TAURI NATIVE
          </span>
        </h1>
        {capabilities && (
          <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>
            {capabilities.has_ffmpeg ? '🟢' : '🔴'} {capabilities.version.slice(0, 40)}
          </span>
        )}
      </header>

      {/* File selection area */}
      {!filePath && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Dropzone onFileSelect={handleFileDrop} accept="video/*, audio/*" />
          <Button variant="ghost" onClick={handleOpenDialog}>
            📂 Open File via Native Dialog
          </Button>
        </div>
      )}

      {/* Main editor UI */}
      {filePath && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '2rem' }}>

          {/* ── Settings column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Encoding Settings</h3>
              <button
                onClick={() => { setFilePath(null); setFileName(''); setMediaInfo(null); setTerminalLogs([]); setIsDone(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, fontSize: '1.1rem' }}
                title="Clear file"
              >✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.8, wordBreak: 'break-all' }}>
                📁 {fileName}
              </p>
              {mediaInfo && (
                <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.5 }}>
                  {Math.round(parseInt(mediaInfo.size, 10) / 1024 / 1024)} MB
                  {mediaInfo.duration ? ` · ${parseFloat(mediaInfo.duration).toFixed(1)}s` : ''}
                  {mediaInfo.bit_rate ? ` · ${Math.round(parseInt(mediaInfo.bit_rate, 10) / 1000)} kbps` : ''}
                </p>
              )}
            </div>

            <Select
              label="Processing Mode"
              value={options.mode}
              onChange={e => handleUpdate('mode', e.target.value)}
              options={[
                { label: 'Convert (Re-encode)', value: 'convert' },
                { label: 'Audio Extract', value: 'audio' },
                { label: 'Remux (Stream Copy)', value: 'remux' },
              ]}
            />

            <Select
              label="Output Format"
              value={options.fmt}
              onChange={e => handleUpdate('fmt', e.target.value)}
              options={[
                { label: 'MP4', value: 'mp4' },
                { label: 'MKV', value: 'mkv' },
                { label: 'WebM', value: 'webm' },
                { label: 'MOV', value: 'mov' },
                { label: 'MP3', value: 'mp3' },
                { label: 'AAC', value: 'aac' },
                { label: 'FLAC', value: 'flac' },
              ]}
            />

            {options.mode !== 'audio' && (
              <Select
                label="Video Codec"
                value={options.vc}
                onChange={e => handleUpdate('vc', e.target.value)}
                options={[
                  { label: 'H.264 — libx264 (software)', value: 'libx264' },
                  { label: 'H.265 — libx265 (HEVC)', value: 'libx265' },
                  { label: 'AV1 — libaom-av1', value: 'libaom-av1' },
                  { label: 'Copy (Lossless)', value: 'copy' },
                  { label: 'NVENC H.264 (GPU)', value: 'h264_nvenc' },
                  { label: 'NVENC H.265 (GPU)', value: 'hevc_nvenc' },
                ]}
              />
            )}

            <Select
              label="Audio Codec"
              value={options.ac}
              onChange={e => handleUpdate('ac', e.target.value)}
              options={[
                { label: 'AAC', value: 'aac' },
                { label: 'MP3 — libmp3lame', value: 'libmp3lame' },
                { label: 'Opus', value: 'libopus' },
                { label: 'FLAC', value: 'flac' },
                { label: 'Copy', value: 'copy' },
              ]}
            />

            {options.mode !== 'remux' && options.vc !== 'copy' && (
              <Slider
                label={`Quality (CRF ${options.crf})`}
                min="0"
                max="51"
                value={options.crf}
                onChange={e => handleUpdate('crf', e.target.value)}
              />
            )}
          </div>

          {/* ── Terminal + controls column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <TerminalOutput logs={terminalLogs} title="FFmpeg Pipeline" />

            {/* Progress bar */}
            {isProcessing && progress && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{
                  height: '6px',
                  borderRadius: '3px',
                  background: 'rgba(255,255,255,0.1)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (progress.fps / 60) * 100)}%`,
                    background: 'var(--accent-primary)',
                    borderRadius: '3px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                  Frame {progress.frame} · {progress.fps.toFixed(1)} fps · {progress.speed.toFixed(2)}x · {progress.size_kb} KB
                </span>
              </div>
            )}

            {/* Success state */}
            {isDone && !isProcessing && (
              <div style={{
                padding: '0.8rem',
                background: 'rgba(22, 163, 74, 0.1)',
                border: '1px solid rgba(22, 163, 74, 0.3)',
                color: 'var(--success)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
                fontSize: '0.9rem',
                fontWeight: 600,
                marginTop: 'auto'
              }}>
                ✅ Encoding Complete!
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginTop: isDone && !isProcessing ? '0.5rem' : 'auto' }}>
              {isProcessing ? (
                <Button fullWidth variant="ghost" onClick={handleCancel}>
                  ⏹ Cancel
                </Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => { setFilePath(null); setFileName(''); setMediaInfo(null); setTerminalLogs([]); setIsDone(false); }}>
                    Clear
                  </Button>
                  {capabilities?.has_ffmpeg ? (
                    <Button
                      fullWidth
                      onClick={handleExecute}
                    >
                      {isDone ? '🔄 Convert Again' : '▶ Start Encode'}
                    </Button>
                  ) : (
                    <Button
                      fullWidth
                      onClick={handleDownloadEngine}
                      disabled={isDownloadingEngine}
                      variant="primary"
                    >
                      {isDownloadingEngine ? '⏳ Downloading Engine...' : '🔧 Install FFmpeg Core'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
