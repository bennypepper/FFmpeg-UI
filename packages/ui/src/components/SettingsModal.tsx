import { useEffect, useId, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Slider } from './Slider';
import {
  AUDIO_CODEC_CONSTRAINTS,
  getCompatibleCodecs,
  getPlatformCapabilities,
  normalizeAudioCodec,
  reconcileOptionsForFormat,
  validateOptions,
} from '@ffmpeg-ui/core';
import type {
  AudioCodec,
  CommandOptions,
  HwAccel,
  ProcessingMode,
  RuntimePlatform,
  VideoCodec,
} from '@ffmpeg-ui/core';
import {
  X,
  ChevronDown,
  ChevronRight,
  Film,
  Music,
  Sliders,
  Cpu,
  Settings2,
  Scissors,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';

export interface SettingsModalProps {
  fileName: string;
  options: CommandOptions;
  onChange: (opts: CommandOptions) => void;
  onClose: () => void;
  platform?: RuntimePlatform;
}

const ALL_VIDEO_CODECS: Array<{ value: VideoCodec; label: string }> = [
  { value: 'libx264', label: 'H.264 (libx264)' },
  { value: 'libx265', label: 'H.265 (libx265)' },
  { value: 'libvpx-vp9', label: 'VP9 (libvpx-vp9)' },
  { value: 'prores_ks', label: 'Apple ProRes' },
  { value: 'copy', label: 'Copy (No Re-encode)' },
];

const ALL_AUDIO_CODECS: Array<{ value: AudioCodec; label: string }> = [
  { value: 'aac', label: 'AAC' },
  { value: 'libmp3lame', label: 'MP3 (libmp3lame)' },
  { value: 'libopus', label: 'Opus (libopus)' },
  { value: 'flac', label: 'FLAC (Lossless)' },
  { value: 'pcm_s16le', label: 'WAV (PCM 16-bit)' },
  { value: 'copy', label: 'Copy (No Re-encode)' },
];

const ALL_HWACCELS: Array<{ value: HwAccel; label: string }> = [
  { value: 'none', label: 'None / CPU' },
  { value: 'cuda', label: 'NVIDIA (CUDA)' },
  { value: 'qsv', label: 'Intel (QSV)' },
];

const VIDEO_CONTAINERS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'gif'] as const;
const AUDIO_CONTAINERS = ['mp3', 'm4a', 'ogg', 'wav', 'flac'] as const;
const VIDEO_SUBMODES: readonly ProcessingMode[] = ['convert', 'remux', 'thumbnail', 'gif', 'merge'];

const STANDARD_SAMPLE_RATES = [8000, 12000, 16000, 24000, 44100, 48000, 96000];
const CHANNEL_OPTIONS = [
  { value: '1', label: 'Mono (1ch)', count: 1 },
  { value: '2', label: 'Stereo (2ch)', count: 2 },
  { value: '6', label: '5.1 Surround (6ch)', count: 6 },
];

// ── Accordion ────────────────────────────────────────────────────
function AccordionSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`modal-accordion ${open ? 'is-open' : ''}`}>
      <button
        className="modal-accordion-header"
        onClick={() => setOpen(o => !o)}
        type="button"
        aria-expanded={open}
      >
        <span className="modal-accordion-icon">{icon}</span>
        <span className="modal-accordion-title">{title}</span>
        <span className="modal-accordion-chevron">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {open && <div className="modal-accordion-body">{children}</div>}
    </div>
  );
}

// ── Compact label helper ──────────────────────────────────────────
function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        fontSize: '.62rem',
        fontWeight: 700,
        letterSpacing: '.07em',
        textTransform: 'uppercase',
        color: 'var(--text-2)',
        display: 'block',
        marginBottom: 4,
      }}
    >
      {children}
    </label>
  );
}

// ── Main Modal ───────────────────────────────────────────────────
export function SettingsModal({
  fileName,
  options,
  onChange,
  onClose,
  platform = 'desktop',
}: SettingsModalProps) {
  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const platformCaps = getPlatformCapabilities(platform);
  const compat = getCompatibleCodecs(options.fmt || 'mp4', platform);
  const validation = validateOptions(options, platform);

  const update = (partial: Partial<CommandOptions>) =>
    onChange({ ...options, ...partial });

  const isAudioMode = options.mode === 'audio';
  const isVideoCategory = !isAudioMode;
  const isConvert = options.mode === 'convert';
  const isThumbnail = options.mode === 'thumbnail';
  const isGif = options.mode === 'gif';
  const isRemux = options.mode === 'remux';

  const normalizedAc = normalizeAudioCodec(options.ac) as AudioCodec;
  const acConstraints = AUDIO_CODEC_CONSTRAINTS[normalizedAc] ?? AUDIO_CODEC_CONSTRAINTS.aac;
  const isAudioCopy = normalizedAc === 'copy';
  const isVideoCopy = options.vc === 'copy';
  const showQualitySection = isConvert && !isVideoCopy;
  const showAudioSection = isConvert || isAudioMode;
  const showTrimSection = isConvert || isAudioMode || isRemux || isGif;

  const allowedSampleRates = STANDARD_SAMPLE_RATES.filter(sr => {
    if (acConstraints.allowedSampleRates) return acConstraints.allowedSampleRates.includes(sr);
    if (acConstraints.maxSampleRate) return sr <= acConstraints.maxSampleRate;
    return true;
  });

  const allowedChannels = CHANNEL_OPTIONS.filter(
    ch => !acConstraints.maxChannels || ch.count <= acConstraints.maxChannels,
  );

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleFormatChange = (newFmt: string) => {
    onChange(reconcileOptionsForFormat(options, newFmt, platform));
  };

  const handleSubModeChange = (m: ProcessingMode) => {
    if (!platformCaps.modes.includes(m)) return;
    if (m === 'gif') {
      onChange(reconcileOptionsForFormat(options, 'gif', platform));
      return;
    }
    if (m === 'thumbnail') {
      update({
        mode: 'thumbnail',
        thFmt: options.thFmt || 'jpg',
        thTime: options.thTime || '00:00:01',
        thQ: options.thQ || '2',
      });
      return;
    }
    const targetFmt =
      options.fmt === 'gif' || AUDIO_CONTAINERS.includes(options.fmt as (typeof AUDIO_CONTAINERS)[number])
        ? 'mp4'
        : options.fmt || 'mp4';
    onChange(reconcileOptionsForFormat({ ...options, mode: m }, targetFmt, platform));
  };

  const handleAudioCodecChange = (newAc: string) => {
    const nextAc = normalizeAudioCodec(newAc) as AudioCodec;
    const nextConstraints = AUDIO_CODEC_CONSTRAINTS[nextAc];
    const patch: Partial<CommandOptions> = { ac: nextAc };
    if (nextAc === 'copy') {
      patch.ab = '';
      patch.sr = '';
      patch.ch = '';
    } else if (nextConstraints) {
      if (!nextConstraints.supportsBitrate) patch.ab = '';
      if (options.sr) {
        const srNum = Number(options.sr);
        if (nextConstraints.allowedSampleRates && !nextConstraints.allowedSampleRates.includes(srNum)) {
          patch.sr = '48000';
        } else if (nextConstraints.maxSampleRate && srNum > nextConstraints.maxSampleRate) {
          patch.sr = String(nextConstraints.maxSampleRate);
        }
      }
      if (options.ch && nextConstraints.maxChannels && Number(options.ch) > nextConstraints.maxChannels) {
        patch.ch = String(nextConstraints.maxChannels);
      }
    }
    update(patch);
  };

  const cs: CSSProperties = { padding: '5px 28px 5px 9px', fontSize: '.76rem' };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby={fieldId('title')}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-header-left">
            <Settings2 size={15} style={{ flexShrink: 0, color: 'var(--text-2)' }} aria-hidden="true" />
            <div>
              <div id={fieldId('title')} className="modal-title">
                Configure Settings
              </div>
              <div className="modal-subtitle" title={fileName}>
                {fileName}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close settings dialog"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Pinned top: Mode + Sub-mode + Format ── */}
        <div className="modal-top-row">
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <FieldLabel>Category</FieldLabel>
              <div className="segment-group" style={{ width: '100%' }}>
                <button
                  type="button"
                  style={{ flex: 1, justifyContent: 'center', padding: '5px 10px', fontSize: '.75rem' }}
                  className={`seg-btn ${isVideoCategory ? 'active' : ''}`}
                  onClick={() =>
                    onChange(
                      reconcileOptionsForFormat(
                        { ...options, mode: 'convert', vc: 'libx264', ac: 'aac' },
                        'mp4',
                        platform,
                      ),
                    )
                  }
                >
                  <Film size={11} style={{ marginRight: 4 }} /> Video
                </button>
                <button
                  type="button"
                  style={{ flex: 1, justifyContent: 'center', padding: '5px 10px', fontSize: '.75rem' }}
                  className={`seg-btn ${isAudioMode ? 'active' : ''}`}
                  onClick={() =>
                    onChange(
                      reconcileOptionsForFormat(
                        { ...options, mode: 'audio', vc: '', ac: 'libmp3lame' },
                        'mp3',
                        platform,
                      ),
                    )
                  }
                >
                  <Music size={11} style={{ marginRight: 4 }} /> Audio
                </button>
              </div>
            </div>

            {/* Output Container Format (hidden in thumbnail / gif modes where dedicated format applies) */}
            {!isThumbnail && !isGif && (
              <div style={{ flex: '1 1 130px' }}>
                <FieldLabel htmlFor={fieldId('fmt')}>Output Format</FieldLabel>
                <select
                  id={fieldId('fmt')}
                  value={options.fmt || ''}
                  onChange={e => handleFormatChange(e.target.value)}
                  style={{ ...cs, width: '100%' }}
                >
                  {isVideoCategory
                    ? VIDEO_CONTAINERS.map(v => {
                        const unsupported =
                          v !== 'gif' && !isRemux && !platformCaps.videoContainers.includes(v);
                        return (
                          <option key={v} value={v} disabled={unsupported}>
                            {v.toUpperCase()}
                            {unsupported ? ' (Desktop / Local Server only)' : ''}
                          </option>
                        );
                      })
                    : AUDIO_CONTAINERS.map(v => (
                        <option key={v} value={v}>
                          {v.toUpperCase()}
                        </option>
                      ))}
                </select>
              </div>
            )}
          </div>

          {/* Sub-mode (video category only) */}
          {isVideoCategory && (
            <div>
              <FieldLabel>Sub-Mode</FieldLabel>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {VIDEO_SUBMODES.map(m => {
                  const supported = platformCaps.modes.includes(m);
                  const disabledReason = platformCaps.disabledReasons.modes[m];
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={!supported}
                      title={supported ? undefined : disabledReason ?? 'Unavailable on this platform'}
                      className={`mode-btn ${options.mode === m ? 'active' : ''}`}
                      style={{ flex: 1, minWidth: 74, padding: '5px 8px', fontSize: '.70rem' }}
                      onClick={() => handleSubModeChange(m)}
                    >
                      {m === 'gif' ? 'GIF' : m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Scrollable Body ── */}
        <div className="modal-body">
          {/* Validation notices */}
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div
              role="status"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: '.72rem',
                background: validation.errors.length > 0 ? 'rgba(220, 38, 38, 0.1)' : 'var(--bg-warning)',
                border: `1px solid ${validation.errors.length > 0 ? 'rgba(220, 38, 38, 0.3)' : 'var(--border-warning)'}`,
                color: validation.errors.length > 0 ? 'var(--error)' : 'var(--text-warning)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {validation.errors.map((err, i) => (
                <div key={`e-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                  <span>{err}</span>
                </div>
              ))}
              {validation.warnings.map((warn, i) => (
                <div key={`w-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                  <span>{warn}</span>
                </div>
              ))}
            </div>
          )}

          {/* Thumbnail Configuration */}
          {isThumbnail && (
            <AccordionSection title="Thumbnail Configuration" icon={<ImageIcon size={13} />} defaultOpen>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 120px' }}>
                  <FieldLabel htmlFor={fieldId('thTime')}>Timestamp</FieldLabel>
                  <input
                    id={fieldId('thTime')}
                    type="text"
                    value={options.thTime ?? '00:00:01'}
                    onChange={e => update({ thTime: e.target.value })}
                    placeholder="00:00:01"
                    style={{ width: '100%', padding: '5px 9px', fontSize: '.76rem' }}
                  />
                </div>
                <div style={{ flex: '1 1 110px' }}>
                  <FieldLabel htmlFor={fieldId('thFmt')}>Image Format</FieldLabel>
                  <select
                    id={fieldId('thFmt')}
                    value={options.thFmt || 'jpg'}
                    onChange={e => update({ thFmt: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="jpg">JPG</option>
                    <option value="png">PNG (Lossless)</option>
                    <option value="webp">WebP</option>
                  </select>
                </div>
                {(options.thFmt || 'jpg') !== 'png' && (
                  <div style={{ flex: '1 1 100px' }}>
                    <FieldLabel htmlFor={fieldId('thQ')}>Quality (-q:v)</FieldLabel>
                    <input
                      id={fieldId('thQ')}
                      type="number"
                      min={1}
                      max={31}
                      value={options.thQ ?? '2'}
                      onChange={e => update({ thQ: e.target.value })}
                      style={{ width: '100%', padding: '5px 9px', fontSize: '.76rem' }}
                    />
                  </div>
                )}
              </div>
            </AccordionSection>
          )}

          {/* GIF Configuration */}
          {isGif && (
            <AccordionSection title="GIF Configuration" icon={<Film size={13} />} defaultOpen>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 110px' }}>
                  <FieldLabel htmlFor={fieldId('gifFps')}>GIF Frame Rate</FieldLabel>
                  <select
                    id={fieldId('gifFps')}
                    value={options.gifFps || options.gFps || '15'}
                    onChange={e => update({ gifFps: e.target.value, gFps: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="8">8 fps</option>
                    <option value="10">10 fps</option>
                    <option value="12">12 fps</option>
                    <option value="15">15 fps</option>
                    <option value="20">20 fps</option>
                    <option value="24">24 fps</option>
                    <option value="30">30 fps</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 110px' }}>
                  <FieldLabel htmlFor={fieldId('gifW')}>Width (px)</FieldLabel>
                  <select
                    id={fieldId('gifW')}
                    value={options.gifW || options.gW || '480'}
                    onChange={e => update({ gifW: e.target.value, gW: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="240">240 px</option>
                    <option value="320">320 px</option>
                    <option value="480">480 px</option>
                    <option value="640">640 px</option>
                    <option value="720">720 px</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 110px' }}>
                  <FieldLabel htmlFor={fieldId('gLoop')}>Looping</FieldLabel>
                  <select
                    id={fieldId('gLoop')}
                    value={options.gLoop ?? '0'}
                    onChange={e => update({ gLoop: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="0">Loop Forever</option>
                    <option value="1">Play Once</option>
                  </select>
                </div>
              </div>
            </AccordionSection>
          )}

          {/* Video Configuration (convert mode only) */}
          {isConvert && (
            <AccordionSection title="Video Configuration" icon={<Film size={13} />} defaultOpen>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 150px' }}>
                  <FieldLabel htmlFor={fieldId('vc')}>Video Codec</FieldLabel>
                  <select
                    id={fieldId('vc')}
                    value={options.vc || 'libx264'}
                    onChange={e => update({ vc: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    {ALL_VIDEO_CODECS.map(c => {
                      const supportedOnPlatform = platformCaps.videoCodecs.includes(c.value);
                      const compatibleWithFmt = compat.video.includes(c.value);
                      const disabled = !supportedOnPlatform || !compatibleWithFmt;
                      const suffix = !supportedOnPlatform
                        ? ' (Desktop / Local Server only)'
                        : !compatibleWithFmt
                          ? ` (Not valid in ${options.fmt.toUpperCase()})`
                          : '';
                      return (
                        <option key={c.value} value={c.value} disabled={disabled}>
                          {c.label}
                          {suffix}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div style={{ flex: '1 1 150px' }}>
                  <FieldLabel htmlFor={fieldId('hwaccel')}>Hardware Accel</FieldLabel>
                  <select
                    id={fieldId('hwaccel')}
                    value={options.hwaccel || 'none'}
                    disabled={isVideoCopy}
                    onChange={e => update({ hwaccel: e.target.value as HwAccel })}
                    style={{ ...cs, width: '100%' }}
                  >
                    {ALL_HWACCELS.map(hw => {
                      const supported = platformCaps.hwaccels.includes(hw.value);
                      return (
                        <option key={hw.value} value={hw.value} disabled={!supported}>
                          {hw.label}
                          {!supported ? ' (Desktop / Local Server only)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </AccordionSection>
          )}

          {/* Quality (convert mode with non-copy video only — hidden in remux/thumbnail/gif/audio) */}
          {showQualitySection && (
            <AccordionSection title="Quality" icon={<Sliders size={13} />} defaultOpen>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 120px' }}>
                  <FieldLabel htmlFor={fieldId('res')}>Resolution</FieldLabel>
                  <select
                    id={fieldId('res')}
                    value={options.res || 'original'}
                    onChange={e => update({ res: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="original">Original</option>
                    <option value="4k">4K (2160p)</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                    <option value="480p">480p</option>
                    <option value="360p">360p</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <FieldLabel htmlFor={fieldId('fps')}>Frame Rate</FieldLabel>
                  <select
                    id={fieldId('fps')}
                    value={options.fps || 'original'}
                    onChange={e => update({ fps: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="original">Original</option>
                    <option value="24">24</option>
                    <option value="25">25</option>
                    <option value="30">30</option>
                    <option value="60">60</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <FieldLabel htmlFor={fieldId('preset')}>Speed Preset</FieldLabel>
                  <select
                    id={fieldId('preset')}
                    value={options.preset || ''}
                    disabled={(options.hwaccel || 'none') !== 'none' || !['libx264', 'libx265'].includes(options.vc)}
                    onChange={e => update({ preset: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="">Medium</option>
                    <option value="ultrafast">Ultrafast</option>
                    <option value="veryfast">Veryfast</option>
                    <option value="fast">Fast</option>
                    <option value="slow">Slow</option>
                    <option value="veryslow">Veryslow</option>
                  </select>
                </div>
              </div>
              {options.vc !== 'prores_ks' && (
                <div style={{ marginTop: 10 }}>
                  <Slider
                    id={fieldId('crf')}
                    label="CRF Quality (lower = better)"
                    min="0"
                    max="51"
                    step="1"
                    value={options.crf || '23'}
                    valueDisplay={`${options.crf || '23'}`}
                    onChange={e => update({ crf: e.target.value })}
                  />
                </div>
              )}
            </AccordionSection>
          )}

          {/* Audio Configuration */}
          {showAudioSection && (
            <AccordionSection title="Audio Configuration" icon={<Music size={13} />} defaultOpen={isAudioMode}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <FieldLabel htmlFor={fieldId('ac')}>Audio Codec</FieldLabel>
                  <select
                    id={fieldId('ac')}
                    value={normalizedAc}
                    disabled={Boolean(options.noAudio && isConvert)}
                    onChange={e => handleAudioCodecChange(e.target.value)}
                    style={{ ...cs, width: '100%' }}
                  >
                    {ALL_AUDIO_CODECS.map(c => {
                      const supportedOnPlatform = platformCaps.audioCodecs.includes(c.value);
                      const compatibleWithFmt = compat.audio.includes(c.value);
                      const disabled = !supportedOnPlatform || !compatibleWithFmt;
                      const suffix = !supportedOnPlatform
                        ? ' (Desktop / Local Server only)'
                        : !compatibleWithFmt
                          ? ` (Not valid in ${options.fmt.toUpperCase()})`
                          : '';
                      return (
                        <option key={c.value} value={c.value} disabled={disabled}>
                          {c.label}
                          {suffix}
                        </option>
                      );
                    })}
                  </select>
                </div>
                {acConstraints.supportsBitrate && (
                  <div style={{ flex: '1 1 100px' }}>
                    <FieldLabel htmlFor={fieldId('ab')}>Bitrate</FieldLabel>
                    <select
                      id={fieldId('ab')}
                      value={options.ab || ''}
                      disabled={Boolean(options.noAudio && isConvert) || isAudioCopy}
                      onChange={e => update({ ab: e.target.value })}
                      style={{ ...cs, width: '100%' }}
                    >
                      <option value="">Auto</option>
                      <option value="64k">64 kbps</option>
                      <option value="128k">128 kbps</option>
                      <option value="192k">192 kbps</option>
                      <option value="256k">256 kbps</option>
                      <option value="320k">320 kbps</option>
                    </select>
                  </div>
                )}
                <div style={{ flex: '1 1 100px' }}>
                  <FieldLabel htmlFor={fieldId('sr')}>Sample Rate</FieldLabel>
                  <select
                    id={fieldId('sr')}
                    value={options.sr || ''}
                    disabled={Boolean(options.noAudio && isConvert) || isAudioCopy}
                    onChange={e => update({ sr: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="">Auto</option>
                    {allowedSampleRates.map(sr => (
                      <option key={sr} value={String(sr)}>
                        {sr} Hz
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 90px' }}>
                  <FieldLabel htmlFor={fieldId('ch')}>Channels</FieldLabel>
                  <select
                    id={fieldId('ch')}
                    value={options.ch || ''}
                    disabled={Boolean(options.noAudio && isConvert) || isAudioCopy}
                    onChange={e => update({ ch: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
                    <option value="">Auto</option>
                    {allowedChannels.map(ch => (
                      <option key={ch.value} value={ch.value}>
                        {ch.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {!isAudioCopy && !(options.noAudio && isConvert) && (
                <div style={{ marginTop: 10 }}>
                  <Slider
                    id={fieldId('vol')}
                    label="Volume Multiplier (0 = Mute)"
                    min="0"
                    max="2.0"
                    step="0.1"
                    value={options.vol !== undefined ? options.vol : 1.0}
                    valueDisplay={options.vol === 0 ? 'Muted (0x)' : `${options.vol !== undefined ? options.vol : 1.0}x`}
                    onChange={e => update({ vol: parseFloat(e.target.value) })}
                  />
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {!isAudioCopy && !(options.noAudio && isConvert) && (
                  <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(options.norm)}
                      onChange={e => update({ norm: e.target.checked })}
                    />
                    Normalize (Loudnorm)
                  </label>
                )}
                {isConvert && (
                  <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(options.noAudio)}
                      onChange={e => update({ noAudio: e.target.checked })}
                    />
                    Remove Audio
                  </label>
                )}
              </div>
            </AccordionSection>
          )}

          {/* Trim */}
          {showTrimSection && (
            <AccordionSection title="Trim Range" icon={<Scissors size={13} />}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 130px' }}>
                  <FieldLabel htmlFor={fieldId('tsStart')}>Start Time</FieldLabel>
                  <input
                    id={fieldId('tsStart')}
                    type="text"
                    value={options.ts_start || ''}
                    onChange={e => update({ ts_start: e.target.value })}
                    placeholder="00:00:00"
                    style={{ width: '100%', padding: '5px 9px', fontSize: '.76rem' }}
                  />
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <FieldLabel htmlFor={fieldId('tsEnd')}>End Time</FieldLabel>
                  <input
                    id={fieldId('tsEnd')}
                    type="text"
                    value={options.ts_end || ''}
                    onChange={e => update({ ts_end: e.target.value })}
                    placeholder="e.g. 00:00:10"
                    style={{ width: '100%', padding: '5px 9px', fontSize: '.76rem' }}
                  />
                </div>
              </div>
            </AccordionSection>
          )}

          {/* Video Filters (convert mode only, when not stream-copying) */}
          {isConvert && !isVideoCopy && (
            <AccordionSection title="Video Filters" icon={<Sliders size={13} />}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 130px' }}>
                  <FieldLabel htmlFor={fieldId('rotate')}>Rotate</FieldLabel>
                  <select
                    id={fieldId('rotate')}
                    value={options.rotate || ''}
                    onChange={e => update({ rotate: e.target.value })}
                    style={{ ...cs, width: '100%' }}
                  >
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
                    id={fieldId('speed')}
                    label="Speed"
                    min="0.25"
                    max="4.0"
                    step="0.25"
                    value={options.speed ?? 1.0}
                    valueDisplay={`${options.speed ?? 1.0}x`}
                    onChange={e => update({ speed: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {(
                  [
                    { key: 'deint', label: 'Deinterlace' },
                    { key: 'gray', label: 'Grayscale' },
                    { key: 'den', label: 'Denoise' },
                    { key: 'sharp', label: 'Sharpen' },
                  ] as const
                ).map(f => (
                  <label key={f.key} className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(options[f.key])}
                      onChange={e => update({ [f.key]: e.target.checked })}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </AccordionSection>
          )}

          {/* Speed in Audio mode */}
          {isAudioMode && !isAudioCopy && (
            <AccordionSection title="Playback Speed" icon={<Sliders size={13} />}>
              <Slider
                id={fieldId('audioSpeed')}
                label="Audio Tempo"
                min="0.25"
                max="4.0"
                step="0.25"
                value={options.speed ?? 1.0}
                valueDisplay={`${options.speed ?? 1.0}x`}
                onChange={e => update({ speed: parseFloat(e.target.value) })}
              />
            </AccordionSection>
          )}

          {/* Advanced */}
          <AccordionSection title="Advanced" icon={<Cpu size={13} />}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 100px' }}>
                <FieldLabel htmlFor={fieldId('threads')}>Threads</FieldLabel>
                <select
                  id={fieldId('threads')}
                  value={options.threads || 'auto'}
                  onChange={e => update({ threads: e.target.value })}
                  style={{ ...cs, width: '100%' }}
                >
                  <option value="auto">Auto</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                  <option value="16">16</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 2 }}>
                {isVideoCategory && options.fmt === 'mp4' && !isThumbnail && !isGif && (
                  <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(options.webOpt)}
                      onChange={e => update({ webOpt: e.target.checked })}
                    />
                    Web Optimize
                  </label>
                )}
                <label className="chk-label" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(options.noMeta)}
                    onChange={e => update({ noMeta: e.target.checked })}
                  />
                  Strip Metadata
                </label>
              </div>
            </div>
            {platform === 'wasm' ? (
              <div style={{ marginTop: 10 }}>
                <FieldLabel htmlFor={fieldId('custom')}>Custom FFmpeg Arguments</FieldLabel>
                <input
                  id={fieldId('custom')}
                  type="text"
                  value={options.custom || ''}
                  onChange={e => update({ custom: e.target.value })}
                  placeholder="e.g. -bufsize 2M"
                  style={{ width: '100%', padding: '5px 9px', fontSize: '.76rem' }}
                />
              </div>
            ) : (
              <p
                style={{
                  margin: '10px 0 0',
                  fontSize: '.70rem',
                  lineHeight: 1.45,
                  color: 'var(--text-2)',
                }}
              >
                Custom raw CLI arguments are disabled on Desktop and Local Server to prevent command injection.
              </p>
            )}
          </AccordionSection>
        </div>

        {/* ── Footer ── */}
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            style={{ minWidth: 110, padding: '8px 20px' }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
