import { useCallback, useEffect, useRef, useState } from 'react';
import { MediaEditor } from '@ffmpeg-ui/ui';
import type { BatchExecutionItem, BatchStatus, MediaInfo, MediaItem, ProgressInfo } from '@ffmpeg-ui/ui';
import type { CommandOptions } from '@ffmpeg-ui/core';

interface CapabilitiesResponse {
  has_ffmpeg: boolean;
  has_ffprobe?: boolean;
  version: string;
  encoders?: string[];
  hwaccel?: string[];
}

interface AuthTokenResponse {
  token?: string;
}

interface UploadResponse {
  file_id?: string;
  stored_name?: string;
  original_name?: string;
  preview_url?: string;
  probe?: MediaInfo | null;
}

interface JobStartResponse {
  job_id?: string;
  command?: string;
}

interface ProgressEventPayload {
  job_id?: string;
  status?: 'processing' | 'done' | 'error' | 'cancelled';
  progress?: number;
  fps?: number;
  frame?: number;
  size_mb?: number;
  eta_sec?: number;
  done?: boolean;
  error?: string | null;
  output?: string;
}

type StreamOutcome = 'done' | 'cancelled';

const SERVER_UNREACHABLE_MSG =
  'Unable to reach the local Flask server (http://127.0.0.1:5000). Start the local server and reload the page.';

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

function withTokenQuery(url: string, token: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    'X-Local-Token': token,
    ...extra,
  };
}

async function readApiJson<T>(res: Response, fallbackContext: string): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    let detail = `${fallbackContext} (HTTP ${res.status})`;
    if (isJson) {
      try {
        const body = (await res.json()) as { error?: unknown; message?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) {
          detail = body.error;
        } else if (typeof body.message === 'string' && body.message.trim()) {
          detail = body.message;
        }
      } catch {
        // Non-parseable JSON error payload; fall back to HTTP status detail
      }
    } else {
      try {
        const text = (await res.text()).trim();
        if (text && text.length < 240 && !text.startsWith('<')) {
          detail = `${detail}: ${text}`;
        }
      } catch {
        // Ignore body read failure
      }
    }
    throw new Error(detail);
  }

  if (!isJson) {
    throw new Error(`${fallbackContext}: server returned a non-JSON response`);
  }

  return (await res.json()) as T;
}

function buildStructuredConvertOptions(opts: CommandOptions): Record<string, unknown> {
  const { input: _input, output: _output, custom: _custom, ...rest } = opts;
  void _input;
  void _output;
  void _custom;
  return rest;
}

function triggerSingleDownload(jobId: string, token: string): void {
  const anchor = document.createElement('a');
  anchor.href = withTokenQuery(`/download/${encodeURIComponent(jobId)}`, token);
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

async function triggerBatchZipDownload(jobIds: string[], token: string): Promise<void> {
  const res = await fetch('/download-all', {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ job_ids: jobIds }),
  });

  if (!res.ok) {
    await readApiJson<never>(res, 'Failed to download batch ZIP');
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'batch_converted.zip';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export default function App() {
  const [capabilities, setCapabilities] = useState<{ has_ffmpeg: boolean; version: string } | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert',
    fmt: 'mp4',
    vc: 'libx264',
    ac: 'aac',
    hwaccel: 'none',
  });

  const authTokenRef = useRef<string | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const cancelRequestedRef = useRef(false);
  const cancelStreamRef = useRef<(() => void) | null>(null);

  const appendLog = useCallback((line: string) => {
    setTerminalLogs(prev => [...prev.slice(-199), line]);
  }, []);

  const fetchAuthToken = useCallback(async (): Promise<string> => {
    let res: Response;
    try {
      res = await fetch('/auth/token', { cache: 'no-store' });
    } catch {
      throw new Error(SERVER_UNREACHABLE_MSG);
    }

    const data = await readApiJson<AuthTokenResponse>(res, 'Failed to authenticate with local server');
    if (typeof data.token !== 'string' || !data.token.trim()) {
      throw new Error('Local server returned an empty authentication token.');
    }

    authTokenRef.current = data.token;
    return data.token;
  }, []);

  const ensureAuthToken = useCallback(async (): Promise<string> => {
    if (authTokenRef.current) {
      return authTokenRef.current;
    }
    return fetchAuthToken();
  }, [fetchAuthToken]);

  // Bootstrap auth token and server capabilities on mount
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        await fetchAuthToken();
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = getErrorMessage(err, SERVER_UNREACHABLE_MSG);
          setErrorMessage(msg);
          appendLog(`[Error] ${msg}`);
        }
        return;
      }

      try {
        const res = await fetch('/capabilities');
        const data = await readApiJson<CapabilitiesResponse>(res, 'Failed to load server capabilities');
        if (!cancelled) {
          setCapabilities({
            has_ffmpeg: Boolean(data.has_ffmpeg),
            version: data.version || 'unknown',
          });
          if (!data.has_ffmpeg) {
            setErrorMessage('FFmpeg was not detected on the local server PATH. Install FFmpeg and restart the server.');
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = getErrorMessage(err, 'Failed to load FFmpeg capabilities from local server.');
          setErrorMessage(msg);
          appendLog(`[Error] ${msg}`);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [appendLog, fetchAuthToken]);

  // Ensure any active EventSource is closed on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      cancelStreamRef.current = null;
    };
  }, []);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setErrorMessage(null);
      let token: string;
      try {
        token = await ensureAuthToken();
      } catch (err: unknown) {
        const msg = getErrorMessage(err, SERVER_UNREACHABLE_MSG);
        setErrorMessage(msg);
        appendLog(`[Error] ${msg}`);
        return;
      }

      const uploadedItems: MediaItem[] = [];
      const uploadErrors: string[] = [];

      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append('file', file);

          const res = await fetch('/upload', {
            method: 'POST',
            headers: authHeaders(token),
            body: formData,
          });
          const data = await readApiJson<UploadResponse>(res, `Upload failed for "${file.name}"`);

          if (!data.stored_name) {
            throw new Error(`Upload response for "${file.name}" did not include stored_name.`);
          }

          const previewUrl = data.preview_url
            ? withTokenQuery(data.preview_url, token)
            : withTokenQuery(`/uploads/${encodeURIComponent(data.stored_name)}`, token);

          uploadedItems.push({
            id: data.file_id || crypto.randomUUID(),
            name: data.original_name || file.name,
            path: data.stored_name,
            previewUrl,
            probe: data.probe ?? null,
          });
        } catch (err: unknown) {
          const msg = getErrorMessage(err, `Failed to upload "${file.name}"`);
          uploadErrors.push(msg);
          appendLog(`[Error] ${msg}`);
        }
      }

      if (uploadedItems.length > 0) {
        setQueue(prev => [...prev, ...uploadedItems]);
        setActiveFileId(prev => prev ?? uploadedItems[0].id);
      }

      if (uploadErrors.length > 0) {
        setErrorMessage(uploadErrors.join(' | '));
      }
    },
    [appendLog, ensureAuthToken],
  );

  const streamJobProgress = useCallback(
    (jobId: string, token: string): Promise<StreamOutcome> => {
      return new Promise<StreamOutcome>((resolve, reject) => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        const es = new EventSource(withTokenQuery(`/progress/${encodeURIComponent(jobId)}`, token));
        eventSourceRef.current = es;
        let settled = false;

        const finish = (outcome: StreamOutcome | Error) => {
          if (settled) return;
          settled = true;
          es.close();
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
          cancelStreamRef.current = null;
          if (outcome instanceof Error) {
            reject(outcome);
          } else {
            resolve(outcome);
          }
        };

        cancelStreamRef.current = () => {
          finish('cancelled');
        };

        es.onmessage = (event: MessageEvent<string>) => {
          let payload: ProgressEventPayload;
          try {
            payload = JSON.parse(event.data) as ProgressEventPayload;
          } catch {
            appendLog('[Warning] Ignored malformed progress event from server');
            return;
          }

          if (payload.status === 'processing') {
            setProgress({
              percent: typeof payload.progress === 'number' ? payload.progress : 0,
              fps: typeof payload.fps === 'number' ? payload.fps : undefined,
              frame: typeof payload.frame === 'number' ? payload.frame : undefined,
              sizeMb: typeof payload.size_mb === 'number' ? payload.size_mb : undefined,
              etaSec: typeof payload.eta_sec === 'number' ? payload.eta_sec : undefined,
            });
          } else if (payload.status === 'done') {
            setProgress({
              percent: 100,
              fps: typeof payload.fps === 'number' ? payload.fps : undefined,
              frame: typeof payload.frame === 'number' ? payload.frame : undefined,
              sizeMb: typeof payload.size_mb === 'number' ? payload.size_mb : undefined,
              etaSec: 0,
            });
            finish('done');
          } else if (payload.status === 'cancelled') {
            finish('cancelled');
          } else if (payload.status === 'error') {
            const errMsg = payload.error || 'FFmpeg processing failed on local server.';
            finish(new Error(errMsg));
          }
        };

        es.onerror = () => {
          if (cancelRequestedRef.current) {
            finish('cancelled');
            return;
          }
          finish(new Error('Lost connection to local server while streaming progress.'));
        };
      });
    },
    [appendLog],
  );

  const handleExecute = useCallback(
    async (jobs: BatchExecutionItem[], isBatch: boolean) => {
      if (jobs.length === 0 || isProcessing) return;

      cancelRequestedRef.current = false;
      setErrorMessage(null);
      setIsProcessing(true);
      setIsDone(false);
      setProgress({ percent: 0 });
      setBatchStatus(null);

      try {
        const token = await ensureAuthToken();
        const isMerge = jobs[0]?.options.mode === 'merge';

        if (isMerge) {
          const mergeItems = isBatch && jobs.length >= 2 ? jobs.map(j => j.item) : queue;
          if (mergeItems.length < 2) {
            throw new Error('Need at least 2 files in the queue to merge.');
          }
          const missingPath = mergeItems.find(item => !item.path);
          if (missingPath) {
            throw new Error(`File "${missingPath.name}" is missing its uploaded server reference.`);
          }

          setBatchStatus({ current: 1, total: 1, currentName: 'Merged Output' });
          const res = await fetch('/merge', {
            method: 'POST',
            headers: authHeaders(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              files: mergeItems.map(item => ({ stored_name: item.path })),
              output_format: jobs[0].options.fmt || 'mp4',
              force_reencode: false,
            }),
          });
          const data = await readApiJson<JobStartResponse>(res, 'Merge request failed');
          if (!data.job_id) {
            throw new Error('Server did not return a job ID for merge.');
          }
          if (data.command) {
            appendLog(`[Command] ${data.command}`);
          }

          currentJobIdRef.current = data.job_id;
          const outcome = await streamJobProgress(data.job_id, token);
          currentJobIdRef.current = null;

          if (outcome === 'cancelled' || cancelRequestedRef.current) {
            appendLog('[Cancelled] Merge job cancelled.');
            setIsDone(false);
            return;
          }

          triggerSingleDownload(data.job_id, token);
          setIsDone(true);
          return;
        }

        const completedJobIds: string[] = [];

        for (let i = 0; i < jobs.length; i += 1) {
          if (cancelRequestedRef.current) {
            break;
          }

          const { item, options: itemOptions } = jobs[i];
          if (!item.path) {
            throw new Error(`File "${item.name}" is missing its uploaded server reference.`);
          }

          setBatchStatus({
            current: i + 1,
            total: jobs.length,
            currentName: item.name,
          });
          setProgress({ percent: 0 });

          const res = await fetch('/convert', {
            method: 'POST',
            headers: authHeaders(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              stored_name: item.path,
              original_name: item.name,
              options: buildStructuredConvertOptions(itemOptions),
            }),
          });
          const data = await readApiJson<JobStartResponse>(res, `Conversion failed to start for "${item.name}"`);
          if (!data.job_id) {
            throw new Error(`Server did not return a job ID for "${item.name}".`);
          }
          if (data.command) {
            appendLog(`[Command] ${data.command}`);
          }

          currentJobIdRef.current = data.job_id;
          const outcome = await streamJobProgress(data.job_id, token);
          currentJobIdRef.current = null;

          if (outcome === 'cancelled' || cancelRequestedRef.current) {
            appendLog(`[Cancelled] Stopped during "${item.name}".`);
            setIsDone(false);
            return;
          }

          completedJobIds.push(data.job_id);
          appendLog(`[Done] Finished "${item.name}"`);
        }

        if (cancelRequestedRef.current) {
          setIsDone(false);
          return;
        }

        if (completedJobIds.length === 1) {
          triggerSingleDownload(completedJobIds[0], token);
        } else if (completedJobIds.length > 1) {
          appendLog(`[Batch] Downloading ${completedJobIds.length} outputs as batch_converted.zip`);
          await triggerBatchZipDownload(completedJobIds, token);
        }

        if (completedJobIds.length > 0) {
          setIsDone(true);
        }
      } catch (err: unknown) {
        const msg = getErrorMessage(err, 'Conversion failed on local server.');
        setErrorMessage(msg);
        appendLog(`[Error] ${msg}`);
        setIsDone(false);
      } finally {
        currentJobIdRef.current = null;
        setIsProcessing(false);
        setProgress(null);
        setBatchStatus(null);
      }
    },
    [appendLog, ensureAuthToken, isProcessing, queue, streamJobProgress],
  );

  const handleCancel = useCallback(async () => {
    cancelRequestedRef.current = true;
    const jobId = currentJobIdRef.current;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }

    if (jobId) {
      try {
        const token = await ensureAuthToken();
        const res = await fetch('/cancel', {
          method: 'POST',
          headers: authHeaders(token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ job_id: jobId }),
        });
        await readApiJson<{ ok?: boolean }>(res, 'Failed to cancel active job');
      } catch (err: unknown) {
        const msg = getErrorMessage(err, 'Failed to send cancel request to local server.');
        setErrorMessage(msg);
        appendLog(`[Error] ${msg}`);
      }
    }

    currentJobIdRef.current = null;
    setIsProcessing(false);
    setIsDone(false);
    setProgress(null);
    setBatchStatus(null);
  }, [appendLog, ensureAuthToken]);

  const handleOpenFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      const selected = Array.from(target?.files ?? []);
      void handleUploadFiles(selected);
    };
    input.click();
  }, [handleUploadFiles]);

  const activeMediaInfo: MediaInfo | null = activeFileId
    ? queue.find(item => item.id === activeFileId)?.probe ?? null
    : null;

  return (
    <MediaEditor
      capabilities={capabilities}
      onAddFiles={handleOpenFilePicker}
      onDropFiles={files => {
        void handleUploadFiles(files);
      }}
      onExecute={handleExecute}
      onCancel={() => {
        void handleCancel();
      }}
      isProcessing={isProcessing}
      isDone={isDone}
      terminalLogs={terminalLogs}
      progress={progress}
      batchStatus={batchStatus}
      queue={queue}
      setQueue={setQueue}
      activeFileId={activeFileId}
      setActiveFileId={setActiveFileId}
      mediaInfo={activeMediaInfo}
      options={options}
      setOptions={setOptions}
      platform="local-server"
      platformLabel="Local Server"
      errorMessage={errorMessage}
      onDismissError={() => setErrorMessage(null)}
    />
  );
}
