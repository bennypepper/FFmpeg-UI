import React, { useState } from 'react';
import { Dropzone } from './Dropzone';
import { TerminalOutput } from './TerminalOutput';
import { Select } from './Select';
import { Slider } from './Slider';
import type { CommandOptions } from '@ffmpeg-ui/core';

import {
  Film, Music, Layers, Sun, Moon, Upload, List, Plus, Archive, X,
  BarChart, Package, Image as ImageIcon, AlertCircle, Play, CheckCircle, StopCircle, RefreshCw
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
  onExecute: (options: CommandOptions, activeItem: MediaItem | null, queue: MediaItem[]) => void;
  onCancel: () => void;
  onDownloadEngine?: () => void;
  isDownloadingEngine?: boolean;
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
}

export function MediaEditor(props: MediaEditorProps) {
  const {
    capabilities, onAddFiles, onDropFiles, onExecute, onCancel,
    isProcessing, isDone, terminalLogs, progress,
    queue, setQueue, activeFileId, setActiveFileId,
    mediaInfo, options, setOptions, onDownloadEngine, isDownloadingEngine
  } = props;

  const [activeMode, setActiveMode] = useState<'video' | 'audio'>('video');
  const [subMode, setSubMode] = useState<'convert' | 'remux' | 'thumbnail' | 'merge'>('convert');
  const [activeTab, setActiveTab] = useState<'format' | 'quality' | 'filters' | 'audio' | 'advanced'>('format');
  const [infoTab, setInfoTab] = useState<'info' | 'preview'>('info');
  const [showLogs, setShowLogs] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => 
    typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light') : 'light'
  );

  React.useEffect(() => {
    if (isDone) {
      setShowToast(true);
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isDone]);

  const handleUpdate = (updates: Partial<CommandOptions>) => {
    setOptions(prev => ({ ...prev, ...updates }));
  };

  const isPresetActive = (partial: Partial<CommandOptions>) => {
    for (const key in partial) {
      if ((options as any)[key] !== (partial as any)[key]) return false;
    }
    return true;
  };

  const activeItem = queue.find(q => q.id === activeFileId) || null;

  return (
    <div className="app-layout">
      {/* ── Main Pane ── */}
      <div className="main-pane">
        <header className="app-header" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <div className="app-brand" style={{ margin: 0 }}>FFmpeg Web UI</div>  
          <div className="header-right" style={{ display: 'flex', alignItems: 'center' }}>
            {!capabilities && (
              <button className="btn btn-ghost" onClick={onDownloadEngine} disabled={isDownloadingEngine}>
                <Layers size={14} style={{marginRight: 6}} />
                Install FFmpeg
              </button>
            )}
            <button
              className="btn btn-ghost" 
              title="Toggle theme"
              style={{ padding: '8px', marginLeft: 'auto' }}
              onClick={() => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', nextTheme);
                setTheme(nextTheme);
              }}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        <div className="main-scrollable" style={{ paddingBottom: '40px', overflowY: 'auto' }}>
          <div className="main-top">
            <div className="card" style={{ flex: 1 }}>
              <div
                className="drop-zone"
                onClick={onAddFiles}
                onDragOver={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary)';
                   (e.currentTarget as HTMLDivElement).style.background = 'var(--primary-transparent, rgba(0, 120, 212, 0.05))';
                }}
                onDragLeave={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
                   (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
                }}
                onDrop={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
                   (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
                   if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { 
                     onDropFiles(Array.from(e.dataTransfer.files));
                   }
                }}
              >
                 <Upload size={40} className="dz-icon" />
                 <p className="dz-title">Drop files here or click to browse</p> 
                 <p className="dz-sub">Any video or audio format &mdash; multiple files supported</p>
              </div>
            </div>

            {/* Media Info */}
            <div className="card meta-card">
              <div className="card-header">
                <span className="card-title">
                  <BarChart size={12} style={{marginRight: 6}} /> Media Info    
                </span>
                <div className="info-tabs tab-pill" style={{ display: 'flex', gap: '2px' }}>
                  <button className={`info-tab-btn tp-btn ${infoTab === 'info' ? 'active' : ''}`} onClick={() => setInfoTab('info')} style={{border:'none', cursor:'pointer', padding: '4px 10px', fontSize: '.7rem', background: infoTab === 'info' ? 'var(--accent-primary)' : 'transparent', color: infoTab === 'info' ? 'var(--accent-primary-fg)' : 'inherit', borderRadius: '4px'}}>Info</button>
                  <button className={`info-tab-btn tp-btn ${infoTab === 'preview' ? 'active' : ''}`} onClick={() => setInfoTab('preview')} style={{border:'none', cursor:'pointer', padding: '4px 10px', fontSize: '.7rem', background: infoTab === 'preview' ? 'var(--accent-primary)' : 'transparent', color: infoTab === 'preview' ? 'var(--accent-primary-fg)' : 'inherit', borderRadius: '4px'}}>Preview</button>
                </div>
              </div>
              <div style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100% - 37px)', minHeight: '150px' }}>
                {!mediaInfo ? (
                   <div className="media-info-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}> 
                     <Film size={36} className="mi-icon" style={{ opacity: 0.5, marginBottom: '10px' }} />
                     <p style={{ margin: 0, opacity: 0.7 }}>Drop a file to inspect</p>
                   </div>
                ) : infoTab === 'preview' ? (
                   <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#000', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                     {activeItem?.previewUrl ? (
                       activeItem.name.match(/\.(mp3|wav|ogg|flac|m4a|aac)$/i) ? (
                         <audio key={activeItem.previewUrl} controls src={activeItem.previewUrl} style={{ width: '80%' }} /> 
                       ) : activeItem.name.match(/\.(mp4|webm|mov)$/i) ? (
                         <video key={activeItem.previewUrl} controls src={activeItem.previewUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> 
                       ) : (
                         <div style={{ padding: '20px', color: '#999', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                           <ImageIcon size={32} style={{ opacity: 0.5 }} />
                           <span>Browser preview is not supported for <strong>.{activeItem.name.split('.').pop()?.toUpperCase()}</strong> formats.</span>
                         </div>
                       )
                     ) : <span style={{ color: '#999' }}>No local preview</span>}
                   </div>
                ) : (
                   <div className="parsed-media-info" style={{ padding: '16px', fontSize: '0.78rem', flex: 1, overflowY: 'auto' }}>
                     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                       {mediaInfo.format_name && <div style={{gridColumn: '1 / -1'}}><strong>Format:</strong> {mediaInfo.format_name.split(',')[0]}</div>}
                         {mediaInfo.duration && (
                           <div>
                             <strong>Duration:</strong>{' '}
                             {mediaInfo.duration >= 3600
                               ? `${Math.floor(mediaInfo.duration / 3600)}h ${Math.floor((mediaInfo.duration % 3600) / 60)}m`
                               : mediaInfo.duration >= 60
                                 ? `${Math.floor(mediaInfo.duration / 60)}m ${Math.round(mediaInfo.duration % 60)}s`
                                 : `${Math.round(mediaInfo.duration)}s`}
                           </div>
                         )}
                       {mediaInfo.size_mb && <div><strong>Size:</strong> {mediaInfo.size_mb} MB</div>}
                       {mediaInfo.bitrate_kbps && <div><strong>Bitrate:</strong> {mediaInfo.bitrate_kbps} kbps</div>}

                       {mediaInfo.video_codec && (
                         <>
                           <div style={{ gridColumn: '1 / -1', marginTop: '4px', borderBottom: '1px solid var(--border-light)', paddingBottom: '4px', opacity: 0.7 }}><strong>Video Stream</strong></div>
                           <div><strong>Codec:</strong> {mediaInfo.video_codec.toUpperCase()}</div>
                           {mediaInfo.width && <div><strong>Res:</strong> {mediaInfo.width}x{mediaInfo.height}</div>}
                           {mediaInfo.fps && <div><strong>FPS:</strong> {Math.round(mediaInfo.fps)}</div>}
                         </>
                       )}

                       {mediaInfo.audio_codec && (
                         <>
                           <div style={{ gridColumn: '1 / -1', marginTop: '4px', borderBottom: '1px solid var(--border-light)', paddingBottom: '4px', opacity: 0.7 }}><strong>Audio Stream</strong></div>
                           <div><strong>Codec:</strong> {mediaInfo.audio_codec.toUpperCase()}</div>
                           {mediaInfo.sample_rate && <div><strong>Sample Rate:</strong> {mediaInfo.sample_rate} Hz</div>}
                           {mediaInfo.channels && <div><strong>Channels:</strong> {mediaInfo.channels === 2 ? 'Stereo' : (mediaInfo.channels === 1 ? 'Mono' : mediaInfo.channels)}</div>}
                         </>
                       )}
                       
                       {(activeMode === 'video' && mediaInfo.audio_codec && !mediaInfo.video_codec) && (
                         <div style={{ gridColumn: '1 / -1', marginTop: '12px', padding: '10px', background: 'var(--bg-warning, rgba(200, 100, 0, 0.1))', border: '1px solid var(--border-warning, rgba(200, 100, 0, 0.3))', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                           <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-warning, #e67e22)' }}>
                             <AlertCircle size={14} /> <strong>Mode Mismatch</strong>
                           </div>
                           <span style={{ opacity: 0.8 }}>Audio-only file detected while in Video mode. Converting this will likely fail.</span>
                           <button className="btn btn-secondary btn-sm" onClick={() => { setActiveMode('audio'); handleUpdate({ mode: 'audio', fmt: 'mp3', vc: undefined, ac: undefined }); setActiveTab('format'); }}>Switch to Audio Mode</button>
                         </div>
                       )}
                     </div>
                   </div>
                )}
              </div>
            </div>
          </div>

          <div className="card batch-card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '200px' }}>
            <div className="card-header">
              <span className="card-title">
                <List size={12} style={{marginRight: 6}} /> Batch Queue
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="text-muted" style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{queue.length} files</span>
                <button className="btn btn-secondary btn-sm" onClick={onAddFiles}>
                  <Plus size={12} style={{marginRight: 4}} /> Add
                </button>
              </div>
            </div>
            <div className="queue-list" style={{ padding: '10px', flex: 1, overflowY: 'auto' }}>
              {queue.length === 0 ? (
                <div className="queue-empty">Drop files above to add them to the queue</div>
              ) : (
                queue.map((item, index) => (
                  <div key={item.id} className={`queue-item ${activeFileId === item.id ? 'active' : ''}`} onClick={() => setActiveFileId(item.id)}>
                    <div className="qi-status"><Film size={14} /></div>
                    <div className="qi-info">
                      <div className="qi-name">{item.name}</div>
                      <div className="qi-sub">{item.path || 'Local File'}</div> 
                    </div>
                    <div className="qi-actions">
                      <button className="btn-icon btn-ghost" onClick={(e) => {  
                        e.stopPropagation();
                        setQueue(old => old.filter(i => i.id !== item.id));     
                        if (activeFileId === item.id) setActiveFileId(null);    
                      }} style={{border:'none', background:'transparent', cursor:'pointer' }}>
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Terminal Toggle */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 20px', flexShrink: 0, marginTop: '-4px', background: 'transparent' }}>
          <button 
            className="btn btn-ghost" 
            style={{ fontSize: '0.75rem', padding: '4px 10px', opacity: 0.7 }}
            onClick={() => setShowLogs(!showLogs)}
          >
            <BarChart size={12} style={{marginRight: 4}} /> {showLogs ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>

        {/* Terminal */}
        {showLogs && (
          <div className="terminal-dock" style={{ transition: 'all 0.2s ease', borderTop: 'none', background: 'transparent', padding: '0 20px 20px 20px' }}>
            <TerminalOutput logs={terminalLogs} title="FFmpeg Log Console" />
          </div>
        )}
      </div>

      {/* ── Sidebar ── */}
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="sidebar-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div className="main-toggle-wrap" style={{ margin: '0 auto 16px auto', maxWidth: '240px', flexShrink: 0 }}>
            <div className="segment-group" style={{ width: '100%', display: 'flex' }}>
              <button
                style={{ flex: '1 1 0', justifyContent: 'center' }}
                className={`seg-btn ${activeMode === 'video' ? 'active' : ''}`}   
                onClick={() => {
                  setActiveMode('video');
                  handleUpdate({ mode: 'convert', fmt: 'mp4', vc: 'libx264', ac: 'aac' });
                  setActiveTab('format');
                }}
              >
                <Film size={14} style={{marginRight: 4}} /> Video
              </button>
              <button
                style={{ flex: '1 1 0', justifyContent: 'center' }}
                className={`seg-btn ${activeMode === 'audio' ? 'active' : ''}`}   
                onClick={() => {
                  setActiveMode('audio');
                  handleUpdate({ mode: 'audio', fmt: 'mp3', vc: undefined, ac: undefined });
                  setActiveTab('format');
                }}
              >
                <Music size={14} style={{marginRight: 4}} /> Audio
              </button>
            </div>
          </div>

          {activeMode === 'video' && (
          <div className="mode-bar" style={{ margin: 0, justifyContent: 'center', flexShrink: 0 }}>
            <button
              className={`mode-btn ${options.mode === 'convert' ? 'active' : ''}`}  
              onClick={() => { handleUpdate({ mode: 'convert' }); setActiveTab('format'); }}
            >
              <Film size={14} /> Normal
            </button>
            <button
              className={`mode-btn ${options.mode === 'remux' ? 'active' : ''}`}    
              onClick={() => { handleUpdate({ mode: 'remux' }); setActiveTab('format'); }}
            >
              <Package size={14} /> Remux
            </button>
            <button
              className={`mode-btn ${options.mode === 'thumbnail' ? 'active' : ''}`}

              onClick={() => { handleUpdate({ mode: 'thumbnail' }); setActiveTab('format'); }}
            >
              <ImageIcon size={14} /> Thumb
            </button>
            <button
              className={`mode-btn ${options.mode === 'merge' ? 'active' : ''}`}    
              onClick={() => { handleUpdate({ mode: 'merge' }); setActiveTab('format'); }}
            >
              <Layers size={14} /> Merge
            </button>
          </div>
          )}

          <div className="presets-bar" style={{ margin: '0 0 16px 0', flexDirection: 'column', alignItems: 'flex-start', border: 'none', padding: '0 4px', background: 'transparent', flexShrink: 0 }}>
            {activeMode === 'video' ? (
            <>
              <span className="presets-label" style={{ marginBottom: '8px', opacity: 0.6 }}>Quick Presets</span>
              <div className="presets-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
                <button className={`preset-btn ${isPresetActive({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '23' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '23' });
                }}><Film size={12}/> TikTok / IG</button>
                <button className={`preset-btn ${isPresetActive({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '20' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '20' });
                }}><Film size={12}/> YouTube</button>
                <button className={`preset-btn ${isPresetActive({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '32' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '32' });
                }}><Film size={12}/> Discord &lt;8MB</button>
                <button className={`preset-btn ${isPresetActive({ mode: 'convert', fmt: 'mkv', vc: 'libx265', crf: '24' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'convert', fmt: 'mkv', vc: 'libx265', crf: '24' });
                }}><Archive size={12}/> Archival MKV</button>
              </div>
            </>
            ) : (
            <>
              <span className="presets-label" style={{ marginBottom: '8px', opacity: 0.6 }}>Audio Presets</span>
              <div className="presets-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
                <button className={`preset-btn ${isPresetActive({ mode: 'audio', fmt: 'mp3', ab: '320k' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'audio', fmt: 'mp3', ab: '320k' });
                }}><Music size={12}/> HQ MP3</button>
                <button className={`preset-btn ${isPresetActive({ mode: 'audio', fmt: 'm4a', ac: 'aac', ab: '256k' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'audio', fmt: 'm4a', ac: 'aac', ab: '256k' });
                }}><Music size={12}/> Apple AAC</button>
                <button className={`preset-btn ${isPresetActive({ mode: 'audio', fmt: 'ogg', ac: 'libopus', ab: '64k' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'audio', fmt: 'ogg', ac: 'libopus', ab: '64k' });
                }}><Music size={12}/> Voice (Opus)</button>
                <button className={`preset-btn ${isPresetActive({ mode: 'audio', fmt: 'wav', ac: 'pcm_s16le' }) ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'audio', fmt: 'wav', ac: 'pcm_s16le' });    
                }}><Music size={12}/> Lossless WAV</button>
              </div>
            </>
            )}
          </div>

          <div id="settings-container" style={{ margin: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="settings-tabs" style={{ flexShrink: 0 }}>
              <button className={`tab-btn ${activeTab === 'format' ? 'active' : ''}`} onClick={() => setActiveTab('format')}>Format</button>
              {(activeMode === 'video' && ['convert', 'remux'].includes(options.mode)) && (
                 <button className={`tab-btn ${activeTab === 'quality' ? 'active' : ''}`} onClick={() => setActiveTab('quality')}>Quality</button>
              )}
              {(activeMode === 'video' && options.mode === 'convert') && (
                 <button className={`tab-btn ${activeTab === 'filters' ? 'active' : ''}`} onClick={() => setActiveTab('filters')}>Filters</button>
              )}
              {(options.mode === 'convert' || options.mode === 'audio') && (        
                 <button className={`tab-btn ${activeTab === 'audio' ? 'active' : ''}`} onClick={() => setActiveTab('audio')}>Audio</button>
              )}
              {(activeMode === 'video' && options.mode === 'convert') && (
                 <button className={`tab-btn ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>Adv.</button>
              )}
            </div>

            <div className="settings-panel" style={{ flex: 1, overflowY: 'auto' }}>
              {activeTab === 'format' && (
                <div className="settings-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <Select 
                    label="Format" 
                    value={options.fmt || ''} 
                    onChange={e => handleUpdate({ fmt: e.target.value })} 
                    options={activeMode === 'video' 
                      ? [{label: 'MP4', value: 'mp4'}, {label: 'MKV', value: 'mkv'}, {label: 'WebM', value: 'webm'}, {label: 'AVI', value: 'avi'}, {label: 'MOV', value: 'mov'}, {label: 'GIF', value: 'gif'}]
                      : [{label: 'MP3', value: 'mp3'}, {label: 'M4A', value: 'm4a'}, {label: 'OGG', value: 'ogg'}, {label: 'WAV', value: 'wav'}, {label: 'FLAC', value: 'flac'}]}
                  />
                  {activeMode === 'video' && options.mode !== 'remux' && (
                    <>
                      <Select 
                        label="Video Codec" 
                        value={options.vc || ''} 
                        onChange={e => handleUpdate({ vc: e.target.value })} 
                        options={[{label: 'H.264 (libx264)', value: 'libx264'}, {label: 'H.265 (libx265)', value: 'libx265'}, {label: 'VP9', value: 'libvpx-vp9'}, {label: 'Copy (No Re-encode)', value: 'copy'}]}
                      />
                      <Select 
                        label="Hardware Accel" 
                        value={options.hwaccel || 'none'} 
                        onChange={e => handleUpdate({ hwaccel: e.target.value as any })} 
                        options={[{label: 'None / CPU', value: 'none'}, {label: 'NVIDIA (CUDA)', value: 'cuda'}, {label: 'Intel (QSV)', value: 'qsv'}]}
                      />
                    </>
                  )}
                  {options.mode !== 'remux' && (
                    <Select 
                      label="Audio Codec" 
                      value={options.ac || ''} 
                      onChange={e => handleUpdate({ ac: e.target.value })} 
                      options={activeMode === 'video'
                        ? [{label: 'AAC', value: 'aac'}, {label: 'MP3', value: 'mp3'}, {label: 'Opus', value: 'opus'}, {label: 'Copy', value: 'copy'}]
                        : [{label: 'MP3 (libmp3lame)', value: 'mp3'}, {label: 'AAC', value: 'aac'}, {label: 'Opus', value: 'libopus'}, {label: 'WAV (pcm_s16le)', value: 'pcm_s16le'}, {label: 'FLAC', value: 'flac'}, {label: 'Copy', value: 'copy'}]}
                    />
                  )}
                </div>
              )}

              {activeTab === 'quality' && (
                <div className="settings-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <Select 
                    label="Resolution" 
                    value={options.res || 'original'} 
                    onChange={e => handleUpdate({ res: e.target.value })} 
                    options={[{label: 'Original', value: 'original'}, {label: '4K (2160p)', value: '4k'}, {label: '1080p', value: '1080p'}, {label: '720p', value: '720p'}, {label: '480p', value: '480p'}, {label: '360p', value: '360p'}]}
                  />
                  <Select 
                    label="Framerate" 
                    value={options.fps || 'original'} 
                    onChange={e => handleUpdate({ fps: e.target.value })} 
                    options={[{label: 'Original', value: 'original'}, {label: '24', value: '24'}, {label: '25', value: '25'}, {label: '30', value: '30'}, {label: '60', value: '60'}]}
                  />
                  <div className="setting-row">
                    <Slider 
                      label="Constant Rate Factor (CRF)" 
                      min="0" max="51" step="1" 
                      value={options.crf || '23'} 
                      valueDisplay={`${options.crf || '23'} (Lower = Better)`}
                      onChange={e => handleUpdate({ crf: e.target.value })} 
                    />
                  </div>
                  <Select 
                    label="Preset" 
                    value={options.preset || ''} 
                    onChange={e => handleUpdate({ preset: e.target.value })} 
                    options={[{label: 'Medium (Default)', value: ''}, {label: 'Ultrafast', value: 'ultrafast'}, {label: 'Superfast', value: 'superfast'}, {label: 'Veryfast', value: 'veryfast'}, {label: 'Faster', value: 'faster'}, {label: 'Fast', value: 'fast'}, {label: 'Slow', value: 'slow'}, {label: 'Slower', value: 'slower'}, {label: 'Veryslow', value: 'veryslow'}]}
                  />
                </div>
              )}

              {activeTab === 'filters' && (
                <div className="settings-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <Select 
                    label="Rotate" 
                    value={options.rotate || ''} 
                    onChange={e => handleUpdate({ rotate: e.target.value })} 
                    options={[{label: 'None', value: ''}, {label: '90° Clockwise', value: 'cw90'}, {label: '90° Counter-CW', value: 'ccw90'}, {label: '180°', value: '180'}, {label: 'Flip Horizontal', value: 'fliph'}, {label: 'Flip Vertical', value: 'flipv'}]}
                  />
                  <div className="setting-row">
                    <Slider 
                      label="Speed Multiplier" 
                      min="0.25" max="4.0" step="0.25" 
                      value={options.speed || 1.0} 
                      valueDisplay={`${options.speed || 1.0}x`}
                      onChange={e => handleUpdate({ speed: parseFloat(e.target.value) })} 
                    />
                  </div>
                  
                  <div className="checkbox-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.deint || false} onChange={e => handleUpdate({ deint: e.target.checked })} /> Deinterlace
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.gray || false} onChange={e => handleUpdate({ gray: e.target.checked })} /> Grayscale
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.den || false} onChange={e => handleUpdate({ den: e.target.checked })} /> Denoise
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.sharp || false} onChange={e => handleUpdate({ sharp: e.target.checked })} /> Sharpen
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'audio' && (
                <div className="settings-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <Select 
                    label="Audio Bitrate" 
                    value={options.ab || ''} 
                    onChange={e => handleUpdate({ ab: e.target.value })} 
                    options={[{label: 'Auto', value: ''}, {label: '64 kbps', value: '64k'}, {label: '128 kbps', value: '128k'}, {label: '192 kbps', value: '192k'}, {label: '256 kbps', value: '256k'}, {label: '320 kbps', value: '320k'}]}
                  />
                  <Select 
                    label="Sample Rate" 
                    value={options.sr || ''} 
                    onChange={e => handleUpdate({ sr: e.target.value })} 
                    options={[{label: 'Auto', value: ''}, {label: '44100 Hz', value: '44100'}, {label: '48000 Hz', value: '48000'}, {label: '96000 Hz', value: '96000'}]}
                  />
                  <Select 
                    label="Channels" 
                    value={options.ch || ''} 
                    onChange={e => handleUpdate({ ch: e.target.value })} 
                    options={[{label: 'Auto', value: ''}, {label: 'Mono (1)', value: '1'}, {label: 'Stereo (2)', value: '2'}, {label: '5.1 Surround (6)', value: '6'}]}
                  />
                  <div className="setting-row">
                    <Slider 
                      label="Volume Multiplier" 
                      min="0" max="2.0" step="0.1" 
                      value={options.vol !== undefined ? options.vol : 1.0} 
                      valueDisplay={`${options.vol !== undefined ? options.vol : 1.0}x`}
                      onChange={e => handleUpdate({ vol: parseFloat(e.target.value) })} 
                    />
                  </div>
                  
                  <div className="checkbox-group" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginTop: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.norm || false} onChange={e => handleUpdate({ norm: e.target.checked })} /> Normalize Audio (Loudnorm)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.noAudio || false} onChange={e => handleUpdate({ noAudio: e.target.checked })} /> Remove Audio entirely
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="settings-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="checkbox-group" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.webOpt || false} onChange={e => handleUpdate({ webOpt: e.target.checked })} /> Web Optimize (Faststart)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={options.noMeta || false} onChange={e => handleUpdate({ noMeta: e.target.checked })} /> Remove Metadata
                    </label>
                  </div>
                  
                  <Select 
                    label="Threads" 
                    value={options.threads || 'auto'} 
                    onChange={e => handleUpdate({ threads: e.target.value })} 
                    options={[{label: 'Auto', value: 'auto'}, {label: '1', value: '1'}, {label: '2', value: '2'}, {label: '4', value: '4'}, {label: '8', value: '8'}, {label: '16', value: '16'}]}
                  />
                  
                  <div className="setting-row">
                    <label style={{ display: 'block', fontSize: '.75rem', fontWeight: 600, color: 'var(--text-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Custom Arguments</label>
                    <input 
                      type="text" 
                      value={options.custom || ''} 
                      onChange={e => handleUpdate({ custom: e.target.value })} 
                      placeholder="e.g. -bufsize 2M"
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)', fontSize: '.8rem' }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="sidebar-footer" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-card)', padding: '16px', position: 'sticky', bottom: 0, zIndex: 10 }}>
          {isProcessing && (
             <button className="btn btn-secondary" style={{ width: '100%', padding: '10px' }} onClick={onCancel}>     
               <StopCircle size={16} /> Stop Task
             </button>
          )}
          <button 
            id="convert-btn" 
            className="btn btn-primary" 
            style={{ width: '100%', padding: '12px' }} 
            onClick={() => onExecute(options, activeItem, queue)} 
            disabled={isProcessing || queue.length === 0}
          >
            <Play size={16} /> {isProcessing ? "Processing..." : "Convert"}
          </button>
        </div>
      </aside>

      {/* Global Non-intrusive Toast */}
      {showToast && (
        <div style={{
          position: 'fixed',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--success)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '999px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          zIndex: 9999,
          fontWeight: 600,
          fontSize: '0.9rem',
          animation: 'toastSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}>
          <CheckCircle size={18} />
          Processing Complete!
          
          <style>{`
            @keyframes toastSlideUp {
              0% { opacity: 0; transform: translate(-50%, 30px); }
              100% { opacity: 1; transform: translate(-50%, 0); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
