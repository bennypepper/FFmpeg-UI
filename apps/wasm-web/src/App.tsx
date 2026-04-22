import { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { MediaEditor } from '@ffmpeg-ui/ui';
import type { MediaItem } from '@ffmpeg-ui/ui';
import { buildFFmpegArgs } from '@ffmpeg-ui/core';
import type { CommandOptions } from '@ffmpeg-ui/core';

export default function App() {
  const ffmpegRef = useRef(new FFmpeg());
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDownloadingEngine, setIsDownloadingEngine] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert', input: '', fmt: 'mp4', vc: 'libx264', ac: 'aac', crf: '23',
  });

  useEffect(() => {
    load();
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

  const load = async () => {
    if (isLoaded || isDownloadingEngine) return;
    setIsDownloadingEngine(true);
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on('log', ({ message }) => {
      setTerminalLogs(prev => [...prev.slice(-199), message]);
    });
    
    ffmpeg.on('progress', ({ progress, time }) => {
      setProgress({
        frame: 0,
        fps: 0,
        speed: 1,
        size_kb: 0,
        time_s: time / 1000000,
        bitrate_kbps: 0,
        fps_ratio: progress
      });
    });
    
    // toBlobURL fetches the file in the main thread (same-origin, no CORP needed)
    // and returns a blob: URL. The ESM module worker can then import() blob URLs
    // freely because they are always same-origin — no COEP/CORP issues.
    const base = window.location.origin + '/ffmpeg';
    const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
    await ffmpeg.load({ coreURL, wasmURL });
    setTerminalLogs(prev => [...prev.slice(-199), `[System] FFmpeg WebAssembly loaded successfully from local source.`]);
    setIsLoaded(true);
    setIsDownloadingEngine(false);
  };

  const handleExecute = async (opts: CommandOptions, activeItem: MediaItem | null, q: MediaItem[]) => {
    if (q.length === 0 || isProcessing) return;

    const ffmpeg = ffmpegRef.current;
    setIsProcessing(true);
    setIsDone(false);

    try {
      for (const item of q) {
        if (!item.file) continue;

        // Write file to WASM FS
        const inName = item.name.replace(/\s+/g, '_');
        await ffmpeg.writeFile(inName, await fetchFile(item.file));

        const ext = inName.lastIndexOf('.') > 0 ? inName.substring(0, inName.lastIndexOf('.')) : inName;
        const outName = ext + '_converted.' + opts.fmt;

        const args = buildFFmpegArgs({ ...opts, input: inName });
        // The core buildFFmpegArgs returns args Array with outName as the last element.
        args[args.length - 1] = outName;

        setTerminalLogs(prev => [...prev.slice(-199), `[Command] ffmpeg ${args.join(' ')}`]);

        await ffmpeg.exec(args);

        // Read result
        const data = await ffmpeg.readFile(outName);
        const blob = new Blob([data as any], { type: 'video/mp4' }); // generic type
        const url = URL.createObjectURL(blob);

        // Trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = outName;
        a.click();
        URL.revokeObjectURL(url);
      }
      setIsDone(true);
    } catch(e) {
      setTerminalLogs(prev => [...prev.slice(-199), `[Error] ${e}`]);
      setIsDone(false);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
       <div style={{ height: '40px', background: 'var(--bg-panel)', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border-light)' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            FFmpeg UI <span style={{ color: '#f7df1e', fontSize: '0.8em', marginLeft: '4px' }}>WEB-ASSEMBLY</span>
          </span>
       </div>
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
             onCancel={() => { ffmpegRef.current.terminate(); setIsProcessing(false); }}
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
