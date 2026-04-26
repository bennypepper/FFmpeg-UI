
import { useRef, useState, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';


export type FFmpegStep = 'idle' | 'downloading' | 'initializing' | 'ready' | 'error';

export interface FFmpegState {
  step: FFmpegStep;
  downloadPct: number;
  errorMessage: string | null;
}

export interface UseFFmpegReturn {
  state: FFmpegState;
  isReady: boolean;
  logs: string[];
  progress: EncodingProgress | null;
  retry: () => void;
  exec: (args: string[], inputFile: File, outputName: string) => Promise<Blob>;
  cancel: () => void;
}

export interface EncodingProgress {
  ratio: number;
  timeUs: number;
}


const MAX_LOG_LINES = 200;

const CORE_JS_URL  = '/ffmpeg/ffmpeg-core.js';
const CORE_WASM_URL = '/ffmpeg/ffmpeg-core.wasm';


export function useFFmpeg(): UseFFmpegReturn {
  const ffmpegRef  = useRef<FFmpeg | null>(null);
  const mountedRef = useRef(true);

  const [state, setState] = useState<FFmpegState>({
    step: 'idle',
    downloadPct: 0,
    errorMessage: null,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<EncodingProgress | null>(null);


  const appendLog = useCallback((msg: string) => {
    if (!mountedRef.current) return;
    setLogs(prev => [...prev.slice(-(MAX_LOG_LINES - 1)), msg]);
  }, []);


  const initialize = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;


    if (ffmpegRef.current) {
      try { ffmpegRef.current.terminate(); } catch { /* ignore */ }
    }
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;


    ffmpeg.on('log', ({ message }) => {
      if (!mountedRef.current) return;
      appendLog(message);
    });

    ffmpeg.on('progress', ({ progress: ratio, time }) => {
      if (!mountedRef.current) return;
      setProgress({ ratio, timeUs: time });
    });


    setState({ step: 'downloading', downloadPct: 0, errorMessage: null });
    appendLog('[FFmpeg] Fetching WASM binary from /public/ffmpeg/…');


    try {
      await preloadWithProgress(CORE_WASM_URL, (pct) => {
        if (mountedRef.current) {
          setState(s => ({ ...s, downloadPct: pct }));
        }
      });
    } catch (downloadErr) {

      appendLog(`[FFmpeg] Pre-load warning: ${downloadErr}`);
    }


    if (!mountedRef.current) return;
    setState({ step: 'initializing', downloadPct: 100, errorMessage: null });
    appendLog('[FFmpeg] Compiling WASM and initializing engine…');

    const t0 = performance.now();


    await ffmpeg.load({
      coreURL:  CORE_JS_URL,
      wasmURL:  CORE_WASM_URL,
    });

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    appendLog(`[FFmpeg] ✅ Ready in ${elapsed}s`);

    if (mountedRef.current) {
      setState({ step: 'ready', downloadPct: 100, errorMessage: null });
    }
  }, [appendLog]);


  useEffect(() => {
    mountedRef.current = true;

    initialize().catch(err => {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useFFmpeg] Initialization failed:', err);
      appendLog(`[FFmpeg] ❌ Load failed: ${msg}`);
      setState({ step: 'error', downloadPct: 0, errorMessage: msg });
    });

    return () => {
      mountedRef.current = false;
      try { ffmpegRef.current?.terminate(); } catch { /* ignore */ }
    };
  }, []);


  const retry = useCallback(() => {
    setState({ step: 'idle', downloadPct: 0, errorMessage: null });
    setLogs([]);
    setProgress(null);
    initialize().catch(err => {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useFFmpeg] Retry failed:', err);
      appendLog(`[FFmpeg] ❌ Retry failed: ${msg}`);
      setState({ step: 'error', downloadPct: 0, errorMessage: msg });
    });
  }, [initialize, appendLog]);

  const exec = useCallback(async (
    args: string[],
    inputFile: File,
    outputName: string,
  ): Promise<Blob> => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) throw new Error('FFmpeg is not initialized.');

    const inputName = inputFile.name.replace(/\s+/g, '_');
    appendLog(`[FFmpeg] Writing ${inputName} to WASM FS…`);
    await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

    appendLog(`[FFmpeg] Running: ffmpeg ${args.join(' ')}`);
    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(outputName);
    return new Blob([data as Uint8Array], { type: guessMimeType(outputName) });
  }, [appendLog]);

  const cancel = useCallback(() => {
    try { ffmpegRef.current?.terminate(); } catch { /* ignore */ }
    setState({ step: 'idle', downloadPct: 0, errorMessage: null });
    setProgress(null);

    initialize().catch(err => {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setState({ step: 'error', downloadPct: 0, errorMessage: msg });
    });
  }, [initialize]);

  return {
    state,
    isReady: state.step === 'ready',
    logs,
    progress,
    retry,
    exec,
    cancel,
  };
}



async function preloadWithProgress(
  url: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentLength = response.headers.get('Content-Length');
  if (!contentLength || !response.body) {

    await response.arrayBuffer();
    onProgress(100);
    return;
  }

  const total = parseInt(contentLength, 10);
  let received = 0;
  const reader = response.body.getReader();


  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  onProgress(100);
}


function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    gif: 'image/gif',
  };
  return map[ext] ?? 'application/octet-stream';
}
