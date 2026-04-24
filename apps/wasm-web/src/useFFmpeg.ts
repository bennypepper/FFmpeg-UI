/**
 * useFFmpeg.ts
 *
 * A robust custom hook that manages the full FFmpeg WASM lifecycle:
 * idle → downloading → initializing → ready (or error at any step).
 *
 * KEY RULE: ffmpeg-core.js and ffmpeg-core.wasm are served from
 * /public/ffmpeg/ (same-origin). We pass those paths DIRECTLY to
 * ffmpeg.load() — we do NOT wrap them in toBlobURL().
 *
 * Why: toBlobURL() re-hosts the file as a blob: URL. When Vite
 * bundles @ffmpeg/ffmpeg its worker runs as an IIFE inside a
 * { type: "module" } Web Worker. Dynamically importing an ESM
 * Emscripten module from a blob: URL in that context strips the
 * proper global scope, causing Emscripten's startup guard
 *   if (typeof WebAssembly !== "object") throw …
 * to fire. Same-origin /public/ paths avoid this entirely.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FFmpegStep =
  | 'idle'
  | 'downloading'   // Vite/browser is streaming the WASM binary
  | 'initializing'  // ffmpeg.load() has been called; WASM is compiling
  | 'ready'
  | 'error';

export interface FFmpegState {
  step: FFmpegStep;
  /** Download progress 0-100, only meaningful during 'downloading' */
  downloadPct: number;
  /** Human-readable error message, only set when step === 'error' */
  errorMessage: string | null;
}

export interface UseFFmpegReturn {
  /** Current lifecycle state */
  state: FFmpegState;
  /** Whether FFmpeg is fully initialised and safe to call exec() */
  isReady: boolean;
  /** Accumulated log lines from ffmpeg.on('log') */
  logs: string[];
  /** Latest encoding progress snapshot */
  progress: EncodingProgress | null;
  /** Manually retry after an error */
  retry: () => void;
  /** Run an FFmpeg command. Returns the output file as a Blob. */
  exec: (args: string[], inputFile: File, outputName: string) => Promise<Blob>;
  /** Abort current execution and reinitialize */
  cancel: () => void;
}

export interface EncodingProgress {
  ratio: number;   // 0-1 fraction of the stream processed
  timeUs: number;  // microseconds of media processed
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max log lines kept in memory to avoid unbounded growth */
const MAX_LOG_LINES = 200;

/** Paths served from /public/ffmpeg/ — same-origin, no CORS, no blob: wrapping needed */
const CORE_JS_URL  = '/ffmpeg/ffmpeg-core.js';
const CORE_WASM_URL = '/ffmpeg/ffmpeg-core.wasm';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFFmpeg(): UseFFmpegReturn {
  const ffmpegRef  = useRef<FFmpeg | null>(null);
  const mountedRef = useRef(true); // guards against setState after unmount

  const [state, setState] = useState<FFmpegState>({
    step: 'idle',
    downloadPct: 0,
    errorMessage: null,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<EncodingProgress | null>(null);

  // Stable helper — never changes reference
  const appendLog = useCallback((msg: string) => {
    if (!mountedRef.current) return;
    setLogs(prev => [...prev.slice(-(MAX_LOG_LINES - 1)), msg]);
  }, []);

  // ---------------------------------------------------------------------------
  // Core initialisation
  // ---------------------------------------------------------------------------

  const initialize = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;

    // Tear down any previous instance cleanly
    if (ffmpegRef.current) {
      try { ffmpegRef.current.terminate(); } catch { /* ignore */ }
    }
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    // Wire up event listeners
    ffmpeg.on('log', ({ message }) => {
      if (!mountedRef.current) return;
      appendLog(message);
    });

    ffmpeg.on('progress', ({ progress: ratio, time }) => {
      if (!mountedRef.current) return;
      setProgress({ ratio, timeUs: time });
    });

    // -------------------------------------------------------------------------
    // State: downloading
    // We set this early so the UI shows progress while the browser
    // fetches the WASM binary. We do NOT use toBlobURL here — the paths
    // below are same-origin /public/ assets and load fine without it.
    // -------------------------------------------------------------------------
    setState({ step: 'downloading', downloadPct: 0, errorMessage: null });
    appendLog('[FFmpeg] Fetching WASM binary from /public/ffmpeg/…');

    // Probe download progress by preloading the WASM separately.
    // ffmpeg.load() will use the browser cache on its own fetch.
    try {
      await preloadWithProgress(CORE_WASM_URL, (pct) => {
        if (mountedRef.current) {
          setState(s => ({ ...s, downloadPct: pct }));
        }
      });
    } catch (downloadErr) {
      // Non-fatal: log and continue — ffmpeg.load() will try again
      appendLog(`[FFmpeg] Pre-load warning: ${downloadErr}`);
    }

    // -------------------------------------------------------------------------
    // State: initializing — ffmpeg.load() compiles WASM + boots worker
    // -------------------------------------------------------------------------
    if (!mountedRef.current) return;
    setState({ step: 'initializing', downloadPct: 100, errorMessage: null });
    appendLog('[FFmpeg] Compiling WASM and initializing engine…');

    const t0 = performance.now();

    // Pass same-origin paths DIRECTLY. No toBlobURL().
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

  // ---------------------------------------------------------------------------
  // Auto-initialise on mount; clean up on unmount
  // ---------------------------------------------------------------------------

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — initialize is stable via useCallback

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

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
    // Reinitialize so the engine is ready again
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch a URL and report integer download progress (0-100). */
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
    // No Content-Length — just drain and report indeterminate
    await response.arrayBuffer();
    onProgress(100);
    return;
  }

  const total = parseInt(contentLength, 10);
  let received = 0;
  const reader = response.body.getReader();

  // Drain and count bytes (browser caches for the subsequent ffmpeg.load() fetch)
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  onProgress(100);
}

/** Crude MIME guesser for FFmpeg output files. */
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
