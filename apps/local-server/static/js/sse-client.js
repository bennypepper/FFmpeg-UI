// sse-client.js — Server-Sent Events client for FFmpeg progress
const SSEClient = (() => {
  let _es = null;
  let _jobId = null;
  const _handlers = {};

  function connect(jobId) {
    disconnect();
    _jobId = jobId;
    _es = new EventSource(`/progress/${jobId}`);

    _es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error && !data.done) {
          _handlers.onError?.(data.error);
          disconnect();
          return;
        }
        _handlers.onProgress?.(data);
        if (data.done) {
          if (data.status === 'done')       _handlers.onComplete?.(data);
          else if (data.status === 'error') _handlers.onError?.(data.error || 'Unknown error');
          else if (data.status === 'cancelled') _handlers.onCancelled?.();
          disconnect();
        }
      } catch (err) {
        console.error('[SSE] parse error', err);
      }
    };

    _es.onerror = () => {
      console.warn('[SSE] connection error');
      _handlers.onError?.('Connection to server lost.');
      disconnect();
    };
  }

  function disconnect() {
    if (_es) { _es.close(); _es = null; }
    _jobId = null;
  }

  function on(event, handler) {
    _handlers[`on${event[0].toUpperCase()}${event.slice(1)}`] = handler;
    return { connect, disconnect, on, get currentJobId() { return _jobId; }, get isConnected() { return !!_es; } };
  }

  return { connect, disconnect, on, get currentJobId() { return _jobId; }, get isConnected() { return !!_es; } };
})();
