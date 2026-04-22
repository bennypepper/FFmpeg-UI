import { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
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

  const load = async () => {
    setIsDownloadingEngine(true);
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on('log', ({ message }) => {
      setTerminalLogs(prev => [...prev.slice(-199), message]);
    });
    
    ffmpeg.on('progress', ({ progress, time }) => {
      // time is in microseconds, progress is ratio 0-1
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
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      // We don't always need coreURL explicitly if resolving from unpkg works, but good to add.
      // We'll rely on defaults for now or pass simple URLs.
    });
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
                input.onchange = (e) => {
                  const files = Array.from((e.target as HTMLInputElement).files || []);
                  const newItems = files.map((f: any) => ({
                    id: Math.random().toString(),
                    name: f.name,
                    file: f
                  }));
                  setQueue(old => [...old, ...newItems]);
                };
                input.click();
             }}
             onDropFiles={(files) => {
                const newItems = files.map((f: any) => ({
                  id: Math.random().toString(),
                  name: f.name,
                  file: f
                }));
                setQueue(old => [...old, ...newItems]);
             }}
             onExecute={handleExecute}
             onCancel={() => { ffmpegRef.current.terminate(); setIsProcessing(false); }}
             onDownloadEngine={load}
             isDownloadingEngine={isDownloadingEngine}
             isProcessing={isProcessing}
             isDone={isDone}
             terminalLogs={terminalLogs}
             progress={progress}
             queue={queue}
             setQueue={setQueue}
             activeFileId={activeFileId}
             setActiveFileId={setActiveFileId}
             mediaInfo={null} // web doesn't easily ffprobe without running a full pass
             options={options}
             setOptions={setOptions}
          />
       </div>
    </div>
  );
}
