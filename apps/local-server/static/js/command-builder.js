// command-builder.js — Real-time FFmpeg command preview
const CommandBuilder = (() => {
  const _RES  = { '4k':'3840:-2','1080p':'1920:-2','720p':'1280:-2','480p':'854:-2','360p':'640:-2' };
  const _ROT  = { 'cw90':'transpose=1','ccw90':'transpose=2','180':'transpose=2,transpose=2','fliph':'hflip','flipv':'vflip' };
  const _OVL  = { 'tl':'10:10','tr':'W-w-10:10','bl':'10:H-h-10','br':'W-w-10:H-h-10','center':'(W-w)/2:(H-h)/2' };

  function _v(id, def = '') {
    const el = document.getElementById(id);
    if (!el) return def;
    return (el.type === 'checkbox') ? el.checked : (el.value || def);
  }

  function _s() {
    const app = window.App || {};
    const m = app.currentMode || 'convert';
    return {
      mode:     m,
      fmt:      m === 'audio' ? _v('audio-target-format', 'mp3') : _v('output-format', 'mp4'),
      vc:       app.currentCodec || 'libx264',
      ac:       m === 'audio' ? _v('audio-target-format', 'mp3') : _v('audio-codec', 'aac'),
      ab:       m === 'audio' ? _v('audio-panel-bitrate', '128k') : _v('audio-bitrate-select', '128k'),
      crf:      _v('crf-slider', '23'),
      vbr:      _v('video-bitrate', ''),
      tsz:      _v('target-size', ''),
      res:      _v('resolution-select', 'original'),
      ts_start: _v('trim-start', ''),
      ts_end:   _v('trim-end', ''),
      rotate:   app.currentRotate || '',
      speed:    parseFloat(app.currentSpeed || 1.0),
      cropW:    _v('crop-w',''), cropH: _v('crop-h',''),
      cropX:    _v('crop-x','0'), cropY: _v('crop-y','0'),
      deint:    _v('deinterlace', false),
      gray:     _v('grayscale',   false),
      den:      _v('denoise',     false),
      sharp:    _v('sharpen',     false),
      hasWm:    !!app.watermarkStoredName,
      wmPos:    app.watermarkPos     || 'br',
      wmOpa:    app.watermarkOpacity || 0.75,
      hasSub:   !!app.subtitleStoredName,
      subMode:  _v('subtitle-mode', 'burn'),
      sr:       m === 'audio' ? _v('audio-panel-sample-rate', '') : _v('sample-rate', ''),
      ch:       m === 'audio' ? _v('audio-panel-channels', '') : _v('channels', ''),
      vol:      parseFloat(_v('volume-slider', '1.0') || '1.0'),
      norm:     _v('normalize-audio', false),
      noAudio:  _v('remove-audio', false),
      webOpt:   _v('web-optimize', false),
      noMeta:   _v('strip-metadata', false),
      preset:   _v('preset', 'medium'),
      fps:      _v('fps-select', ''),
      tune:     _v('tune', ''),
      pixFmt:   _v('pix-fmt', 'yuv420p'),
      aspect:   _v('aspect', ''),
      threads:  _v('threads', ''),
      hwaccel:  document.querySelector('input[name="hwaccel"]:checked')?.value || 'none',
      custom:   _v('custom-args', ''),
      gFps:     _v('gif-fps', '15'),
      gW:       _v('gif-width', '480'),
      gLoop:    _v('gif-loop', '0'),
      thTime:   _v('thumbnail-time', '00:00:05'),
      thFmt:    _v('thumbnail-format', 'jpg'),
      thQ:      _v('thumbnail-quality', '90'),
    };
  }

  function build(s) {
    if (!s) s = _s();
    const input = window.App?.currentFile?.originalName || 'input.mp4';
    const stem  = input.replace(/\.[^.]+$/, '');

    if (s.mode === 'thumbnail') {
      return `ffmpeg -ss ${s.thTime} -i "${input}" -vframes 1 "${stem}.${s.thFmt}"`;
    }
    if (s.mode === 'audio') {
      const codecMap = { mp3:'libmp3lame', aac:'aac', flac:'flac', wav:'pcm_s16le', ogg:'libvorbis', m4a:'aac' };
      const ac = codecMap[s.ac] || 'aac';
      let cmd = `ffmpeg -i "${input}" -vn`;
      if (ac === 'copy') cmd += ` -c:a copy`;
      else {
          cmd += ` -c:a ${ac}`;
          if (ac !== 'flac' && ac !== 'pcm_s16le') cmd += ` -b:a ${s.ab}`;
      }
      if (s.sr) cmd += ` -ar ${s.sr}`;
      if (s.ch) cmd += ` -ac ${s.ch}`;
      cmd += ` "${stem}.${s.fmt}"`;
      return cmd;
    }
    if (s.mode === 'remux') {
      return `ffmpeg -i "${input}" -c:v copy -c:a copy "${stem}.${s.fmt}"`;
    }
    if (s.mode === 'merge') {
      const n = window.MergeManager?.files?.length || '?';
      return `# ${n} files\nffmpeg -f concat -safe 0 -i concat.txt -c copy "merged.${s.fmt}"`;
    }
    if (s.fmt === 'gif') {
      return [
        `# Pass 1 — palette`,
        `ffmpeg -i "${input}" -vf "fps=${s.gFps},scale=${s.gW}:-2:flags=lanczos,palettegen" palette.png`,
        `# Pass 2 — encode`,
        `ffmpeg -i "${input}" -i palette.png -vf "fps=${s.gFps},scale=${s.gW}:-2:flags=lanczos,paletteuse" -loop ${s.gLoop} "${stem}.gif"`,
      ].join('\n');
    }

    // CONVERT
    const p = [];
    if (s.ts_start && s.ts_start !== '00:00:00') p.push('-ss', s.ts_start);
    p.push('-i', `"${input}"`);
    if (s.ts_end   && s.ts_end   !== '00:00:00') p.push('-to', s.ts_end);

    const vf = [];
    if (_RES[s.res]) vf.push(`scale=${_RES[s.res]}`);
    else if (s.res?.includes(':') && s.res !== 'original') vf.push(`scale=${s.res}`);
    if (_ROT[s.rotate]) vf.push(_ROT[s.rotate]);
    if (s.speed !== 1.0) vf.push(`setpts=${(1/s.speed).toFixed(4)}*PTS`);
    if (s.cropW && s.cropH) vf.push(`crop=${s.cropW}:${s.cropH}:${s.cropX}:${s.cropY}`);
    if (s.deint) vf.push('yadif');
    if (s.gray)  vf.push('hue=s=0');
    if (s.den)   vf.push('hqdn3d');
    if (s.sharp) vf.push('unsharp=5:5:1.0:5:5:0.0');
    if (s.hasSub && s.subMode === 'burn') vf.push('subtitles=sub.srt');

    if (s.hasWm) {
      const pos = _OVL[s.wmPos] || 'W-w-10:H-h-10';
      const chain = vf.length
        ? `[0:v]${vf.join(',')}[base];[1:v]colorchannelmixer=aa=${s.wmOpa}[wm];[base][wm]overlay=${pos}`
        : `[1:v]colorchannelmixer=aa=${s.wmOpa}[wm];[0:v][wm]overlay=${pos}`;
      p.push('-filter_complex', `"${chain}"`);
    } else if (vf.length) {
      p.push('-vf', `"${vf.join(',')}"`);
    }

    // Video codec
    const vc = s.vc, hw = s.hwaccel;
    if (vc === 'copy') p.push('-c:v', 'copy');
    else if (hw === 'cuda') p.push('-hwaccel','cuda','-c:v', vc==='libx265'?'hevc_nvenc':'h264_nvenc');
    else if (hw === 'qsv')  p.push('-hwaccel','qsv','-c:v','h264_qsv');
    else {
      p.push('-c:v', vc);
      if (vc === 'libx265')   p.push('-vtag','hvc1');
      if (vc === 'prores_ks') p.push('-profile:v','3');
      if (s.vbr) p.push('-b:v', s.vbr.includes('k') ? s.vbr : s.vbr+'k');
      else if (s.tsz) p.push('-b:v','[calc]','-pass','2');
      else if (!['prores_ks','copy'].includes(vc)) {
        if (['libx264','libx265'].includes(vc)) p.push('-crf', s.crf);
        else if (['libvpx-vp9','libaom-av1'].includes(vc)) p.push('-crf',s.crf,'-b:v','0');
      }
      if (['libx264','libx265'].includes(vc) && hw === 'none') p.push('-preset', s.preset);
      if (s.tune && s.tune !== 'none') p.push('-tune', s.tune);
    }

    if (s.fps && s.fps !== 'original') p.push('-r', s.fps);
    if (s.pixFmt && vc !== 'copy')     p.push('-pix_fmt', s.pixFmt);
    if (s.aspect && s.aspect !== 'auto') p.push('-aspect', s.aspect);
    if (s.threads && s.threads !== 'auto') p.push('-threads', s.threads);

    if (s.noAudio) {
      p.push('-an');
    } else {
      if (s.ac === 'copy')   p.push('-c:a','copy');
      else if (s.ac === 'flac') p.push('-c:a','flac');
      else                   p.push('-c:a', s.ac, '-b:a', s.ab);
      if (s.sr) p.push('-ar', s.sr);
      if (s.ch) p.push('-ac', s.ch);
      const af = [];
      if (s.vol !== 1.0) af.push(`volume=${s.vol.toFixed(2)}`);
      if (s.norm) af.push('loudnorm');
      if (s.speed !== 1.0) {
        const sp = Math.min(Math.max(s.speed, 0.25), 4.0);
        af.push(sp > 2.0 ? `atempo=2.0,atempo=${(sp/2).toFixed(2)}` : `atempo=${sp.toFixed(2)}`);
      }
      if (af.length) p.push('-filter:a', `"${af.join(',')}"`);
    }

    if (s.webOpt && s.fmt === 'mp4') p.push('-movflags','+faststart');
    if (s.noMeta) p.push('-map_metadata','-1');
    if (s.custom) p.push(s.custom);
    p.push(`"${stem}.${s.fmt}"`);

    return 'ffmpeg ' + p.join(' ');
  }

  function update() {
    const el = document.getElementById('command-preview-text');
    if (el) el.textContent = build();
  }

  function init() {
    const ids = ['output-format','crf-slider','video-bitrate','audio-bitrate-select',
      'resolution-select','target-size','trim-start','trim-end','crop-w','crop-h','crop-x','crop-y',
      'deinterlace','grayscale','denoise','sharpen','audio-codec','sample-rate','channels',
      'volume-slider','normalize-audio','remove-audio','subtitle-mode','web-optimize',
      'strip-metadata','preset','fps-select','tune','pix-fmt','aspect','threads','custom-args',
      'gif-fps','gif-width','gif-loop','thumbnail-time','thumbnail-format','thumbnail-quality',
      'audio-target-format','audio-panel-bitrate','audio-panel-channels','audio-panel-sample-rate'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('input', update); el.addEventListener('change', update); }
    });
    document.querySelectorAll('input[name="hwaccel"]').forEach(el => el.addEventListener('change', update));
    ['modeChanged','rotateChanged','speedChanged','codecChanged','watermarkChanged','subtitleChanged']
      .forEach(ev => document.addEventListener(ev, update));
  }

  return { init, update, build };
})();
