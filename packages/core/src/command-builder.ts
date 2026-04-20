import type { CommandOptions } from './types';

const _RES: Record<string, string> = { '4k': '3840:-2', '1080p': '1920:-2', '720p': '1280:-2', '480p': '854:-2', '360p': '640:-2' };
const _ROT: Record<string, string> = { 'cw90': 'transpose=1', 'ccw90': 'transpose=2', '180': 'transpose=2,transpose=2', 'fliph': 'hflip', 'flipv': 'vflip' };
const _OVL: Record<string, string> = { 'tl': '10:10', 'tr': 'W-w-10:10', 'bl': '10:H-h-10', 'br': 'W-w-10:H-h-10', 'center': '(W-w)/2:(H-h)/2' };

/**
 * Builds the array of arguments to be passed to the FFmpeg executable.
 * Returns an array of strings, which is perfectly suited for Tauri `Command` or Node `spawn`.
 */
export function buildFFmpegArgs(opts: CommandOptions): string[] {
  const input = opts.input || '';
  const stem = input.replace(/\.[^.]+$/, '');
  const p: string[] = ['-y']; // always overwrite in automated contexts

  if (!input) return p;

  if (opts.mode === 'thumbnail') {
    p.push('-ss', opts.thTime || '00:00:05');
    p.push('-i', input);
    p.push('-vframes', '1');
    p.push(`${stem}.${opts.thFmt || 'jpg'}`);
    return p;
  }

  if (opts.mode === 'audio') {
    const ac = opts.ac || 'aac';
    p.push('-i', input, '-vn');
    if (ac === 'copy') {
      p.push('-c:a', 'copy');
    } else {
      p.push('-c:a', ac);
      if (ac !== 'flac' && ac !== 'pcm_s16le' && opts.ab) {
        p.push('-b:a', opts.ab);
      }
    }
    if (opts.sr) p.push('-ar', opts.sr);
    if (opts.ch) p.push('-ac', opts.ch);
    p.push(`${stem}.${opts.fmt}`);
    return p;
  }

  if (opts.mode === 'remux') {
    p.push('-i', input, '-c:v', 'copy', '-c:a', 'copy', `${stem}.${opts.fmt}`);
    return p;
  }

  // Note: For 'merge' and 'gif', the array structures map perfectly, 
  // but they might require multi-step executions or concat files, 
  // which limits pure single array mode. We return the first pass for GIF or the merge command.

  if (opts.mode === 'convert') {
    if (opts.ts_start && opts.ts_start !== '00:00:00') p.push('-ss', opts.ts_start);
    p.push('-i', input);
    if (opts.ts_end && opts.ts_end !== '00:00:00') p.push('-to', opts.ts_end);

    const vf: string[] = [];
    if (opts.res && _RES[opts.res]) vf.push(`scale=${_RES[opts.res]}`);
    else if (opts.res?.includes(':') && opts.res !== 'original') vf.push(`scale=${opts.res}`);
    
    if (opts.rotate && _ROT[opts.rotate]) vf.push(_ROT[opts.rotate]);
    if (opts.speed && opts.speed !== 1.0) vf.push(`setpts=${(1 / opts.speed).toFixed(4)}*PTS`);
    if (opts.cropW && opts.cropH) vf.push(`crop=${opts.cropW}:${opts.cropH}:${opts.cropX || '0'}:${opts.cropY || '0'}`);
    if (opts.deint) vf.push('yadif');
    if (opts.gray) vf.push('hue=s=0');
    if (opts.den) vf.push('hqdn3d');
    if (opts.sharp) vf.push('unsharp=5:5:1.0:5:5:0.0');
    
    // Subtitles burn
    if (opts.hasSub && opts.subMode === 'burn' && opts.subPath) {
      // requires exact escaping for native FS paths
      vf.push(`subtitles='${opts.subPath.replace(/\\/g, '/')}'`); 
    }

    if (opts.hasWm && opts.wmPath) {
      // Complex filter needed for watermark
      p.push('-i', opts.wmPath);
      const pos = opts.wmPos ? (_OVL[opts.wmPos] || 'W-w-10:H-h-10') : 'W-w-10:H-h-10';
      const wmOpa = opts.wmOpa || 0.75;
      const chain = vf.length
        ? `[0:v]${vf.join(',')}[base];[1:v]colorchannelmixer=aa=${wmOpa}[wm];[base][wm]overlay=${pos}`
        : `[1:v]colorchannelmixer=aa=${wmOpa}[wm];[0:v][wm]overlay=${pos}`;
      p.push('-filter_complex', chain);
    } else if (vf.length) {
      p.push('-vf', vf.join(','));
    }

    // Video codec
    const vc = opts.vc || 'libx264';
    const hw = opts.hwaccel || 'none';
    if (vc === 'copy') p.push('-c:v', 'copy');
    else if (hw === 'cuda') p.push('-hwaccel', 'cuda', '-c:v', vc === 'libx265' ? 'hevc_nvenc' : 'h264_nvenc');
    else if (hw === 'qsv') p.push('-hwaccel', 'qsv', '-c:v', 'h264_qsv');
    else {
      p.push('-c:v', vc);
      if (vc === 'libx265') p.push('-vtag', 'hvc1');
      if (vc === 'prores_ks') p.push('-profile:v', '3');
      
      if (opts.vbr) {
        p.push('-b:v', opts.vbr.includes('k') ? opts.vbr : opts.vbr + 'k');
      } else if (opts.tsz) {
        p.push('-b:v', '[calc]', '-pass', '2'); // Needs backend handler to resolve calculation
      } else if (!['prores_ks', 'copy'].includes(vc)) {
        if (['libx264', 'libx265'].includes(vc)) p.push('-crf', opts.crf || '23');
        else if (['libvpx-vp9', 'libaom-av1'].includes(vc)) {
          p.push('-crf', opts.crf || '30', '-b:v', '0');
        }
      }
      if (['libx264', 'libx265'].includes(vc) && hw === 'none' && opts.preset) {
        p.push('-preset', opts.preset);
      }
      if (opts.tune && opts.tune !== 'none') p.push('-tune', opts.tune);
    }

    if (opts.fps && opts.fps !== 'original') p.push('-r', opts.fps);
    if (opts.pixFmt && vc !== 'copy') p.push('-pix_fmt', opts.pixFmt);
    if (opts.aspect && opts.aspect !== 'auto') p.push('-aspect', opts.aspect);
    if (opts.threads && opts.threads !== 'auto') p.push('-threads', opts.threads);

    // Audio
    if (opts.noAudio) {
      p.push('-an');
    } else {
      if (opts.ac === 'copy') p.push('-c:a', 'copy');
      else if (opts.ac === 'flac') p.push('-c:a', 'flac');
      else {
        p.push('-c:a', opts.ac || 'aac');
        if (opts.ab) p.push('-b:a', opts.ab);
      }
      if (opts.sr) p.push('-ar', opts.sr);
      if (opts.ch) p.push('-ac', opts.ch);

      const af: string[] = [];
      if (opts.vol && opts.vol !== 1.0) af.push(`volume=${opts.vol.toFixed(2)}`);
      if (opts.norm) af.push('loudnorm');
      if (opts.speed && opts.speed !== 1.0) {
        const sp = Math.min(Math.max(opts.speed, 0.25), 4.0);
        af.push(sp > 2.0 ? `atempo=2.0,atempo=${(sp / 2).toFixed(2)}` : `atempo=${sp.toFixed(2)}`);
      }
      if (af.length) p.push('-filter:a', af.join(','));
    }

    if (opts.webOpt && opts.fmt === 'mp4') p.push('-movflags', '+faststart');
    if (opts.noMeta) p.push('-map_metadata', '-1');
    if (opts.custom) {
      // Split on spaces preserving quotes. For now, simple split.
      p.push(...opts.custom.split(/\s+/));
    }
    p.push(`${stem}.${opts.fmt}`);
    
    return p;
  }

  return p;
}
