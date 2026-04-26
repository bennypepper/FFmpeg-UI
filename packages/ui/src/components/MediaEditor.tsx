import React, { useState } from 'react';
import { TerminalOutput } from './TerminalOutput';
import { SettingsModal } from './SettingsModal';
import type { CommandOptions } from '@ffmpeg-ui/core';
import {
  Film, Music, Sun, Moon, Upload, List, Plus, Archive, X,
  BarChart, Image as ImageIcon, AlertCircle, Play, CheckCircle,
  StopCircle, Layers, Settings2
} from 'lucide-react';

export interface MediaItem {
  id: string;
  name: string;
  path?: string;
  previewUrl?: string;
  file?: any;
  probe?: any;
}

export interface MediaEditorProps {
  capabilities: { has_ffmpeg: boolean; version: string } | null;
  onAddFiles: () => void;
  onDropFiles: (files: File[]) => void;
  onExecute: (options: CommandOptions, activeItem: MediaItem | null, queue: MediaItem[], convertAll?: boolean) => void;
  onCancel: () => void;
  isProcessing: boolean;
  isDone: boolean;
  terminalLogs: string[];
  progress: any;
  queue: MediaItem[];
  setQueue: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  activeFileId: string | null;
  setActiveFileId: React.Dispatch<React.SetStateAction<string | null>>;
  mediaInfo: any | null;
  options: CommandOptions;
  setOptions: React.Dispatch<React.SetStateAction<CommandOptions>>;
  /** Set false on desktop (Tauri) where a native title bar already exists */
  showInternalHeader?: boolean;
}

// ── File type detection ───────────────────────────────────────────
const RE_VIDEO = /\.(mp4|mkv|mov|avi|webm|flv|wmv|m4v|ts|3gp|ogv|gif|mpg|mpeg)$/i;
const RE_AUDIO = /\.(mp3|wav|ogg|flac|m4a|aac|opus|wma|aiff|ac3)$/i;

function detectType(name: string): 'video' | 'audio' | 'unknown' {
  if (RE_VIDEO.test(name)) return 'video';
  if (RE_AUDIO.test(name)) return 'audio';
  return 'unknown';
}

// ── Format lists ─────────────────────────────────────────────────
const VIDEO_FMTS = [
  { label: 'MP4',  value: 'mp4' },
  { label: 'MKV',  value: 'mkv' },
  { label: 'WebM', value: 'webm' },
  { label: 'AVI',  value: 'avi' },
  { label: 'MOV',  value: 'mov' },
  { label: 'GIF',  value: 'gif' },
];
const AUDIO_FMTS = [
  { label: 'MP3',  value: 'mp3' },
  { label: 'M4A',  value: 'm4a' },
  { label: 'OGG',  value: 'ogg' },
  { label: 'WAV',  value: 'wav' },
  { label: 'FLAC', value: 'flac' },
];

// ── Unified type-labelled presets ────────────────────────────────
type PresetDef = {
  label: string;
  type: 'video' | 'audio';
  icon: React.ReactNode;
  opts: Partial<CommandOptions>;
};

const ALL_PRESETS: PresetDef[] = [
  { label: 'TikTok / IG',  type: 'video', icon: <Film size={11}/>,    opts: { mode: 'convert', fmt: 'mp4',  vc: 'libx264', crf: '23' } },
  { label: 'YouTube',       type: 'video', icon: <Film size={11}/>,    opts: { mode: 'convert', fmt: 'mp4',  vc: 'libx264', crf: '20' } },
  { label: 'Discord <8MB',  type: 'video', icon: <Film size={11}/>,    opts: { mode: 'convert', fmt: 'mp4',  vc: 'libx264', crf: '32' } },
  { label: 'Archival MKV',  type: 'video', icon: <Archive size={11}/>, opts: { mode: 'convert', fmt: 'mkv',  vc: 'libx265', crf: '24' } },
  { label: 'HQ MP3',        type: 'audio', icon: <Music size={11}/>,   opts: { mode: 'audio',   fmt: 'mp3',  ab: '320k' } },
  { label: 'Apple AAC',     type: 'audio', icon: <Music size={11}/>,   opts: { mode: 'audio',   fmt: 'm4a',  ac: 'aac', ab: '256k' } },
  { label: 'Voice (Opus)',  type: 'audio', icon: <Music size={11}/>,   opts: { mode: 'audio',   fmt: 'ogg',  ac: 'libopus', ab: '64k' } },
  { label: 'Lossless WAV',  type: 'audio', icon: <Music size={11}/>,   opts: { mode: 'audio',   fmt: 'wav',  ac: 'pcm_s16le' } },
];

const VIDEO_PRESETS = ALL_PRESETS.filter(p => p.type === 'video');
const AUDIO_PRESETS = ALL_PRESETS.filter(p => p.type === 'audio');

export function MediaEditor(props: MediaEditorProps) {
  const {
    capabilities, onAddFiles, onDropFiles, onExecute, onCancel,
    isProcessing, isDone, terminalLogs,
    queue, setQueue, activeFileId, setActiveFileId,
    mediaInfo, options, setOptions,
    showInternalHeader = true,
  } = props;

  const [itemOptionsMap, setItemOptionsMap] = useState<Map<string, CommandOptions>>(new Map());
  const [modalItemId, setModalItemId]       = useState<string | null>(null);
  const [infoTab, setInfoTab]               = useState<'info' | 'preview'>('info');
  const [showLogs, setShowLogs]             = useState(false);
  const [showToast, setShowToast]           = useState(false);
  const [globalFmt, setGlobalFmt]           = useState('');
  const [activePresetLabel, setActivePresetLabel] = useState<string | null>(null);
  const [theme, setTheme]                   = useState<'dark' | 'light'>(() =>
    typeof document !== 'undefined'
      ? (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
      : 'dark'
  );

  React.useEffect(() => {
    if (isDone) {
      setShowToast(true);
      const t = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isDone]);

  // ── Per-item helpers ──────────────────────────────────────────
  const getItemOpts = (id: string): CommandOptions =>
    itemOptionsMap.get(id) ?? { ...options };

  const setItemOpts = (id: string, opts: CommandOptions) =>
    setItemOptionsMap(prev => new Map(prev).set(id, opts));

  // ── Smart type-aware preset application ───────────────────────
  const applyPreset = (preset: PresetDef) => {
    setActivePresetLabel(preset.label);
    setItemOptionsMap(prev => {
      const next = new Map(prev);
      queue.forEach(item => {
        const t = detectType(item.name);
        // Only apply if type matches OR file type is unknown
        if (t === 'unknown' || t === preset.type) {
          const base = next.get(item.id) ?? { ...options };
          next.set(item.id, { ...base, ...preset.opts });
        }
      });
      return next;
    });
  };

  // ── Smart global format selector ──────────────────────────────
  const applyGlobalFormat = (fmt: string) => {
    if (!fmt) return;
    setGlobalFmt(fmt);
    const fmtType = VIDEO_FMTS.some(f => f.value === fmt) ? 'video' : 'audio';
    setItemOptionsMap(prev => {
      const next = new Map(prev);
      queue.forEach(item => {
        const t = detectType(item.name);
        if (t === 'unknown' || t === fmtType) {
          const base = next.get(item.id) ?? { ...options };
          next.set(item.id, { ...base, fmt });
        }
      });
      return next;
    });
  };

  // ── Execute handlers ──────────────────────────────────────────
  const activeItem = queue.find(q => q.id === activeFileId) || null;

  const handleExecuteSelected = () => {
    if (!activeItem) return;
    onExecute(getItemOpts(activeItem.id), activeItem, queue, false);
  };

  const handleExecuteAll = () => {
    const first = queue[0] || null;
    onExecute(first ? getItemOpts(first.id) : options, activeItem, queue, true);
  };

  // ── Queue type mix detection ──────────────────────────────────
  const hasVideo = queue.some(i => detectType(i.name) === 'video');
  const hasAudio = queue.some(i => detectType(i.name) === 'audio');
  const isMixed  = hasVideo && hasAudio;
  const isEmpty  = queue.length === 0;

  // ── Modal state ───────────────────────────────────────────────
  const modalItem = modalItemId ? queue.find(q => q.id === modalItemId) : null;
  const modalOpts = modalItemId ? getItemOpts(modalItemId) : options;

  // ── Inline format options per item ────────────────────────────
  const getInlineFmts = (name: string) => {
    const t = detectType(name);
    if (t === 'audio') return AUDIO_FMTS;
    if (t === 'video') return VIDEO_FMTS;
    return [...VIDEO_FMTS, ...AUDIO_FMTS];
  };

  return (
    <div className="app-layout app-layout-full">

      {/* ── Header (suppressed on desktop) ── */}
      {showInternalHeader && (
        <header className="app-header" style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="app-brand">FFmpeg Web UI</div>
          <div className="header-right">
            {capabilities && (
              <span className="cap-badge" style={{ fontSize: '0.65rem' }}>
                {capabilities.has_ffmpeg ? '🟢' : '🔴'} {capabilities.version.split('-')[0].trim()}
              </span>
            )}
            <button
              className="btn btn-ghost"
              title="Toggle theme"
              style={{ padding: '6px' }}
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                setTheme(next);
              }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
      )}

      {/* ── Main content ── */}
      <div className="main-scrollable">

        {/* Drop + Info */}
        <div className="main-top">
          <div className="card" style={{ flex: 1 }}>
            <div
              className="drop-zone"
              onClick={onAddFiles}
              onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.add('dz-over'); }}
              onDragLeave={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.remove('dz-over'); }}
              onDrop={e => {
                e.preventDefault();
                (e.currentTarget as HTMLDivElement).classList.remove('dz-over');
                if (e.dataTransfer.files?.length) onDropFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={36} className="dz-icon" />
              <p className="dz-title">Drop files here or click to browse</p>
              <p className="dz-sub">Any video or audio — multiple files supported</p>
            </div>
          </div>

          {/* Media Info */}
          <div className="card meta-card">
            <div className="card-header">
              <span className="card-title"><BarChart size={12} style={{ marginRight: 6 }} /> Media Info</span>
              <div style={{ display: 'flex', gap: 2 }}>
                {(['info', 'preview'] as const).map(tab => (
                  <button
                    key={tab}
                    className={`info-tab-btn ${infoTab === tab ? 'active' : ''}`}
                    onClick={() => setInfoTab(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ minHeight: 130, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {!mediaInfo ? (
                <div className="media-info-empty" style={{ flex: 1 }}>
                  <Film size={32} className="mi-icon" />
                  <p>Drop a file to inspect</p>
                </div>
              ) : infoTab === 'preview' ? (
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#000', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                  {activeItem?.previewUrl
                    ? activeItem.name.match(/\.(mp3|wav|ogg|flac|m4a|aac)$/i)
                      ? <audio controls src={activeItem.previewUrl} style={{ width: '80%' }} />
                      : <video controls src={activeItem.previewUrl} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    : <span style={{ color: '#999' }}>No preview</span>}
                </div>
              ) : (
                <div style={{ padding: 12, fontSize: '.75rem', flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', alignContent: 'start' }}>
                  {mediaInfo.format_name && <div style={{ gridColumn: '1 / -1' }}><strong>Format:</strong> {mediaInfo.format_name.split(',')[0]}</div>}
                  {mediaInfo.duration    && <div><strong>Duration:</strong> {Math.round(mediaInfo.duration)}s</div>}
                  {mediaInfo.size_mb     && <div><strong>Size:</strong> {mediaInfo.size_mb} MB</div>}
                  {mediaInfo.bitrate_kbps && <div><strong>Bitrate:</strong> {mediaInfo.bitrate_kbps} kbps</div>}
                  {mediaInfo.video_codec && <><div><strong>Video:</strong> {mediaInfo.video_codec.toUpperCase()}</div><div><strong>Res:</strong> {mediaInfo.width}×{mediaInfo.height}</div></>}
                  {mediaInfo.audio_codec && <><div><strong>Audio:</strong> {mediaInfo.audio_codec.toUpperCase()}</div>{mediaInfo.channels && <div><strong>Ch:</strong> {mediaInfo.channels === 2 ? 'Stereo' : 'Mono'}</div>}</>}
                  {mediaInfo.audio_codec && !mediaInfo.video_codec && (
                    <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setOptions(p => ({ ...p, mode: 'audio', fmt: 'mp3' }))}>
                        <AlertCircle size={11} style={{ marginRight: 4 }} /> Switch to Audio Mode
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Preset Pills (type-aware, grouped when mixed) ── */}
        <div className="presets-bar">
          {/* Video presets */}
          {(isEmpty || hasVideo) && (
            <>
              {isMixed && <span className="presets-label" style={{ fontSize: '.60rem' }}>VIDEO</span>}
              {!isMixed && !hasAudio && <span className="presets-label">Quick Presets</span>}
              <div className="presets-group">
                {VIDEO_PRESETS.map(p => (
                  <button
                    key={p.label}
                    className={`preset-btn ${activePresetLabel === p.label ? 'active' : ''}`}
                    onClick={() => applyPreset(p)}
                    title="Apply to video files only"
                  >
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {/* Divider for mixed */}
          {isMixed && <div style={{ width: '100%', height: 1, background: 'var(--border)' }} />}
          {/* Audio presets */}
          {(isEmpty || hasAudio) && (
            <>
              {isMixed && <span className="presets-label" style={{ fontSize: '.60rem' }}>AUDIO</span>}
              {!isMixed && hasAudio && <span className="presets-label">Audio Presets</span>}
              <div className="presets-group">
                {AUDIO_PRESETS.map(p => (
                  <button
                    key={p.label}
                    className={`preset-btn ${activePresetLabel === p.label ? 'active' : ''}`}
                    onClick={() => applyPreset(p)}
                    title="Apply to audio files only"
                  >
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Batch Queue ── */}
        <div className="card batch-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title">
              <List size={12} style={{ marginRight: 6 }} /> Batch Queue
              <span style={{ marginLeft: 8, opacity: 0.5, fontWeight: 400 }}>{queue.length} file{queue.length !== 1 ? 's' : ''}</span>
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Global "All→ format" with optgroups when mixed */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: '.62rem', color: 'var(--text-2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>All→</span>
                <select
                  value={globalFmt}
                  onChange={e => applyGlobalFormat(e.target.value)}
                  style={{ padding: '3px 22px 3px 7px', fontSize: '.72rem', borderRadius: 5, minWidth: 70 }}
                  title="Apply format to matching files"
                >
                  <option value="">Format</option>
                  {(isEmpty || hasVideo) && (
                    <optgroup label="Video">
                      {VIDEO_FMTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </optgroup>
                  )}
                  {(isEmpty || hasAudio) && (
                    <optgroup label="Audio">
                      {AUDIO_FMTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={onAddFiles}>
                <Plus size={12} style={{ marginRight: 4 }} /> Add
              </button>
            </div>
          </div>

          <div className="queue-list" style={{ padding: 10, flex: 1, overflowY: 'auto', maxHeight: 'none' }}>
            {queue.length === 0 ? (
              <div className="queue-empty">Drop files above to add them to the queue</div>
            ) : (
              queue.map(item => {
                const iOpts = getItemOpts(item.id);
                const isActive = activeFileId === item.id;
                const fmtList = getInlineFmts(item.name);
                const fileType = detectType(item.name);
                return (
                  <div
                    key={item.id}
                    className={`queue-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveFileId(item.id)}
                  >
                    <div className="qi-status">
                      {fileType === 'audio' ? <Music size={13} /> : <Film size={13} />}
                    </div>
                    <div className="qi-info">
                      <div className="qi-name">{item.name}</div>
                      <div className="qi-sub">{iOpts.fmt?.toUpperCase() ?? 'auto'} · {iOpts.mode ?? 'convert'}</div>
                    </div>
                    <div className="qi-inline-fmt" onClick={e => e.stopPropagation()}>
                      <select
                        value={iOpts.fmt || fmtList[0]?.value}
                        onChange={e => setItemOpts(item.id, { ...iOpts, fmt: e.target.value })}
                        className="qi-fmt-select"
                        title="Output format"
                      >
                        {fmtList.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div className="qi-actions" onClick={e => e.stopPropagation()}>
                      <button
                        title={`Settings for ${item.name}`}
                        onClick={() => setModalItemId(item.id)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, borderRadius: 4, color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}
                      >
                        <Settings2 size={13} />
                      </button>
                      <button
                        title="Remove"
                        onClick={() => {
                          setQueue(q => q.filter(i => i.id !== item.id));
                          setItemOptionsMap(prev => { const n = new Map(prev); n.delete(item.id); return n; });
                          if (activeFileId === item.id) setActiveFileId(null);
                        }}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, borderRadius: 4, color: 'var(--text-3)', display: 'flex', alignItems: 'center' }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Logs toggle */}
        <button
          className="btn btn-ghost"
          style={{ fontSize: '.72rem', padding: '3px 10px', opacity: 0.6, alignSelf: 'flex-start' }}
          onClick={() => setShowLogs(v => !v)}
        >
          <BarChart size={12} style={{ marginRight: 4 }} />
          {showLogs ? 'Hide Logs' : 'Show Logs'}
        </button>

        {showLogs && (
          <div className="terminal-dock" style={{ borderTop: 'none', background: 'transparent' }}>
            <TerminalOutput logs={terminalLogs} title="FFmpeg Log Console" />
          </div>
        )}

        <div style={{ height: 52, flexShrink: 0 }} />
      </div>

      {/* ── Anchored CTA Bar ── */}
      <div className="cta-bar">
        {isProcessing ? (
          <button className="btn btn-secondary" style={{ padding: '9px 18px' }} onClick={onCancel}>
            <StopCircle size={15} style={{ marginRight: 6 }} /> Stop Task
          </button>
        ) : (
          <>
            <button
              className="btn btn-secondary"
              style={{ padding: '9px 18px' }}
              onClick={handleExecuteSelected}
              disabled={isProcessing || !activeItem}
            >
              <Play size={14} style={{ marginRight: 6 }} /> Convert Selected
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '9px 22px' }}
              onClick={handleExecuteAll}
              disabled={isProcessing || queue.length === 0}
            >
              <Layers size={14} style={{ marginRight: 6 }} /> Convert All ({queue.length})
            </button>
          </>
        )}
      </div>

      {/* Settings Modal */}
      {modalItem && (
        <SettingsModal
          fileName={modalItem.name}
          options={modalOpts}
          onChange={opts => setItemOpts(modalItem.id, opts)}
          onClose={() => setModalItemId(null)}
        />
      )}

      {/* Toast */}
      {showToast && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--success)', color: '#fff', padding: '10px 22px',
          borderRadius: 999, display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)', zIndex: 9999, fontWeight: 600, fontSize: '.88rem',
        }}>
          <CheckCircle size={16} /> Processing Complete!
        </div>
      )}
    </div>
  );
}
