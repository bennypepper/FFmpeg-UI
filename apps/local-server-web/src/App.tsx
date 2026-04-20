import React, { useState, useRef, useEffect } from 'react';
import { MediaEditor } from '@ffmpeg-ui/ui';
import type { MediaItem } from '@ffmpeg-ui/ui';
import { buildFFmpegArgs } from '@ffmpeg-ui/core';
import type { CommandOptions } from '@ffmpeg-ui/core';

export default function App() {
  const [capabilities, setCapabilities] = useState<{ has_ffmpeg: boolean; version: string } | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<any>(null);
  const [options, setOptions] = useState<CommandOptions>({ mode: 'convert', fmt: 'mp4', vc: 'libx264', ac: 'aac', hwaccel: 'none' });

  const currentJobId = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch('/capabilities')
      .then(res => res.json())
      .then(data => {
        setCapabilities({ 
          has_ffmpeg: data.ffmpeg_version !== 'unknown',
          version: data.ffmpeg_version
        });
      })
      .catch(err => {
        console.error('Failed to parse capabilities', err);
      });
  }, []);

  const handleUploadFiles = async (files: File[]) => {
    try {
      const newItems: MediaItem[] = [];
      for (const f of files) {
        const formData = new FormData();
        formData.append('file', f);
        
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.stored_name) {
          // The backend expects the path/name exactly as 'stored_name' for further processing
          newItems.push({
            id: data.file_id || Math.random().toString(36).substring(7),
            name: data.original_name || f.name,
            path: data.stored_name,
            probe: data.probe
          });
        }
      }
      
      if (newItems.length > 0) {
        setQueue(q => [...q, ...newItems]);
        if (!activeFileId) setActiveFileId(newItems[0].id);
      }
    } catch (e: any) {
      setTerminalLogs(prev => [...prev.slice(-199), `[Error] ${e.message}`]);
    }
  };

  const handleExecute = async (opts: CommandOptions, activeItem: MediaItem | null, q: MediaItem[]) => {
    if (q.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setIsDone(false);

    try {
      for (const item of q) {
        if (!item.path) continue;

        const args = buildFFmpegArgs({ ...opts, input: item.path });
        setTerminalLogs(prev => [...prev.slice(-199), `[Command] ffmpeg ${args.join(' ')}`]);

        const res = await fetch('/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input_path: item.path,
            mode: opts.mode,
            fmt: opts.fmt,
            args: args
          })
        });
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const jobId = data.job_id;
        currentJobId.current = jobId;

        await new Promise<void>((resolve, reject) => {
          const es = new EventSource(`/progress/${jobId}`);
          eventSourceRef.current = es;

          es.onmessage = (e) => {
            const evData = JSON.parse(e.data);
            if (evData.status === 'started') {
              setTerminalLogs(prev => [...prev.slice(-199), '[Started] Job ' + jobId]);
            } else if (evData.status === 'log' || (evData.status === 'running' && !evData.progress)) {
               if(evData.message) setTerminalLogs(prev => [...prev.slice(-199), '[Log] ' + evData.message]);
            } else if (evData.status === 'running' && evData.progress) {
               setProgress({
                 frame: evData.progress.frame || 0,
                 fps: evData.progress.fps || 0,
                 speed: evData.progress.speed || 1,
                 size_kb: evData.progress.size_kb || 0,
                 time_s: evData.progress.time_s || 0,
                 bitrate_kbps: evData.progress.bitrate_kbps || 0,
                 progress: evData.progress.progress || 0
               });
            } else if (evData.status === 'done') {
               es.close();
               
               // Trigger Download
               const a = document.createElement('a');
               a.href = `/download/${jobId}`;
               a.download = '';
               a.click();
               
               currentJobId.current = null;
               resolve();
            } else if (evData.status === 'error') {
               es.close();
               setTerminalLogs(prev => [...prev.slice(-199), '[Error] ' + evData.message]);
               reject(new Error(evData.message));
            }
          };

          es.onerror = () => {
            es.close();
            reject(new Error('Connection lost'));
          };
        });
      }
      setIsDone(true);
    } catch(e: any) {
      setTerminalLogs(prev => [...prev.slice(-199), `[Error] ${e.message}`]);
      setIsDone(false);
    } finally {
      setIsProcessing(false);
      currentJobId.current = null;
    }
  };
  
  const handleCancel = async () => {
      if(currentJobId.current) {
          await fetch('/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `job_id=${currentJobId.current}`
          });
      }
      if(eventSourceRef.current) eventSourceRef.current.close();
      setIsProcessing(false);
      setProgress(null);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
       <div style={{ height: '40px', background: 'var(--bg-panel)', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border-light)' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            FFmpeg UI <span style={{ color: '#007acc', fontSize: '0.8em', marginLeft: '4px' }}>LOCAL-SERVER</span>
          </span>
          {capabilities && (
              <span style={{ fontSize: '0.75rem', opacity: 0.5, pointerEvents: 'none', marginLeft: 'auto' }}>
                {capabilities.has_ffmpeg ? '🟢' : '🔴'} {capabilities.version ? capabilities.version.split('-')[0].trim() : 'Unknown Version'}
              </span>
          )}
       </div>
       <div style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
          <MediaEditor
             capabilities={capabilities}
             onAddFiles={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.onchange = (e) => {
                  const files = Array.from((e.target as HTMLInputElement).files || []);
                  handleUploadFiles(files);
                };
                input.click();
             }}
             onDropFiles={(files) => handleUploadFiles(files)}
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
