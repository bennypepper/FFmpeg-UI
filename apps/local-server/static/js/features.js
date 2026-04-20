// features.js — Preview, Visual Trim, Social Presets, Friendly Errors
// Loaded AFTER app.js so window.App is available.

// ──────────────────────────────────────────────────────────────────────────────
// 1. PREVIEW PANEL
// ──────────────────────────────────────────────────────────────────────────────
const PreviewPanel = (() => {
  const AUDIO_EXTS = new Set(['mp3','aac','wav','flac','ogg','m4a','opus','aiff','wma','ac3']);
  let _currentBlob = null;

  function _isAudioFile(name) {
    return AUDIO_EXTS.has((name.split('.').pop() || '').toLowerCase());
  }

  function loadFile(storedName, originalName) {
    const url  = `/static-upload/${storedName}`;
    const isAu = _isAudioFile(originalName);
    const vid  = document.getElementById('preview-video');
    const aud  = document.getElementById('preview-audio');
    const emp  = document.getElementById('preview-empty');
    const wrap = document.getElementById('preview-player-wrap');
    const lbl  = document.getElementById('preview-filename');

    if (!vid || !aud || !wrap) return;

    // Use the direct Flask serve route (we will add /uploads/<name> route)
    const src = `/uploads/${storedName}`;

    if (isAu) {
      vid.classList.add('hidden'); aud.classList.remove('hidden');
      aud.src = src;
    } else {
      aud.classList.add('hidden'); vid.classList.remove('hidden');
      vid.src = src;
    }
    if (lbl) lbl.textContent = originalName;
    emp?.classList.add('hidden');
    wrap.classList.remove('hidden');

    // Also update the trim player
    TrimPlayer.load(src, originalName);
  }

  function clear() {
    const vid = document.getElementById('preview-video');
    const aud = document.getElementById('preview-audio');
    if (vid) vid.src = '';
    if (aud) aud.src = '';
    document.getElementById('preview-empty')?.classList.remove('hidden');
    document.getElementById('preview-player-wrap')?.classList.add('hidden');
    TrimPlayer.clear();
  }

  // Info / Preview tab switch
  function _initTabs() {
    document.querySelectorAll('.info-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.info-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.infotab;
        document.getElementById('info-subpanel')?.classList.toggle('hidden', tab !== 'info');
        document.getElementById('preview-subpanel')?.classList.toggle('hidden', tab !== 'preview');
      });
    });
  }

  function init() { _initTabs(); }

  return { init, loadFile, clear };
})();


// ──────────────────────────────────────────────────────────────────────────────
// 2. VISUAL TRIM PLAYER
// ──────────────────────────────────────────────────────────────────────────────
const TrimPlayer = (() => {
  let duration = 0;
  let startRatio = 0;
  let endRatio   = 1;
  let dragging   = null;  // 'start' | 'end' | null

  const fmt = secs => {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
    return [h, m, s].map(v => String(v).padStart(2,'0')).join(':');
  };

  function _updateUI() {
    const track = document.getElementById('trim-track');
    const range = document.getElementById('trim-range');
    const hs    = document.getElementById('trim-handle-start');
    const he    = document.getElementById('trim-handle-end');
    if (!track || !range) return;

    hs.style.left  = `${startRatio * 100}%`;
    he.style.left  = `${endRatio   * 100}%`;
    range.style.left  = `${startRatio * 100}%`;
    range.style.width = `${(endRatio - startRatio) * 100}%`;

    const sd = fmt(startRatio * duration);
    const ed = fmt(endRatio   * duration);
    const el = document.getElementById('trim-start-display');
    const er = document.getElementById('trim-end-display');
    if (el) el.textContent = sd;
    if (er) er.textContent = ed;

    // Sync text inputs
    const inStart = document.getElementById('trim-start');
    const inEnd   = document.getElementById('trim-end');
    if (inStart) inStart.value = startRatio > 0    ? sd : '';
    if (inEnd)   inEnd.value   = endRatio < 0.999  ? ed : '';
  }

  function _onTrackEvent(e) {
    const track = document.getElementById('trim-track');
    if (!track || !duration) return;
    const rect  = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    if (dragging === 'start') {
      startRatio = Math.min(ratio, endRatio - 0.01);
    } else if (dragging === 'end') {
      endRatio = Math.max(ratio, startRatio + 0.01);
    }
    _updateUI();

    // Seek video to handle position for live preview
    const vid = document.getElementById('trim-video');
    if (vid) vid.currentTime = (dragging === 'end' ? endRatio : startRatio) * duration;
  }

  function load(src, name) {
    const AUDIO_EXTS = new Set(['mp3','aac','wav','flac','ogg','m4a','opus','aiff','wma','ac3']);
    const isAudio = AUDIO_EXTS.has((name.split('.').pop() || '').toLowerCase());
    const wrap = document.getElementById('trim-player-wrap');
    const noFile = document.getElementById('trim-no-file');

    if (isAudio) {
      // Hide trim player for pure audio (no timeline visual needed)
      if (wrap)   wrap.classList.add('hidden');
      if (noFile) { noFile.textContent = 'Visual trim not available for audio files — use the time inputs below.'; noFile.style.display = 'block'; }
      return;
    }

    const vid = document.getElementById('trim-video');
    if (!vid) return;
    vid.src = src;
    vid.onloadedmetadata = () => {
      duration   = vid.duration || 0;
      startRatio = 0;
      endRatio   = 1;
      if (wrap)   wrap.classList.remove('hidden');
      if (noFile) noFile.style.display = 'none';
      _updateUI();
    };
  }

  function clear() {
    const vid = document.getElementById('trim-video');
    if (vid) vid.src = '';
    duration = 0; startRatio = 0; endRatio = 1;
    document.getElementById('trim-player-wrap')?.classList.add('hidden');
    document.getElementById('trim-no-file') && (document.getElementById('trim-no-file').style.display = '');
  }

  function init() {
    const hs = document.getElementById('trim-handle-start');
    const he = document.getElementById('trim-handle-end');
    const track = document.getElementById('trim-track');

    const startDrag = handle => e => { e.preventDefault(); dragging = handle; };
    hs?.addEventListener('mousedown', startDrag('start'));
    he?.addEventListener('mousedown', startDrag('end'));

    document.addEventListener('mousemove', e => { if (dragging) _onTrackEvent(e); });
    document.addEventListener('mouseup',   ()  => { dragging = null; });

    // Touch support
    hs?.addEventListener('touchstart', e => { dragging = 'start'; }, { passive: true });
    he?.addEventListener('touchstart', e => { dragging = 'end';   }, { passive: true });
    document.addEventListener('touchmove',  e => { if (dragging) _onTrackEvent(e.touches[0]); }, { passive: true });
    document.addEventListener('touchend',   ()  => { dragging = null; });

    // Track time display while video plays
    const vid = document.getElementById('trim-video');
    vid?.addEventListener('timeupdate', () => {
      if (!duration) return;
      const thumb = document.getElementById('trim-thumb');
      const cur   = document.getElementById('trim-current-display');
      const ratio = vid.currentTime / duration;
      if (thumb) thumb.style.left = `${ratio * 100}%`;
      if (cur)   cur.textContent  = fmt(vid.currentTime);
    });

    // Click track to seek
    track?.addEventListener('click', e => {
      if (dragging) return;
      const rect  = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const vid   = document.getElementById('trim-video');
      if (vid && duration) vid.currentTime = ratio * duration;
    });

    // Sync text input → ratios
    document.getElementById('trim-start')?.addEventListener('input', e => {
      const parts = e.target.value.split(':').map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n)) && duration) {
        const secs = parts[0]*3600 + parts[1]*60 + parts[2];
        startRatio = Math.max(0, Math.min(secs / duration, endRatio - 0.01));
        _updateUI();
      }
    });
    document.getElementById('trim-end')?.addEventListener('input', e => {
      const parts = e.target.value.split(':').map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n)) && duration) {
        const secs = parts[0]*3600 + parts[1]*60 + parts[2];
        endRatio = Math.min(1, Math.max(secs / duration, startRatio + 0.01));
        _updateUI();
      }
    });
  }

  return { init, load, clear };
})();


// ──────────────────────────────────────────────────────────────────────────────
// 3. SOCIAL MEDIA PRESETS
// ──────────────────────────────────────────────────────────────────────────────
const Presets = (() => {
  // Each preset is a function that returns settings to apply.
  // Discord calculates target size based on file duration from probe data.
  const PRESETS = {
    tiktok: {
      label: 'TikTok',
      apply: () => ({
        'output-format':    'mp4',
        'resolution-select': 'original',
        'pix-fmt':           'yuv420p',
        'audio-bitrate-select': '128k',
        codec: 'libx264',
        crf: '23',
        preset: 'medium',
        customVf: 'crop=ih*9/16:ih,scale=1080:1920',
        note: 'Crops to 9:16 vertical (1080×1920) for TikTok. Ensure your source has centre content.',
      }),
    },
    'instagram-reel': {
      label: 'Instagram Reel',
      apply: () => ({
        'output-format':    'mp4',
        'resolution-select': 'original',
        'pix-fmt':           'yuv420p',
        'audio-bitrate-select': '128k',
        codec: 'libx264',
        crf: '20',
        preset: 'medium',
        customVf: 'crop=ih*9/16:ih,scale=1080:1920',
        note: 'Crops to 9:16 portrait (1080×1920) recommended for Instagram Reels.',
      }),
    },
    youtube: {
      label: 'YouTube',
      apply: () => ({
        'output-format':    'mp4',
        'resolution-select': '1080p',
        'pix-fmt':           'yuv420p',
        'audio-bitrate-select': '192k',
        codec: 'libx264',
        crf: '18',
        preset: 'slow',
        customVf: '',
        note: 'High quality 1080p with faststart enabled for YouTube.',
      }),
    },
    twitter: {
      label: 'Twitter / X',
      apply: () => ({
        'output-format':    'mp4',
        'resolution-select': '720p',
        'pix-fmt':           'yuv420p',
        'audio-bitrate-select': '128k',
        codec: 'libx264',
        crf: '26',
        preset: 'fast',
        customVf: '',
        note: 'Twitter max upload is 512MB. This targets 720p for broad compatibility.',
      }),
    },
    discord: {
      label: 'Discord <8MB',
      apply: (probeDuration) => {
        // Calculate bitrate to fit in 8MB: (8 * 8 * 1024 kbits) / duration_secs − 128k audio
        const dur      = probeDuration || 60;
        const totalKbps = Math.floor((8 * 8 * 1024) / dur);
        const videoBr  = Math.max(200, totalKbps - 128);
        return {
          'output-format':    'mp4',
          'resolution-select': '480p',
          'pix-fmt':           'yuv420p',
          'audio-bitrate-select': '128k',
          codec: 'libx264',
          crf: '',
          videoBitrate: String(videoBr),
          preset: 'fast',
          customVf: '',
          note: `Calculated video bitrate: ${videoBr} kbps based on ${Math.round(dur)}s duration to stay under 8MB.`,
        };
      },
    },
    whatsapp: {
      label: 'WhatsApp',
      apply: () => ({
        'output-format':    'mp4',
        'resolution-select': '480p',
        'pix-fmt':           'yuv420p',
        'audio-bitrate-select': '96k',
        codec: 'libx264',
        crf: '28',
        preset: 'fast',
        customVf: '',
        note: 'Optimized for WhatsApp: small file size, wide device compatibility.',
      }),
    },
  };

  let _activePreset = null;

  function _applySettings(settings) {
    // Output format
    const fmt = document.getElementById('output-format');
    if (fmt && settings['output-format']) fmt.value = settings['output-format'];

    // Resolution
    const res = document.getElementById('resolution-select');
    if (res && settings['resolution-select']) res.value = settings['resolution-select'];

    // Pixel format
    const pf = document.getElementById('pix-fmt');
    if (pf && settings['pix-fmt']) pf.value = settings['pix-fmt'];

    // Audio bitrate
    const ab = document.getElementById('audio-bitrate-select');
    if (ab && settings['audio-bitrate-select']) ab.value = settings['audio-bitrate-select'];

    // Codec
    if (settings.codec) {
      document.querySelectorAll('.codec-item').forEach(item => {
        const radio = item.querySelector('input[type="radio"]');
        const match = radio?.value === settings.codec;
        item.classList.toggle('active', match);
        if (radio) radio.checked = match;
      });
    }

    // CRF
    const crfSl = document.getElementById('crf-slider');
    const crfVal = document.getElementById('crf-value');
    if (crfSl && settings.crf) {
      crfSl.value = settings.crf;
      if (crfVal) crfVal.textContent = settings.crf;
    }

    // Video bitrate (for Discord)
    const vbr = document.getElementById('video-bitrate');
    if (vbr) vbr.value = settings.videoBitrate || '';

    // Preset (encoder speed)
    const presetEl = document.getElementById('preset');
    if (presetEl && settings.preset) presetEl.value = settings.preset;

    // Custom crop filter
    const customArgs = document.getElementById('custom-args');
    if (customArgs && settings.customVf) {
      customArgs.value = `-vf "${settings.customVf}"`;
    } else if (customArgs && !settings.customVf && _activePreset) {
      // Clear only if previously set by a preset
      customArgs.value = '';
    }

    // Force the command builder refresh
    document.dispatchEvent(new Event('codecChanged'));
    if (window.CommandBuilder) CommandBuilder.update();
  }

  function apply(presetKey) {
    const def = PRESETS[presetKey];
    if (!def) return;

    // Get file duration from current queue probe info
    const probeItem = window.Queue?.items?.find(i => i.probeInfo?.duration);
    const dur = probeItem?.probeInfo?.duration || 0;

    const settings = def.apply(dur);
    _activePreset  = presetKey;
    _applySettings(settings);

    // Show active state
    document.querySelectorAll('.preset-btn[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === presetKey));
    document.getElementById('clear-preset-btn')?.classList.remove('hidden');

    // Show a friendly note — keyed so rapid clicks replace instead of stack
    if (settings.note) App.showAlert('info', `${def.label}: ${settings.note}`, 7000, 'preset-tip');

    // Navigate to quality tab so user can see changes
    App.setTab('quality');
  }

  function clear() {
    _activePreset = null;
    document.querySelectorAll('.preset-btn[data-preset]').forEach(b => b.classList.remove('active'));
    document.getElementById('clear-preset-btn')?.classList.add('hidden');
    // Reset to safe defaults
    const crfSl = document.getElementById('crf-slider');
    if (crfSl) { crfSl.value = '23'; document.getElementById('crf-value').textContent = '23'; }
    const vbr = document.getElementById('video-bitrate');
    if (vbr) vbr.value = '';
    const ca = document.getElementById('custom-args');
    if (ca) ca.value = '';
    if (window.CommandBuilder) CommandBuilder.update();
  }

  function init() {
    document.querySelectorAll('.preset-btn[data-preset]').forEach(btn =>
      btn.addEventListener('click', () => apply(btn.dataset.preset))
    );
    document.getElementById('clear-preset-btn')?.addEventListener('click', clear);

    // Hide presets bar when in audio mode
    document.addEventListener('modeChanged', () => {
      const bar = document.getElementById('presets-bar');
      if (bar) bar.style.display = App.currentMode === 'audio' ? 'none' : '';
    });
  }

  return { init, apply, clear };
})();


// ──────────────────────────────────────────────────────────────────────────────
// 4. FRIENDLY ERROR TRANSLATOR
// ──────────────────────────────────────────────────────────────────────────────
const FriendlyError = (() => {
  const RULES = [
    {
      match: /codec not currently supported in container/i,
      title: 'Codec not supported in this container',
      suggestion: 'Try switching the container format. For example, H.265 works well in MKV or MP4, but not in older formats like AVI or FLV.',
    },
    {
      match: /encoder.*not found|unknown encoder/i,
      title: 'Video codec not installed',
      suggestion: 'This codec is not available in your FFmpeg build. Try H.264 (libx264) which is universally available, or rebuild FFmpeg with the required codec.',
    },
    {
      match: /invalid pixel format|unsupported pixel format/i,
      title: 'Incompatible pixel format',
      suggestion: 'The selected pixel format is not supported by this codec. Switch to yuv420p in the Advanced tab — it is compatible with almost all codecs.',
    },
    {
      match: /no such file|cannot open/i,
      title: 'Source file not found',
      suggestion: 'The uploaded file may have been deleted from the server temp folder. Re-upload the file and try again.',
    },
    {
      match: /invalid data.*while decoding/i,
      title: 'Corrupted source file',
      suggestion: 'The input file appears to be corrupted or truncated. Try re-downloading or verifying the original source file.',
    },
    {
      match: /output file.*already exists|file.*exists/i,
      title: 'Output conflict',
      suggestion: 'An output file already exists at that location. This should resolve itself automatically — try converting again.',
    },
    {
      match: /moov atom not found/i,
      title: 'Incomplete or corrupted MP4',
      suggestion: 'The source MP4 is missing its index (moov atom). This usually means the file was not properly finalized. Try a different file or convert from a known-good source.',
    },
    {
      match: /bitrate.*too low|target.*too small/i,
      title: 'Target file size too small',
      suggestion: 'The target file size you set is too small for the video\'s duration. Increase the target MB or reduce the clip length using trim.',
    },
    {
      match: /height not divisible by 2|width not divisible by 2/i,
      title: 'Odd video dimensions',
      suggestion: 'Your resolution produces an odd pixel width or height. Most codecs require even dimensions. Add a scale filter like scale=1920:1080 in custom args or choose a standard resolution preset.',
    },
  ];

  const GENERIC = {
    title: 'Conversion failed',
    suggestion: 'An unexpected error occurred. Check the raw error below for details, or try a different format or codec combination.',
  };

  function show(rawError) {
    const banner = document.getElementById('ffmpeg-error-banner');
    if (!banner) return;

    const rule = RULES.find(r => r.match.test(rawError)) || GENERIC;

    document.getElementById('feb-title-text').textContent = rule.title;
    document.getElementById('feb-suggestion').textContent = rule.suggestion;
    const detail = document.getElementById('feb-detail');
    if (detail) detail.textContent = rawError?.slice(0, 180) || '';

    banner.classList.add('visible');
  }

  function hide() {
    const banner = document.getElementById('ffmpeg-error-banner');
    if (banner) banner.classList.remove('visible');
  }

  return { show, hide };
})();


// ──────────────────────────────────────────────────────────────────────────────
// Bootstrap — wire everything up once the DOM is ready
// ──────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  PreviewPanel.init();
  TrimPlayer.init();
  Presets.init();

  // Hook into App.uploadFile completion to load preview
  const _origDisplayMediaInfo = App.displayMediaInfo.bind(App);
  // We can intercept via queue item selection in queue.js's selectItem,
  // but simpler: patch the Queue's selectItem to also trigger preview.
  const _origQueueSelectItem = Queue.selectItem.bind(Queue);

  // Override Queue.selectItem to also load preview when user clicks a file
  Queue.selectItem = function(id) {
    _origQueueSelectItem(id);
    const item = Queue.items.find(i => i.id === id);
    if (item?.storedName && item?.originalName) {
      PreviewPanel.loadFile(item.storedName, item.originalName);
    }
  };

  // Hook into file upload completion — first file auto-loads preview
  document.addEventListener('fileUploaded', e => {
    if (e.detail?.storedName && e.detail?.originalName) {
      PreviewPanel.loadFile(e.detail.storedName, e.detail.originalName);
    }
  });

  // Hook friendly error into the SSEClient error handler
  const _origSSEOn = SSEClient.on.bind(SSEClient);
  // Wrap the trackJob error handler by patching App
  const _origTrackJob = App.trackJob?.bind(App);
  if (_origTrackJob) {
    // We piggyback on the existing error alert. Reset banner on new job.
    const origStartConversion = document.getElementById('convert-btn');
    origStartConversion?.addEventListener('click', () => FriendlyError.hide(), true);
  }

  // Listen for global error events emitted by SSEClient
  document.addEventListener('ffmpegError', e => {
    FriendlyError.show(e.detail?.message || '');
  });
});
