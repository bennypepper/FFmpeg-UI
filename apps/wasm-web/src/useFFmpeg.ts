import { useRef, useState, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { ProgressInfo } from '@ffmpeg-ui/ui';

export const WASM_FFMPEG_VERSION = '5.1.4 (WASM)';

export type FFmpegStep = 'idle' | 'loading' | 'ready' | 'error';

export interface FFmpegState {
  step: FFmpegStep;
  errorMessage: string | null;
}

export interface ExecJobParams {
  args: string[];
  inputFile: File;
  vfsInputName: string;
  vfsOutputName: string;
}

export interface UseFFmpegReturn {
  state: FFmpegState;
  isReady: boolean;
  logs: string[];
  progress: ProgressInfo | null;
  appendLog: (msg: string) => void;
  retry: () => void;
  exec: (params: ExecJobParams) => Promise<Blob>;
  cancel: () => void;
}

export class FFmpegCancelledError extends Error {
  constructor(message = 'Conversion cancelled by user.') {
    super(message);
    this.name = 'FFmpegCancelledError';
  }
}

export function isFFmpegCancelledError(err: unknown): err is FFmpegCancelledError {
  return err instanceof FFmpegCancelledError;
}

const MAX_LOG_LINES = 250;
const MAX_STDERR_TAIL = 10;

const CORE_JS_URL = '/ffmpeg/ffmpeg-core.js';
const CORE_WASM_URL = '/ffmpeg/ffmpeg-core.wasm';

const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/opus',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function guessMimeType(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx + 1).toLowerCase() : '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function sanitizeVfsExtension(ext: string | undefined, fallback = 'bin'): string {
  const cleaned = (ext ?? '').replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleaned.length >= 1 && cleaned.length <= 10) {
    return cleaned;
  }
  return fallback;
}

function isWasmCrashError(err: unknown): boolean {
  if (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) {
    return true;
  }
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /RuntimeError|memory access out of bounds|unreachable|table index is out of bounds|out of memory|Aborted\(/i.test(
    text,
  );
}

function formatStderrSummary(lines: string[]): string {
  const meaningful = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && l !== 'Aborted()');
  if (meaningful.length === 0) return '';
  return meaningful.slice(-5).join(' | ');
}

export function useFFmpeg(): UseFFmpegReturn {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const mountedRef = useRef(false);
  const initIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const activeJobStderrRef = useRef<string[] | null>(null);

  const [state, setState] = useState<FFmpegState>({
    step: 'idle',
    errorMessage: null,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);

  const appendLog = useCallback((msg: string) => {
    if (!mountedRef.current) return;
    setLogs(prev => [...prev.slice(-(MAX_LOG_LINES - 1)), msg]);
  }, []);

  const initialize = useCallback(
    async (initId: number, signal?: AbortSignal): Promise<void> => {
      if (!mountedRef.current || signal?.aborted || initId !== initIdRef.current) {
        return;
      }

      if (ffmpegRef.current) {
        try {
          ffmpegRef.current.terminate();
        } catch {
          // ignore termination error on previous worker
        }
        ffmpegRef.current = null;
      }

      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on('log', ({ message }) => {
        if (!mountedRef.current || initId !== initIdRef.current) return;
        appendLog(message);
        if (activeJobStderrRef.current) {
          activeJobStderrRef.current.push(message);
          if (activeJobStderrRef.current.length > MAX_STDERR_TAIL * 4) {
            activeJobStderrRef.current.splice(0, activeJobStderrRef.current.length - MAX_STDERR_TAIL * 2);
          }
        }
      });

      ffmpeg.on('progress', ({ progress: ratio, time }) => {
        if (!mountedRef.current || initId !== initIdRef.current) return;
        const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
        const timeSec = Number.isFinite(time) && time > 0 ? time / 1_000_000 : undefined;
        setProgress({
          percent: Math.round(clamped * 100),
          timeSec,
        });
      });

      setState({ step: 'loading', errorMessage: null });
      appendLog(`[FFmpeg] Loading WebAssembly core (${WASM_FFMPEG_VERSION})…`);

      const t0 = performance.now();

      try {
        await ffmpeg.load({
          coreURL: CORE_JS_URL,
          wasmURL: CORE_WASM_URL,
        });
      } catch (err) {
        try {
          ffmpeg.terminate();
        } catch {
          // ignore
        }
        if (ffmpegRef.current === ffmpeg) {
          ffmpegRef.current = null;
        }
        if (!mountedRef.current || signal?.aborted || initId !== initIdRef.current) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`[FFmpeg] ❌ Load failed: ${msg}`);
        setState({ step: 'error', errorMessage: msg });
        throw err;
      }

      if (!mountedRef.current || signal?.aborted || initId !== initIdRef.current) {
        try {
          ffmpeg.terminate();
        } catch {
          // ignore
        }
        if (ffmpegRef.current === ffmpeg) {
          ffmpegRef.current = null;
        }
        return;
      }

      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      appendLog(`[FFmpeg] ✅ Ready (${WASM_FFMPEG_VERSION}) in ${elapsed}s`);
      setState({ step: 'ready', errorMessage: null });
    },
    [appendLog],
  );

  const startInitialization = useCallback((): Promise<void> => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const initId = ++initIdRef.current;

    const promise = initialize(initId, controller.signal).catch(() => {
      // error state is already recorded inside initialize
    });
    initPromiseRef.current = promise;
    return promise;
  }, [initialize]);

  useEffect(() => {
    mountedRef.current = true;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const initId = ++initIdRef.current;

    // Defer by a macrotask so React 19 <StrictMode> mount/unmount/remount cancels
    // mount #1 cleanly before spawning a Web Worker or fetching the 32 MB WASM binary.
    const timer = window.setTimeout(() => {
      if (controller.signal.aborted || initId !== initIdRef.current || !mountedRef.current) {
        return;
      }
      initPromiseRef.current = initialize(initId, controller.signal).catch(() => {
        // error state handled inside initialize
      });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      mountedRef.current = false;
      initIdRef.current += 1;
      controller.abort();
      activeJobStderrRef.current = null;
      if (ffmpegRef.current) {
        try {
          ffmpegRef.current.terminate();
        } catch {
          // ignore
        }
        ffmpegRef.current = null;
      }
    };
  }, [initialize]);

  const retry = useCallback(() => {
    setLogs([]);
    setProgress(null);
    void startInitialization();
  }, [startInitialization]);

  const cancel = useCallback(() => {
    activeJobStderrRef.current = null;
    setProgress(null);
    appendLog('[FFmpeg] Cancelling active job and restarting worker…');
    void startInitialization();
  }, [appendLog, startInitialization]);

  const exec = useCallback(
    async ({ args, inputFile, vfsInputName, vfsOutputName }: ExecJobParams): Promise<Blob> => {
      if (!ffmpegRef.current && initPromiseRef.current) {
        await initPromiseRef.current;
      }

      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg) {
        throw new Error('FFmpeg WebAssembly engine is not ready.');
      }

      const runInitId = initIdRef.current;
      const stderrLines: string[] = [];
      activeJobStderrRef.current = stderrLines;
      let shouldRecycle = false;

      if (mountedRef.current) {
        setProgress({ percent: 0 });
      }

      try {
        appendLog(`[FFmpeg] Writing ${inputFile.name} → ${vfsInputName}…`);
        await ffmpeg.writeFile(vfsInputName, await fetchFile(inputFile));

        if (runInitId !== initIdRef.current) {
          throw new FFmpegCancelledError();
        }

        appendLog(`[FFmpeg] Running: ffmpeg ${args.join(' ')}`);
        const exitCode = await ffmpeg.exec(args);

        if (runInitId !== initIdRef.current) {
          throw new FFmpegCancelledError();
        }

        if (exitCode !== 0) {
          // Single-threaded @ffmpeg/core can retain dirty static state after a non-zero exit;
          // recycle the worker after cleanup so subsequent jobs never hit stale Emscripten state.
          shouldRecycle = true;
          const tail = formatStderrSummary(stderrLines);
          throw new Error(
            `FFmpeg failed (exit code ${exitCode})${tail ? `: ${tail}` : ''}`,
          );
        }

        const data = await ffmpeg.readFile(vfsOutputName);

        if (runInitId !== initIdRef.current) {
          throw new FFmpegCancelledError();
        }

        const bytes =
          data instanceof Uint8Array
            ? data.buffer instanceof ArrayBuffer
              ? data
              : data.slice()
            : new TextEncoder().encode(data);

        return new Blob([bytes as BlobPart], { type: guessMimeType(vfsOutputName) });
      } catch (err) {
        if (err instanceof FFmpegCancelledError || runInitId !== initIdRef.current) {
          throw new FFmpegCancelledError();
        }

        if (isWasmCrashError(err)) {
          shouldRecycle = true;
          const rawMsg = err instanceof Error ? err.message : String(err);
          const tail = formatStderrSummary(stderrLines);
          appendLog(`[FFmpeg] ⚠️ WASM worker crashed (${rawMsg}); recycling worker…`);
          throw new Error(
            `FFmpeg WebAssembly runtime error (${rawMsg})${tail ? `: ${tail}` : ''}`,
          );
        }

        throw err;
      } finally {
        if (activeJobStderrRef.current === stderrLines) {
          activeJobStderrRef.current = null;
        }
        if (mountedRef.current) {
          setProgress(null);
        }

        if (ffmpegRef.current === ffmpeg && runInitId === initIdRef.current) {
          if (shouldRecycle) {
            // Recycling terminates the worker and destroys its MEMFS immediately.
            void startInitialization();
          } else {
            await ffmpeg.deleteFile(vfsInputName).catch(() => {});
            await ffmpeg.deleteFile(vfsOutputName).catch(() => {});
          }
        }
      }
    },
    [appendLog, startInitialization],
  );

  return {
    state,
    isReady: state.step === 'ready',
    logs,
    progress,
    appendLog,
    retry,
    exec,
    cancel,
  };
}
