import React, { useState } from 'react';
import { Select } from './Select';
import { Slider } from './Slider';
import type { CommandOptions } from '@ffmpeg-ui/core';
import {
  X, ChevronDown, ChevronRight,
  Film, Music, Sliders, Cpu, Settings2
} from 'lucide-react';

interface SettingsModalProps {
  fileName: string;
  options: CommandOptions;
  onChange: (opts: CommandOptions) => void;
  onClose: () => void;
}

// ── Accordion ────────────────────────────────────────────────────
function AccordionSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // is-open class drives corner-radius in CSS (no overflow:hidden needed)
    <div className={`modal-accordion ${open ? 'is-open' : ''}`}>
      <button
        className="modal-accordion-header"
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span className="modal-accordion-icon">{icon}</span>
        <span className="modal-accordion-title">{title}</span>
        <span className="modal-accordion-chevron">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {open && (
        <div className="modal-accordion-body">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Compact label helper ──────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      fontSize: '.62rem', fontWeight: 700, letterSpacing: '.07em',
      textTransform: 'uppercase', color: 'var(--text-2)',
      display: 'block', marginBottom: 4,
    }}>
      {children}
    </label>
  );
}

// ── Main Modal ───────────────────────────────────────────────────
export function SettingsModal({ fileName, options, onChange, onClose }: SettingsModalProps) {
  const update = (partial: Partial<CommandOptions>) =>
    onChange({ ...options, ...partial });

  const isVideo = options.mode !== 'audio';
  const canEncode = options.mode === 'convert' || options.mode === 'audio';
  const canFilters = options.mode === 'convert';

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Compact inline select style — overrides global padding
  const cs: React.CSSProperties = { padding: '5px 28px 5px 9px', fontSize: '.76rem' };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-container" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-header-left">
            <Settings2 size={15} style={{ flexShrink: 0, color: 'var(--text-2)' }} />
            <div>
              <div className="modal-title">Configure Settings</div>
              <div className="modal-subtitle" title={fileName}>{fileName}</div>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        {/* ── Pinned top: Mode + Sub-mode + Format ── */}
        <div className="modal-top-row">
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <FieldLabel>Mode</FieldLabel>
              <div className="segment-group" style={{ width: '100%' }}>
                <button
                  style={{ flex: 1, justifyContent: 'center', padding: '5px 10px', fontSize: '.75rem' }}
                  className={`seg-btn ${isVideo ? 'active' : ''}`}
                  onClick={() => update({ mode: 'convert', fmt: 'mp4', vc: 'libx264', ac: 'aac' })}
                >
                  <Film size={11} style={{ marginRight: 4 }} /> Video
                </button>
                <button
                  style={{ flex: 1, justifyContent: 'center', padding: '5px 10px', fontSize: '.75rem' }}
                  className={`seg-btn ${!isVideo ? 'active' : ''}`}
                  onClick={() => update({ mode: 'audio', fmt: 'mp3', vc: undefined as any, ac: 'mp3' })}
                >
                  <Music size={11} style={{ marginRight: 4 }} /> Audio
                </button>
              </div>
            </div>

            {/* Output format */}
            <div style={{ flex: '1 1 120px' }}>
              <FieldLabel>Output Format</FieldLabel>
              <select
                value={options.fmt || ''}
                onChange={e => update({ fmt: e.target.value })}
                style={{ ...cs, width: '100%' }}
              >
                {isVideo
                  ? ['mp4','mkv','webm','avi','mov','gif'].map(v => (
                      <option key={v} value={v}>{v.toUpperCase()}</option>
                    ))
                  : ['mp3','m4a','ogg','wav','flac'].map(v => (
                      <option key={v} value={v}>{v.toUpperCase()}</option>
                    ))
                }
              </select>
            </div>
          </div>

          {/* Sub-mode (video only) */}
          {isVideo && (
            <div>
              <FieldLabel>Sub-Mode</FieldLabel>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['convert', 'remux', 'thumbnail', 'merge'] as const).map(m => (
                  <button
                    key={m}
                    className={`mode-btn ${options.mode === m ? 'active' : ''}`}
                    style={{ flex: 1, minWidth: 'auto', padding: '5px 8px', fontSize: '.70rem' }}
                    onClick={() => update({ mode: m })}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Scrollable Body ── */}
        <div className="modal-body">

          {/* Video Configuration */}
          {isVideo && options.mode !== 'remux' && (
            <AccordionSection title="Video Configuration" icon={<Film size={13} />} defaultOpen>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <FieldLabel>Video Codec</FieldLabel>
                  <select value={options.vc || ''} onChange={e => update({ vc: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="libx264">H.264 (libx264)</option>
                    <option value="libx265">H.265 (libx265)</option>
                    <option value="libvpx-vp9">VP9</option>
                    <option value="copy">Copy (No Re-encode)</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <FieldLabel>Hardware Accel</FieldLabel>
                  <select value={options.hwaccel || 'none'} onChange={e => update({ hwaccel: e.target.value as any })} style={{ ...cs, width: '100%' }}>
                    <option value="none">None / CPU</option>
                    <option value="cuda">NVIDIA (CUDA)</option>
                    <option value="qsv">Intel (QSV)</option>
                  </select>
                </div>
              </div>
            </AccordionSection>
          )}

          {/* Quality */}
          {isVideo && ['convert', 'remux'].includes(options.mode) && (
            <AccordionSection title="Quality" icon={<Sliders size={13} />} defaultOpen>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 120px' }}>
                  <FieldLabel>Resolution</FieldLabel>
                  <select value={options.res || 'original'} onChange={e => update({ res: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="original">Original</option>
                    <option value="4k">4K (2160p)</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                    <option value="480p">480p</option>
                    <option value="360p">360p</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <FieldLabel>Frame Rate</FieldLabel>
                  <select value={options.fps || 'original'} onChange={e => update({ fps: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="original">Original</option>
                    <option value="24">24</option>
                    <option value="25">25</option>
                    <option value="30">30</option>
                    <option value="60">60</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <FieldLabel>Speed Preset</FieldLabel>
                  <select value={options.preset || ''} onChange={e => update({ preset: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="">Medium</option>
                    <option value="ultrafast">Ultrafast</option>
                    <option value="veryfast">Veryfast</option>
                    <option value="fast">Fast</option>
                    <option value="slow">Slow</option>
                    <option value="veryslow">Veryslow</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <Slider
                  label="CRF Quality (lower = better)"
                  min="0" max="51" step="1"
                  value={options.crf || '23'}
                  valueDisplay={`${options.crf || '23'}`}
                  onChange={e => update({ crf: e.target.value })}
                />
              </div>
            </AccordionSection>
          )}

          {/* Audio Configuration */}
          {canEncode && (
            <AccordionSection title="Audio Configuration" icon={<Music size={13} />} defaultOpen={!isVideo}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 130px' }}>
                  <FieldLabel>Audio Codec</FieldLabel>
                  <select value={options.ac || ''} onChange={e => update({ ac: e.target.value })} style={{ ...cs, width: '100%' }}>
                    {isVideo
                      ? <><option value="aac">AAC</option><option value="mp3">MP3</option><option value="opus">Opus</option><option value="copy">Copy</option></>
                      : <><option value="mp3">MP3 (libmp3lame)</option><option value="aac">AAC</option><option value="libopus">Opus</option><option value="pcm_s16le">WAV (PCM)</option><option value="flac">FLAC</option><option value="copy">Copy</option></>
                    }
                  </select>
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <FieldLabel>Bitrate</FieldLabel>
                  <select value={options.ab || ''} onChange={e => update({ ab: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="">Auto</option>
                    <option value="64k">64 kbps</option>
                    <option value="128k">128 kbps</option>
                    <option value="192k">192 kbps</option>
                    <option value="256k">256 kbps</option>
                    <option value="320k">320 kbps</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <FieldLabel>Sample Rate</FieldLabel>
                  <select value={options.sr || ''} onChange={e => update({ sr: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="">Auto</option>
                    <option value="44100">44100 Hz</option>
                    <option value="48000">48000 Hz</option>
                    <option value="96000">96000 Hz</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 80px' }}>
                  <FieldLabel>Channels</FieldLabel>
                  <select value={options.ch || ''} onChange={e => update({ ch: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="">Auto</option>
                    <option value="1">Mono</option>
                    <option value="2">Stereo</option>
                    <option value="6">5.1</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <Slider
                  label="Volume Multiplier"
                  min="0" max="2.0" step="0.1"
                  value={options.vol !== undefined ? options.vol : 1.0}
                  valueDisplay={`${options.vol !== undefined ? options.vol : 1.0}x`}
                  onChange={e => update({ vol: parseFloat(e.target.value) })}
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                  <input type="checkbox" checked={options.norm || false} onChange={e => update({ norm: e.target.checked })} />
                  Normalize (Loudnorm)
                </label>
                <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                  <input type="checkbox" checked={options.noAudio || false} onChange={e => update({ noAudio: e.target.checked })} />
                  Remove Audio
                </label>
              </div>
            </AccordionSection>
          )}

          {/* Video Filters */}
          {canFilters && (
            <AccordionSection title="Video Filters" icon={<Sliders size={13} />}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 130px' }}>
                  <FieldLabel>Rotate</FieldLabel>
                  <select value={options.rotate || ''} onChange={e => update({ rotate: e.target.value })} style={{ ...cs, width: '100%' }}>
                    <option value="">None</option>
                    <option value="cw90">90° Clockwise</option>
                    <option value="ccw90">90° Counter-CW</option>
                    <option value="180">180°</option>
                    <option value="fliph">Flip Horizontal</option>
                    <option value="flipv">Flip Vertical</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <Slider
                    label="Speed"
                    min="0.25" max="4.0" step="0.25"
                    value={options.speed || 1.0}
                    valueDisplay={`${options.speed || 1.0}x`}
                    onChange={e => update({ speed: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {[
                  { key: 'deint', label: 'Deinterlace' },
                  { key: 'gray',  label: 'Grayscale' },
                  { key: 'den',   label: 'Denoise' },
                  { key: 'sharp', label: 'Sharpen' },
                ].map(f => (
                  <label key={f.key} className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={(options as any)[f.key] || false}
                      onChange={e => update({ [f.key]: e.target.checked } as any)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </AccordionSection>
          )}

          {/* Advanced */}
          <AccordionSection title="Advanced" icon={<Cpu size={13} />}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 100px' }}>
                <FieldLabel>Threads</FieldLabel>
                <select value={options.threads || 'auto'} onChange={e => update({ threads: e.target.value })} style={{ ...cs, width: '100%' }}>
                  <option value="auto">Auto</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                  <option value="16">16</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 2 }}>
                <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                  <input type="checkbox" checked={options.webOpt || false} onChange={e => update({ webOpt: e.target.checked })} />
                  Web Optimize
                </label>
                <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                  <input type="checkbox" checked={options.noMeta || false} onChange={e => update({ noMeta: e.target.checked })} />
                  Strip Metadata
                </label>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <FieldLabel>Custom FFmpeg Arguments</FieldLabel>
              <input
                type="text"
                value={options.custom || ''}
                onChange={e => update({ custom: e.target.value })}
                placeholder="e.g. -bufsize 2M"
                style={{ width: '100%', padding: '5px 9px', fontSize: '.76rem' }}
              />
            </div>
          </AccordionSection>

        </div>

        {/* ── Footer ── */}
        <div className="modal-footer">
          <button className="btn btn-primary" style={{ minWidth: 110, padding: '8px 20px' }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
