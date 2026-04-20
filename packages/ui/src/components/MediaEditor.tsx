import React, { useState } from 'react';
import { Dropzone } from './Dropzone';
import { TerminalOutput } from './TerminalOutput';
import type { CommandOptions } from '@ffmpeg-ui/core';

import {
  Film, Music, Layers, Sun, Upload, List, Plus, Archive, X,
  BarChart, Package, Image as ImageIcon, AlertCircle, Play, StopCircle, RefreshCw
} from 'lucide-react';

export interface MediaItem {
  id: string;
  name: string;
  path?: string;
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

  const handleUpdate = (updates: Partial<CommandOptions>) => {
    setOptions(prev => ({ ...prev, ...updates }));
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
                const current = document.documentElement.getAttribute('data-theme') || 'dark';
                document.documentElement.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
              }}
            >
              <Sun size={20} />
            </button>
          </div>
        </header>

        <div className="main-scrollable">
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
                  <button className="info-tab-btn active tp-btn" style={{border:'none', cursor:'pointer', padding: '4px 10px', fontSize: '.7rem', background: 'var(--glass-3)', borderRadius: '4px'}}>Info</button>
                  <button className="info-tab-btn tp-btn" style={{border:'none', cursor:'pointer', padding: '4px 10px', fontSize: '.7rem', background: 'transparent'}}>Preview</button>
                </div>
              </div>
              <div style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100% - 37px)', minHeight: '150px' }}>
                {!mediaInfo ? (
                   <div className="media-info-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}> 
                     <Film size={36} className="mi-icon" style={{ opacity: 0.5, marginBottom: '10px' }} />
                     <p style={{ margin: 0, opacity: 0.7 }}>Drop a file to inspect</p>
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
                     </div>
                   </div>
                )}
              </div>
            </div>
          </div>

          <div className="card batch-card" style={{ display: 'flex', flexDirection: 'column' }}>
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

        {/* Terminal */}
        <div className="terminal-dock">
          <TerminalOutput logs={terminalLogs} title="FFmpeg Log Console" />
        </div>
      </div>

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-content">
          <div className="main-toggle-wrap" style={{ margin: '0 auto 16px auto', maxWidth: '240px' }}>
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
          <div className="mode-bar" style={{ margin: 0, justifyContent: 'center' }}>
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

          <div className="presets-bar" style={{ margin: '0 0 16px 0', flexDirection: 'column', alignItems: 'flex-start', border: 'none', padding: '0 4px', background: 'transparent' }}>
            {activeMode === 'video' ? (
            <>
              <span className="presets-label" style={{ marginBottom: '8px', opacity: 0.6 }}>Quick Presets</span>
              <div className="presets-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '23' });
                }}><Film size={12}/> TikTok / IG</button>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '20' });
                }}><Film size={12}/> YouTube</button>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'convert', fmt: 'mp4', vc: 'libx264', crf: '32' });
                }}><Film size={12}/> Discord &lt;8MB</button>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'convert', fmt: 'mkv', vc: 'libx265', crf: '24' });
                }}><Archive size={12}/> Archival MKV</button>
              </div>
            </>
            ) : (
            <>
              <span className="presets-label" style={{ marginBottom: '8px', opacity: 0.6 }}>Audio Presets</span>
              <div className="presets-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                  setActiveTab('format');
                  handleUpdate({ mode: 'audio', fmt: 'mp3', ab: '320k' });
                }}><Music size={12}/> HQ MP3</button>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'audio', fmt: 'm4a', ac: 'aac', ab: '256k' });
                }}><Music size={12}/> Apple AAC</button>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'audio', fmt: 'ogg', ac: 'libopus', ab: '64k' });
                }}><Music size={12}/> Voice (Opus)</button>
                <button className="preset-btn" style={{ justifyContent: 'center' }} onClick={() => {
                   setActiveTab('format');
                   handleUpdate({ mode: 'audio', fmt: 'wav', ac: 'pcm_s16le' });    
                }}><Music size={12}/> Lossless WAV</button>
              </div>
            </>
            )}
          </div>

          <div id="settings-container" style={{ margin: 0, flex: 1 }}>
            <div className="settings-tabs">
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

            <div className="settings-panel">
}        </div>
          </div>
        </div>
        <div className="sidebar-footer">
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
    </div>
  );
}
