// app.js — Main application controller
// ─────────────────────────────────────────────────────────────────────────────
function formatDuration(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

// ── MergeManager ─────────────────────────────────────────────────────────────
const MergeManager = (() => {
  let files = [];
  let _dragSrc = null;
  let _reencSettings = {};

  function add(f) { files.push(f); _render(); }
  function remove(i) { files.splice(i, 1); _render(); }
  function clear() { files = []; _render(); }

  function _check() {
    if (files.length < 2) { document.getElementById('merge-warning')?.classList.add('hidden'); return; }
    const probes = files.map(f => f.probeInfo || {});
    const maxW = Math.max(...probes.map(p => p.width  || 0));
    const maxH = Math.max(...probes.map(p => p.height || 0));
    const uVc  = [...new Set(probes.map(p => p.video_codec).filter(Boolean))];
    const uFps = [...new Set(probes.map(p => (p.fps || 0).toFixed(2)))];
    const mm   = [];
    files.forEach((f, i) => {
      const p = f.probeInfo || {};
      if (p.width !== maxW || p.height !== maxH)
        mm.push(`"${f.originalName}": ${p.width}×${p.height} (max is ${maxW}×${maxH})`);
    });
    if (uVc.length > 1)  mm.push(`Codec mismatch: ${uVc.join(' vs ')}`);
    if (uFps.length > 1) mm.push(`FPS mismatch: ${uFps.join(', ')} fps`);

    const warnEl = document.getElementById('merge-warning');
    const listEl = document.getElementById('merge-warning-list');
    const recEl  = document.getElementById('merge-rec-res');
    if (!warnEl) return;

    if (mm.length) {
      if (listEl) listEl.innerHTML = mm.map(m => `<li>${m}</li>`).join('');
      if (recEl)  recEl.textContent = `${maxW}×${maxH}, codec: ${uVc[0] || 'libx264'}`;
      warnEl.classList.remove('hidden');
      _reencSettings = { codec_video: uVc[0] || 'libx264', resolution: `${maxW}:${maxH}`, crf: '23' };
    } else {
      warnEl.classList.add('hidden');
    }
  }

  function _render() {
    const c = document.getElementById('merge-file-list');
    if (!c) return;
    if (!files.length) {
      c.innerHTML = '<div class="queue-empty">Add files to merge</div>';
      _check(); CommandBuilder.update(); return;
    }
    c.innerHTML = files.map((f, i) => {
      const p = f.probeInfo || {};
      const info = p.width ? `${p.width}×${p.height} · ${p.video_codec} · ${(p.fps||0).toFixed(2)}fps` : '';
      return `<div class="merge-file-item" data-idx="${i}" draggable="true"
          ondragstart="MergeManager.ds(event,${i})" ondragover="MergeManager.dov(event,${i})"
          ondrop="MergeManager.dp(event,${i})" ondragend="MergeManager.de()">
        <span class="mfi-idx">${i+1}</span>
        <span class="qi-drag"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-grip"/></svg></span>
        <div class="mfi-body">
          <div class="mfi-name" title="${f.originalName}">${f.originalName}</div>
          ${info ? `<div class="mfi-info">${info}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="MergeManager.remove(${i})">✕</button>
      </div>`;
    }).join('');
    _check(); CommandBuilder.update();
  }

  function ds(e, i) { _dragSrc = i; e.dataTransfer.effectAllowed='move'; e.currentTarget.classList.add('dragging-item'); }
  function dov(e, i) { e.preventDefault(); document.querySelectorAll('.merge-file-item').forEach(el => el.classList.remove('drag-over')); document.querySelector(`.merge-file-item[data-idx="${i}"]`)?.classList.add('drag-over'); }
  function dp(e, ti) {
    e.preventDefault(); document.querySelectorAll('.merge-file-item').forEach(el => el.classList.remove('drag-over','dragging-item'));
    if (_dragSrc === null || _dragSrc === ti) return;
    const [item] = files.splice(_dragSrc, 1); files.splice(ti, 0, item);
    _render(); _dragSrc = null;
  }
  function de() { document.querySelectorAll('.merge-file-item').forEach(el => el.classList.remove('drag-over','dragging-item')); }

  async function startMerge() {
    if (files.length < 2) { App.showAlert('error','Add at least 2 files.'); return; }
    const fmt      = document.getElementById('merge-format')?.value || 'mp4';
    const reencode = document.getElementById('merge-force-reencode')?.checked || false;
    const btn = document.getElementById('merge-start-btn');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/merge', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ files: files.map(f=>({stored_name:f.storedName,original_name:f.originalName})),
          output_format: fmt, force_reencode: reencode, reencode_params: _reencSettings })
      });
      const data = await r.json();
      if (data.error) { App.showAlert('error', data.error); return; }
      // Add merge result to queue for tracking
      const qi = Queue.add({ originalName: `merged.${fmt}`, storedName: null, status: 'processing' });
      App.trackJob(data.job_id, qi, fmt);
    } catch(err) { App.showAlert('error', err.message); }
    finally { if (btn) btn.disabled = false; }
  }

  return { get files() { return files; }, add, remove, clear, startMerge, ds, dov, dp, de };
})();

// ── Main App ──────────────────────────────────────────────────────────────────
const App = (() => {
  let currentMode   = 'convert';
  let currentFile   = null;   // { originalName, storedName, probeInfo }
  let currentCodec  = 'libx264';
  let currentRotate = '';
  let currentSpeed  = 1.0;
  let watermarkStoredName = '';
  let watermarkPos        = 'br';
  let watermarkOpacity    = 0.75;
  let subtitleStoredName  = '';
  let capabilities        = {};

  // Expose to window for CommandBuilder and MergeManager
  function _expose() {
    // No-op: getters already expose the current internal state correctly
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    _initTheme();
    try {
      const r = await fetch('/capabilities');
      capabilities = await r.json();
      _applyCapabilities();
    } catch(e) { console.warn('Capabilities unavailable:', e); }

    _setupListeners();
    CommandBuilder.init();
    CommandBuilder.update();
    Queue.render();
    _expose();
  }

  function _applyCapabilities() {
    const verEl = document.getElementById('ffmpeg-version');
    if (verEl) verEl.textContent = `FFmpeg ${capabilities.ffmpeg_version || '?'}`;

    ['cuda','qsv'].forEach(hw => {
      const el = document.getElementById(`hwaccel-${hw}`);
      if (!el) return;
      const avail = capabilities.hwaccel?.includes(hw);
      el.disabled = !avail;
      el.closest('label')?.classList.toggle('cap-disabled', !avail);
    });

    const codecs = { libx264:'codec-h264', libx265:'codec-h265', 'libvpx-vp9':'codec-vp9',
                     'libaom-av1':'codec-av1', prores_ks:'codec-prores' };
    Object.entries(codecs).forEach(([enc, id]) => {
      const badge = document.querySelector(`[data-codec="${id}"] .cap-badge`);
      if (!badge) return;
      const avail = capabilities.encoders?.includes(enc);
      badge.textContent = avail ? 'Available' : 'Not found';
      badge.className   = `cap-badge ${avail ? 'cap-ok' : 'cap-miss'}`;
    });
  }

  // ── Event Listeners ───────────────────────────────────────────────────────
  function _setupListeners() {
    // Drop zone
    const dz = document.getElementById('drop-zone');
    const fi = document.getElementById('file-input');
    dz?.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dz-over'); });
    dz?.addEventListener('dragleave', e => { if (!dz.contains(e.relatedTarget)) dz.classList.remove('dz-over'); });
    dz?.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dz-over'); const fs=[...e.dataTransfer.files]; if(fs.length) handleFiles(fs); });
    fi?.addEventListener('change', e => { if(e.target.files.length) handleFiles([...e.target.files]); e.target.value=''; });
    document.getElementById('add-files-btn')?.addEventListener('click', () => fi?.click());

    // Mode buttons
    document.querySelectorAll('.mode-btn, .seg-btn').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

    // Settings tabs
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => { if (!btn.disabled) setTab(btn.dataset.tab); }));

    // Convert button
    document.getElementById('convert-btn')?.addEventListener('click', startConversion);

    // Cancel
    document.getElementById('cancel-btn')?.addEventListener('click', cancelCurrent);

    // Copy command
    document.getElementById('copy-cmd-btn')?.addEventListener('click', () => {
      const t = document.getElementById('command-preview-text')?.textContent;
      if (t) navigator.clipboard.writeText(t).then(() => showAlert('success','Copied!', 2000));
    });

    // Download all
    document.getElementById('download-all-btn')?.addEventListener('click', () => Queue.downloadAll());

    // Theme
    document.getElementById('theme-toggle')?.addEventListener('click', _toggleTheme);

    // CRF slider
    _bindSliderLabel('crf-slider', 'crf-value', v => v);
    // Volume
    _bindSliderLabel('volume-slider', 'volume-value', v => Math.round(parseFloat(v)*100)+'%');
    // Thumbnail quality
    _bindSliderLabel('thumbnail-quality', 'thumb-q-value', v => v+'%');
    // Watermark opacity
    document.getElementById('opacity-slider')?.addEventListener('input', e => {
      watermarkOpacity = parseFloat(e.target.value);
      document.getElementById('opacity-value').textContent = Math.round(watermarkOpacity*100)+'%';
      _expose(); CommandBuilder.update();
    });
    // GIF fps slider
    _bindSliderLabel('gif-fps-slider', 'gif-fps-value', v => v+' fps');

    // Rotate buttons
    document.querySelectorAll('.rot-btn').forEach(btn => btn.addEventListener('click', () => {
      const v = btn.dataset.rotate;
      currentRotate = currentRotate === v ? '' : v;
      document.querySelectorAll('.rot-btn').forEach(b => b.classList.toggle('active', b.dataset.rotate === currentRotate));
      _expose(); document.dispatchEvent(new Event('rotateChanged'));
    }));

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach(btn => btn.addEventListener('click', () => {
      currentSpeed = parseFloat(btn.dataset.speed);
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', b.dataset.speed === btn.dataset.speed));
      document.getElementById('speed-custom').value = '';
      _expose(); document.dispatchEvent(new Event('speedChanged'));
    }));
    document.getElementById('speed-custom')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) {
        currentSpeed = v;
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        _expose(); document.dispatchEvent(new Event('speedChanged'));
      }
    });

    // Codec radio items
    document.querySelectorAll('.codec-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.codec-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const radio = item.querySelector('input[type="radio"]');
        if (radio) { radio.checked = true; currentCodec = radio.value; }
        _onCodecChange();
        _expose(); document.dispatchEvent(new Event('codecChanged'));
      });
    });

    // Output format
    document.getElementById('output-format')?.addEventListener('change', e => _onFormatChange(e.target.value));

    // Watermark drop
    _bindFileDrop('watermark-drop', 'watermark-input', uploadWatermark);

    // Watermark position
    document.querySelectorAll('.pos-btn').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      watermarkPos = btn.dataset.pos;
      _expose(); CommandBuilder.update();
    }));

    // Subtitle drop
    _bindFileDrop('subtitle-drop', 'subtitle-input', uploadSubtitle);

    // Merge
    const mfi = document.getElementById('merge-file-input');
    mfi?.addEventListener('change', e => { if(e.target.files.length) handleMergeFiles([...e.target.files]); e.target.value=''; });
    document.getElementById('add-merge-file-btn')?.addEventListener('click', () => mfi?.click());
    document.getElementById('merge-start-btn')?.addEventListener('click', () => MergeManager.startMerge());

    // Thumbnail extract
    document.getElementById('thumbnail-extract-btn')?.addEventListener('click', startThumbnailExtract);

    // Remux btn (same as convert, mode is already set)
    document.getElementById('remux-btn')?.addEventListener('click', startConversion);

    // Thumbnail quality slider
    document.getElementById('thumbnail-quality')?.addEventListener('input', e => {
      document.getElementById('thumb-q-value').textContent = e.target.value + '%';
    });

    // GIF fps slider sync to hidden input
    document.getElementById('gif-fps-slider')?.addEventListener('input', e => {
      const v = e.target.value;
      document.getElementById('gif-fps').value = v;
      document.getElementById('gif-fps-value').textContent = v + ' fps';
      CommandBuilder.update();
    });
  }

  function _bindSliderLabel(sliderId, labelId, fmt) {
    const sl = document.getElementById(sliderId), lb = document.getElementById(labelId);
    if (sl && lb) sl.addEventListener('input', () => lb.textContent = fmt(sl.value));
  }

  function _bindFileDrop(dropId, inputId, handler) {
    const drop = document.getElementById(dropId), inp = document.getElementById(inputId);
    if (!drop || !inp) return;
    drop.addEventListener('click', () => inp.click());
    inp.addEventListener('change', e => { if(e.target.files[0]) handler(e.target.files[0]); e.target.value=''; });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dz-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dz-over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dz-over'); if(e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]); });
  }

  // ── Mode ──────────────────────────────────────────────────────────────────
  function setMode(mode) {
    currentMode = mode;
    
    const isAudio = (mode === 'audio');
    document.querySelectorAll('.seg-btn').forEach(b => {
       b.classList.toggle('active', (isAudio && b.dataset.mode === 'audio') || (!isAudio && b.dataset.mode === 'convert'));
    });
    
    const smb = document.getElementById('sub-mode-bar');
    if (smb) smb.classList.toggle('hidden', isAudio);
    
    ['mi-row-res', 'mi-row-vcodec', 'ps-stat-fps', 'ps-stat-frame'].forEach(id => {
       const el = document.getElementById(id);
       if (el) el.style.display = isAudio ? 'none' : '';
    });
    
    // Reset video tool to 'convert' if user clicks Video seg-btn while in audio mode
    if (mode === 'convert' && document.querySelector('.mode-btn[data-mode="convert"]').classList.contains('active') === false) {
       // but we do want convert to be active usually
    }

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    ['settings-container','thumbnail-panel','merge-panel','audio-panel'].forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      const show = (id === 'settings-container' && !['thumbnail','merge','audio'].includes(mode))
                || (id === 'thumbnail-panel' && mode === 'thumbnail')
                || (id === 'merge-panel'     && mode === 'merge')
                || (id === 'audio-panel'     && mode === 'audio');
      el.classList.toggle('hidden', !show);
    });

    const disabledTabs = { quality:['remux'], filters:['remux','audio'], audio:['remux'], advanced:['remux','thumbnail'] };
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const dis = (disabledTabs[btn.dataset.tab] || []).includes(mode);
      btn.disabled = dis; btn.classList.toggle('tab-disabled', dis);
    });

    _updateFormatOptions(mode);
    document.getElementById('action-bar')?.classList.toggle('hidden', ['merge','thumbnail'].includes(mode));
    const btnText = { convert:'▶  Convert', remux:'▶  Remux', audio:'▶  Convert Audio' };
    const cb = document.getElementById('convert-btn');
    if (cb && btnText[mode]) cb.textContent = btnText[mode];

    _expose(); document.dispatchEvent(new Event('modeChanged')); CommandBuilder.update();
  }

  function setTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('hidden', p.dataset.tab !== tab));
  }

  function _updateFormatOptions(mode) {
    const sel = document.getElementById('output-format'); if (!sel) return;
    const audioExts = ['mp3','aac','flac','wav','ogg','m4a','opus','aiff','wma','ac3'];
    sel.querySelectorAll('option').forEach(o => {
      const isAudio = audioExts.includes(o.value);
      o.style.display = mode === 'audio' ? (isAudio?'':'none') : (isAudio?'none':'');
    });
    if (mode === 'audio' && !audioExts.includes(sel.value)) sel.value = 'mp3';
    else if (mode !== 'audio' && audioExts.includes(sel.value)) sel.value = 'mp4';
    _onFormatChange(sel.value);
  }

  function _onFormatChange(fmt) {
    document.getElementById('gif-settings')?.classList.toggle('hidden', fmt !== 'gif');
    const woWrap = document.querySelector('.web-optimize-wrap');
    if (woWrap) woWrap.style.opacity = fmt === 'mp4' ? '1' : '0.4';
    CommandBuilder.update();
  }

  function _onCodecChange() {
    const copy = currentCodec === 'copy';
    ['panel-quality'].forEach(id => {
      document.getElementById(id)?.querySelectorAll('input:not([type=checkbox]),select').forEach(el => el.disabled = copy);
    });
    const presetRow = document.getElementById('preset-row');
    const tuneRow   = document.getElementById('tune-row');
    const showPreset = ['libx264','libx265'].includes(currentCodec);
    if (presetRow) presetRow.style.opacity = showPreset ? '1' : '0.4';
    if (tuneRow)   tuneRow.style.opacity   = showPreset ? '1' : '0.4';
  }

  // ── File Upload ───────────────────────────────────────────────────────────
  async function handleFiles(files) {
    for (const f of files) await uploadFile(f);
  }

  async function uploadFile(file) {
    const upProg = document.getElementById('upload-progress');
    const upBar  = document.getElementById('upload-bar');
    if (upProg) upProg.classList.remove('hidden');

    const qi = Queue.add({ originalName: file.name, storedName: null, status: Queue.STATUS.UPLOADING });

    try {
      const fd = new FormData(); fd.append('file', file);
      const data = await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const pct = (e.loaded/e.total)*100;
            if (upBar) upBar.style.width = pct+'%';
            Queue.updateItem(qi.id, { progress: pct/2 });
          }
        });
        xhr.onload = () => xhr.status === 200 ? res(JSON.parse(xhr.responseText)) : rej(new Error('Upload failed'));
        xhr.onerror = () => rej(new Error('Network error'));
        xhr.open('POST', '/upload'); xhr.send(fd);
      });

      Queue.updateItem(qi.id, { storedName: data.stored_name, originalName: data.original_name,
                                 status: Queue.STATUS.READY, probeInfo: data.probe, progress: 0 });
      qi.storedName = data.stored_name; qi.originalName = data.original_name; qi.probeInfo = data.probe;

      // Dispatch event for PreviewPanel and TrimPlayer
      document.dispatchEvent(new CustomEvent('fileUploaded', {
        detail: { storedName: data.stored_name, originalName: data.original_name, probe: data.probe }
      }));

      if (!currentFile) {
        currentFile = { originalName: data.original_name, storedName: data.stored_name, probeInfo: data.probe };
        if (data.probe) displayMediaInfo(data.original_name, data.probe);
      }
      _expose();
    } catch(err) {
      Queue.updateItem(qi.id, { status: Queue.STATUS.ERROR });
      showAlert('error', `Upload failed: ${err.message}`);
    } finally {
      if (upProg) upProg.classList.add('hidden');
      if (upBar)  upBar.style.width = '0%';
    }
  }

  async function handleMergeFiles(files) {
    for (const f of files) {
      try {
        const fd = new FormData(); fd.append('file', f);
        const r    = await fetch('/upload', { method:'POST', body: fd });
        const data = await r.json();
        MergeManager.add({ storedName: data.stored_name, originalName: data.original_name, probeInfo: data.probe });
      } catch(e) { showAlert('error', `Failed to add ${f.name}`); }
    }
  }

  async function uploadWatermark(file) {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/upload', { method:'POST', body:fd });
    const d = await r.json();
    watermarkStoredName = d.stored_name;
    const drop = document.getElementById('watermark-drop');
    if (drop) { drop.innerHTML = `<span class="has-file-label">✓ ${file.name}</span><input type="file" id="watermark-input" style="display:none">`; }
    _expose(); CommandBuilder.update();
  }

  async function uploadSubtitle(file) {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/upload', { method:'POST', body:fd });
    const d = await r.json();
    subtitleStoredName = d.stored_name;
    const drop = document.getElementById('subtitle-drop');
    if (drop) { drop.innerHTML = `<span class="has-file-label">✓ ${file.name}</span><input type="file" id="subtitle-input" style="display:none">`; }
    _expose(); document.dispatchEvent(new Event('subtitleChanged')); CommandBuilder.update();
  }

  // ── Media Info ────────────────────────────────────────────────────────────
  function displayMediaInfo(name, probe) {
    document.getElementById('mi-empty')?.classList.add('hidden');
    document.getElementById('mi-table')?.classList.remove('hidden');
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v||'—'; };
    set('mi-filename', name);
    set('mi-size',     probe.size_mb     ? `${probe.size_mb} MB` : '—');
    set('mi-res',      probe.width       ? `${probe.width} × ${probe.height} @ ${probe.fps||'?'} fps` : '—');
    set('mi-vcodec',   probe.video_codec);
    set('mi-acodec',   probe.audio_codec ? `${probe.audio_codec} (${probe.channels===1?'mono':'stereo'}, ${probe.sample_rate} Hz)` : '—');
    set('mi-duration', probe.duration    ? formatDuration(probe.duration) : '—');
    set('mi-bitrate',  probe.bitrate_kbps? `${probe.bitrate_kbps.toLocaleString()} kb/s` : '—');
  }

  // ── Conversion ────────────────────────────────────────────────────────────
  function _collectSettings() {
    const v  = id => { const el = document.getElementById(id); return el ? (el.type==='checkbox' ? (el.checked?'true':'false') : (el.value||'')) : ''; };
    const rdo = n => document.querySelector(`input[name="${n}"]:checked`)?.value || '';
    return {
      mode: currentMode,
      output_format: currentMode === 'audio' ? v('audio-target-format') : (v('output-format') || 'mp4'),
      codec_video: currentCodec,
      codec_audio: currentMode === 'audio' ? v('audio-target-format') : (v('audio-codec') || 'aac'),
      crf: v('crf-slider') || '23', video_bitrate: v('video-bitrate'),
      audio_bitrate: currentMode === 'audio' ? v('audio-panel-bitrate') : (v('audio-bitrate-select') || '128k'),
      resolution: v('resolution-select') || 'original', target_size_mb: v('target-size'),
      trim_start: v('trim-start'), trim_end: v('trim-end'),
      rotate: currentRotate, speed: String(currentSpeed),
      crop: (() => { const w=v('crop-w'),h=v('crop-h'),x=v('crop-x')||'0',y=v('crop-y')||'0'; return (w&&h)?`${w}:${h}:${x}:${y}`:''; })(),
      deinterlace: v('deinterlace'), grayscale: v('grayscale'),
      denoise: v('denoise'), sharpen: v('sharpen'),
      watermark_stored_name: watermarkStoredName, watermark_position: watermarkPos,
      watermark_opacity: String(watermarkOpacity),
      subtitle_stored_name: subtitleStoredName, subtitle_mode: rdo('subtitle-mode') || 'burn',
      sample_rate: currentMode === 'audio' ? v('audio-panel-sample-rate') : v('sample-rate'),
      channels: currentMode === 'audio' ? v('audio-panel-channels') : v('channels'),
      volume: v('volume-slider') || '1.0',
      normalize_audio: v('normalize-audio'), remove_audio: v('remove-audio'),
      web_optimize: v('web-optimize'), strip_metadata: v('strip-metadata'),
      preset: v('preset') || 'medium', fps: v('fps-select'),
      tune: v('tune'), pix_fmt: v('pix-fmt') || 'yuv420p',
      aspect: v('aspect'), threads: v('threads'),
      hwaccel: rdo('hwaccel') || 'none', custom_args: v('custom-args'),
      gif_fps: v('gif-fps') || '15', gif_width: v('gif-width') || '480', gif_loop: v('gif-loop') || '0',
      thumbnail_time: v('thumbnail-time') || '00:00:05',
      thumbnail_format: v('thumbnail-format') || 'jpg', thumbnail_quality: v('thumbnail-quality') || '90',
    };
  }

  async function startConversion() {
    if (Queue.hasProcessing()) { showAlert('warning','A conversion is already running.'); return; }
    const item = Queue.getNextReady();
    if (!item) { showAlert('warning','Add files first.'); return; }
    await processQueueItem(item);
  }

  async function processQueueItem(item) {
    if (!item.storedName) { Queue.updateItem(item.id, { status:'error' }); return; }
    const settings = _collectSettings();
    settings.stored_name = item.storedName;
    settings.original_name = item.originalName;

    Queue.updateItem(item.id, { status:'processing', progress:0 });
    document.getElementById('progress-section')?.classList.remove('hidden');
    document.getElementById('cancel-btn')?.classList.remove('hidden');
    _updateProgress(0, 'Starting…');

    const fd = new FormData();
    Object.entries(settings).forEach(([k,v]) => fd.append(k, v));

    try {
      const r    = await fetch('/convert', { method:'POST', body:fd });
      const data = await r.json();
      if (data.error) { Queue.updateItem(item.id, { status:'error' }); showAlert('error', data.error); return; }
      Queue.updateItem(item.id, { jobId: data.job_id });
      item.jobId = data.job_id;
      trackJob(data.job_id, item, settings.output_format);
    } catch(err) {
      Queue.updateItem(item.id, { status:'error' });
      showAlert('error', `Request failed: ${err.message}`);
    }
  }

  function trackJob(jobId, queueItem, outputFmt) {
    SSEClient.on('progress', data => {
      if (queueItem) Queue.updateItem(queueItem.id, { progress: data.progress||0, status:'processing' });
      _updateProgress(data.progress||0, 'Encoding…', data);
    }).on('complete', data => {
      if (queueItem) Queue.updateItem(queueItem.id, { status:'done', progress:100, jobId });
      _updateProgress(100, '✓ Complete');
      document.getElementById('cancel-btn')?.classList.add('hidden');
      showAlert('success', `Done! Click ↓ to download.`);
      setTimeout(() => {
        const next = Queue.getNextReady();
        if (next) processQueueItem(next);
        else if (Queue.allDone()) document.dispatchEvent(new Event('queueDone'));
      }, 800);
    }).on('error', msg => {
      if (queueItem) Queue.updateItem(queueItem.id, { status:'error' });
      showAlert('error', `Error: ${msg}`);
      document.getElementById('cancel-btn')?.classList.add('hidden');
      // Emit for FriendlyError translator
      document.dispatchEvent(new CustomEvent('ffmpegError', { detail: { message: msg } }));
    }).on('cancelled', () => {
      if (queueItem) Queue.updateItem(queueItem.id, { status:'cancelled', progress:0 });
      showAlert('warning','Cancelled.');
      document.getElementById('cancel-btn')?.classList.add('hidden');
    });
    SSEClient.connect(jobId);
  }

  function cancelCurrent() {
    const jobId = SSEClient.currentJobId;
    if (jobId) {
      fetch('/cancel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({job_id:jobId}) });
      // Do not manually disconnect here — the server will instantly kill the process,
      // emit the definitive 'cancelled' status over SSE, and trigger the UI cleanup
      // via the on('cancelled') handler before gracefully closing the connection.
    }
  }

  async function startThumbnailExtract() {
    const item = Queue.items.find(i => i.storedName);
    if (!item) { showAlert('warning','Drop a video file first.'); return; }
    const settings = _collectSettings();
    settings.stored_name   = item.storedName;
    settings.original_name = item.originalName;
    settings.mode          = 'thumbnail';
    settings.output_format = settings.thumbnail_format || 'jpg';
    const btn = document.getElementById('thumbnail-extract-btn');
    if (btn) btn.disabled = true;
    const fd = new FormData();
    Object.entries(settings).forEach(([k,v]) => fd.append(k,v));
    try {
      const r    = await fetch('/convert', { method:'POST', body:fd });
      const data = await r.json();
      if (data.error) { showAlert('error', data.error); return; }
      const iv = setInterval(async () => {
        const st = await fetch(`/job/${data.job_id}`).then(r=>r.json());
        if (st.status === 'done') { clearInterval(iv); window.location.href=`/download/${data.job_id}`; showAlert('success','Frame extracted!'); }
        else if (st.done)        { clearInterval(iv); showAlert('error','Extraction failed.'); }
      }, 500);
    } finally { if (btn) btn.disabled = false; }
  }

  // ── Progress UI ───────────────────────────────────────────────────────────
  function _updateProgress(pct, status, data = {}) {
    const fill = document.getElementById('progress-fill');
    const pctEl = document.getElementById('progress-pct');
    const stEl  = document.getElementById('progress-status-text');
    if (fill)  fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
    if (stEl)  stEl.textContent  = status;
    const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    if (data.eta_sec != null) set('stat-eta',   data.eta_sec > 0 ? `${data.eta_sec}s` : '—');
    if (data.fps     != null) set('stat-fps',   data.fps   > 0 ? data.fps.toFixed(1) : '—');
    if (data.frame   != null) set('stat-frame', data.frame ? data.frame.toLocaleString() : '—');
    if (data.size_mb != null) set('stat-size',  data.size_mb > 0 ? `${data.size_mb} MB` : '—');
  }

  // ── Alerts ────────────────────────────────────────────────────────────────
  const MAX_ALERTS = 3;

  function _dismissAlert(el) {
    if (!el || el._dismissing) return;
    el._dismissing = true;
    el.classList.remove('alert-show');
    setTimeout(() => el.remove(), 300);
  }

  function showAlert(type, message, duration = 4500, key = null) {
    const c = document.getElementById('alert-container'); if (!c) return;
    const iconMap = {
      success: `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-check"/></svg>`,
      error:   `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-x"/></svg>`,
      warning: `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-alert-triangle"/></svg>`,
      info:    `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-info"/></svg>`,
    };

    // If a keyed alert already exists, update it in-place and reset its timer
    if (key) {
      const existing = c.querySelector(`[data-alert-key="${key}"]`);
      if (existing) {
        existing.querySelector('span:last-child').textContent = message;
        clearTimeout(existing._timer);
        if (duration > 0) existing._timer = setTimeout(() => _dismissAlert(existing), duration);
        // Pulse to signal update
        existing.classList.add('alert-pulse');
        setTimeout(() => existing.classList.remove('alert-pulse'), 400);
        return;
      }
    }

    // Enforce max cap — dismiss oldest alert if limit reached
    const current = c.querySelectorAll('.alert');
    if (current.length >= MAX_ALERTS) {
      _dismissAlert(current[0]);
    }

    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    if (key) el.dataset.alertKey = key;
    el.innerHTML = `<span style="flex-shrink:0">${iconMap[type]||iconMap.info}</span><span>${message}</span>`;
    // Click to dismiss
    el.addEventListener('click', () => _dismissAlert(el));
    el.title = 'Click to dismiss';
    el.style.cursor = 'pointer';

    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('alert-show'));
    if (duration > 0) {
      el._timer = setTimeout(() => _dismissAlert(el), duration);
    }
  }

  // ── Theme ─────────────────────────────────────────────────────────────────
  function _initTheme() {
    const t = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const ic = document.getElementById('theme-icon');
    if (ic) ic.textContent = t === 'dark' ? '☀️' : '🌙';
  }
  function _toggleTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') !== 'light';
    root.setAttribute('data-theme', isDark?'light':'dark');
    localStorage.setItem('theme', isDark?'light':'dark');
    const ic = document.getElementById('theme-icon');
    if (ic) ic.textContent = isDark ? '🌙' : '☀️';
  }

  return { init, setMode, setTab, showAlert, displayMediaInfo, trackJob,
           get currentMode() { return currentMode; },
           get currentFile() { return currentFile; },
           get currentCodec() { return currentCodec; },
           get currentRotate() { return currentRotate; },
           get currentSpeed() { return currentSpeed; },
           get watermarkStoredName() { return watermarkStoredName; },
           get watermarkPos() { return watermarkPos; },
           get watermarkOpacity() { return watermarkOpacity; },
           get subtitleStoredName() { return subtitleStoredName; },
         };
})();

document.addEventListener('DOMContentLoaded', () => {
  window.App = App;
  App.init();
  document.addEventListener('queueDone', () => App.showAlert('success','🎉 All conversions complete!'));
});
