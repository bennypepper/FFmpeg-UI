// queue.js — Batch queue with drag-to-reorder
const Queue = (() => {
  let items = [];
  let _nextId = 1;
  let _dragSrcId = null;

  const STATUS = { WAITING:'waiting', UPLOADING:'uploading', READY:'ready',
                   PROCESSING:'processing', DONE:'done', ERROR:'error', CANCELLED:'cancelled' };

  const _ico = (id, extra='') => `<svg class="icon icon-sm ${extra}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const _statusIcon = s => ({
    waiting:    _ico('clock'),
    uploading:  _ico('loader','spin'),
    ready:      _ico('file'),
    processing: _ico('loader','spin'),
    done:       _ico('check-circle','icon-success'),
    error:      _ico('alert-circle','icon-error'),
    cancelled:  _ico('ban'),
  }[s] || _ico('file'));
  const _statusBadge = (s, pct) => {
    if (s === 'processing') return `<span class="badge badge-processing">${Math.round(pct)}%</span>`;
    if (s === 'done')       return `<span class="badge badge-done">Done</span>`;
    if (s === 'error')      return `<span class="badge badge-error">Error</span>`;
    if (s === 'cancelled')  return `<span class="badge badge-cancelled">Cancelled</span>`;
    if (s === 'uploading')  return `<span class="badge badge-processing">Uploading…</span>`;
    return `<span class="badge badge-waiting">Waiting</span>`;
  };

  function _itemActions(item) {
    let h = '';
    if (item.status === 'done' && item.jobId)
      h += `<a href="/download/${item.jobId}" class="btn btn-ghost btn-sm" title="Download" download>${_ico('download')}</a>`;
    if (item.status === 'processing' && item.jobId)
      h += `<button class="btn btn-ghost btn-sm" onclick="Queue.cancelItem(${item.id})" title="Cancel">${_ico('stop')}</button>`;
    if (item.status !== 'processing')
      h += `<button class="btn btn-ghost btn-sm" onclick="Queue.remove(${item.id})" title="Remove">${_ico('x')}</button>`;
    return h;
  }

  function add(fileData) {
    const item = {
      id: _nextId++, filename: fileData.originalName || fileData.filename,
      storedName: fileData.storedName || null, originalName: fileData.originalName,
      status: fileData.status || STATUS.READY, progress: 0,
      jobId: null, probeInfo: fileData.probeInfo || null,
    };
    items.push(item);
    render();
    return item;
  }

  function remove(id) {
    items = items.filter(i => i.id !== id);
    render();
  }

  function updateItem(id, updates) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    Object.assign(item, updates);
    // Optimistic DOM update
    const el = document.querySelector(`.queue-item[data-id="${id}"]`);
    if (!el) { render(); return; }
    if (updates.status !== undefined) {
      const ico = el.querySelector('.qi-status');
      if (ico) ico.innerHTML = _statusIcon(updates.status);
      const sub = el.querySelector('.qi-sub');
      if (sub) sub.innerHTML = _statusBadge(updates.status, updates.progress || 0);
      const act = el.querySelector('.qi-actions');
      if (act) act.innerHTML = _itemActions(item);
    }
    if (updates.progress !== undefined) {
      const bar = el.querySelector('.qi-progress');
      if (bar) bar.style.width = `${updates.progress}%`;
      const sub = el.querySelector('.qi-sub');
      if (sub && (item.status === 'processing' || updates.status === 'processing'))
        sub.innerHTML = _statusBadge('processing', updates.progress);
    }
    _updateFooter();
  }

  // Drag-to-reorder
  function _onDragStart(e, id) {
    _dragSrcId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging-item');
  }
  function _onDragOver(e, id) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('drag-over'));
    document.querySelector(`.queue-item[data-id="${id}"]`)?.classList.add('drag-over');
  }
  function _onDrop(e, targetId) {
    e.preventDefault();
    document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('drag-over','dragging-item'));
    if (_dragSrcId === targetId) return;
    const si = items.findIndex(i => i.id === _dragSrcId);
    const ti = items.findIndex(i => i.id === targetId);
    if (si < 0 || ti < 0) return;
    const [item] = items.splice(si, 1);
    items.splice(ti, 0, item);
    render();
    _dragSrcId = null;
  }
  function _onDragEnd() {
    document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('drag-over','dragging-item'));
  }

  function cancelItem(id) {
    const item = items.find(i => i.id === id);
    if (item?.jobId) {
      fetch('/cancel', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ job_id: item.jobId }) });
    }
  }

  function render() {
    const container = document.getElementById('queue-list');
    if (!container) return;
    if (items.length === 0) {
      container.innerHTML = `<div class="queue-empty">Drop files above to add them to the queue</div>`;
      _updateFooter();
      return;
    }
    container.innerHTML = items.map(item => `
      <div class="queue-item" data-id="${item.id}" draggable="true"
           ondragstart="Queue.dragStart(event,${item.id})"
           ondragover="Queue.dragOver(event,${item.id})"
           ondrop="Queue.dragDrop(event,${item.id})"
           ondragend="Queue.dragEnd()"
           onclick="Queue.selectItem(${item.id})">
        <span class="qi-drag">${_ico('grip')}</span>
        <span class="qi-status">${_statusIcon(item.status)}</span>
        <div class="qi-info">
          <div class="qi-name" title="${item.filename}">${item.filename}</div>
          <div class="qi-sub">${_statusBadge(item.status, item.progress)}</div>
        </div>
        <div class="qi-actions">${_itemActions(item)}</div>
        <div class="qi-progress" style="width:${item.progress}%"></div>
      </div>`).join('');
    _updateFooter();
  }

  function selectItem(id) {
    const item = items.find(i => i.id === id);
    if (item?.probeInfo) {
      window.App?.displayMediaInfo(item.originalName, item.probeInfo);
    }
  }

  function _updateFooter() {
    const done = items.filter(i => i.status === 'done' && i.jobId);
    const dlBtn = document.getElementById('download-all-btn');
    if (dlBtn) dlBtn.style.display = done.length > 1 ? 'inline-flex' : 'none';
    const cnt = document.getElementById('queue-count');
    if (cnt) cnt.textContent = `${items.length} file${items.length !== 1 ? 's' : ''}`;
  }

  function downloadAll() {
    const ids = items.filter(i => i.status === 'done' && i.jobId).map(i => i.jobId);
    if (!ids.length) return;
    fetch('/download-all', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ job_ids: ids }) })
      .then(r => r.blob())
      .then(blob => {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'batch_converted.zip' });
        a.click(); URL.revokeObjectURL(a.href);
      });
  }

  return {
    get items() { return items; },
    add, remove, updateItem, render, downloadAll,
    selectItem, cancelItem,
    dragStart: _onDragStart, dragOver: _onDragOver, dragDrop: _onDrop, dragEnd: _onDragEnd,
    getNextReady:   () => items.find(i => i.status === STATUS.READY || i.status === STATUS.WAITING),
    hasProcessing:  () => items.some(i => i.status === STATUS.PROCESSING),
    allDone:        () => items.length > 0 && items.every(i => ['done','error','cancelled'].includes(i.status)),
    STATUS,
  };
})();
