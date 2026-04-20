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
    <div className="app-container">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-brand" style={{ marginLeft: '10px' }}>
          FFmpeg Web UI
        </div>

        <div className="main-toggle-wrap">
          <div className="segment-group">
            <button 
              className={`seg-btn ${activeMode === 'video' ? 'active' : ''}`}
              onClick={() => setActiveMode('video')}
            >
              <Film size={14} style={{marginRight: 6}} /> Video
            </button>
            <button 
              className={`seg-btn ${activeMode === 'audio' ? 'active' : ''}`}
              onClick={() => setActiveMode('audio')}
            >
              <Music size={14} style={{marginRight: 6}} /> Audio
            </button>
          </div>
        </div>

        <div className="header-right">
          {capabilities ? (
            <span className="cap-badge">
              {capabilities.version}
            </span>
          ) : (
            <button className="btn btn-ghost" onClick={onDownloadEngine} disabled={isDownloadingEngine}>
              <Layers size={14} style={{marginRight: 6}} /> 
              Install FFmpeg
            </button>
          )}
          <button className="btn btn-ghost" title="Toggle theme" style={{ padding: '6px' }}>
            <Sun size={16} />
          </button>
        </div>
      </header>

      {/* ── Top Grid: Drop Zone + Queue | Media Info ── */}
      <div className="top-grid">
        <div className="left-panel">
          {/* Drop Zone */}
          <div className="card">
            <div className="drop-zone" onClick={onAddFiles}>
               <Upload size={40} className="dz-icon" />
               <p className="dz-title">Drop files here or click to browse</p>
               <p className="dz-sub">Any video or audio format &mdash; multiple files supported</p>
               <div style={{ position: 'absolute', inset: 0, opacity: 0 }}>
                 <Dropzone onFileSelect={(f) => onDropFiles([f])} accept="video/*, audio/*" />
               </div>
            </div>
          </div>

          {/* Queue */}
          <div className="card batch-card">
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
            <div className="queue-list" style={{ padding: '10px' }}>
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
          <div style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100% - 37px)' }}>
            {!mediaInfo ? (
               <div className="media-info-empty" style={{ flex: 1 }}>
                 <Film size={36} className="mi-icon" />
                 <p>Drop a file to inspect</p>
               </div>
            ) : (
               <div style={{ padding: '16px', fontSize: '0.73rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', flex: 1, overflowY: 'auto' }}>
                 {JSON.stringify(mediaInfo, null, 2)}
               </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sub Mode Bar ── */}
      <div className="mode-bar">
        <button className={`mode-btn ${subMode === 'remux' ? 'active' : ''}`} onClick={() => setSubMode('remux')}>
          <Package size={14} /> Remux
        </button>
        <button className={`mode-btn ${subMode === 'thumbnail' ? 'active' : ''}`} onClick={() => setSubMode('thumbnail')}>
          <ImageIcon size={14} /> Thumbnail
        </button>
        <button className={`mode-btn ${subMode === 'merge' ? 'active' : ''}`} onClick={() => setSubMode('merge')}>
          <Layers size={14} /> Merge
        </button>
      </div>

      {/* ── Presets Bar ── */}
      <div className="presets-bar">
        <span className="presets-label">Quick Presets</span>
        <div className="presets-group">
          <button className="preset-btn" onClick={() => {
            handleUpdate({ fmt: 'mp4', vc: 'libx264' });
          }}><Film size={12}/> TikTok</button>
          <button className="preset-btn" onClick={() => {
            handleUpdate({ fmt: 'mp4', vc: 'libx264' });
          }}><Film size={12}/> Instagram</button>
          <button className="preset-btn" onClick={() => {
            handleUpdate({ fmt: 'mp4', vc: 'libx264' });
          }}><Film size={12}/> YouTube</button>
          <button className="preset-btn" onClick={() => {
            handleUpdate({ fmt: 'mp4', vc: 'libx264' });
          }}><Film size={12}/> Twitter / X</button>
          <button className="preset-btn" onClick={() => {
            handleUpdate({ fmt: 'mp4', vc: 'libx264', crf: '32' });
          }}><Film size={12}/> Discord &lt;8MB</button>
          <button className="preset-btn" onClick={() => {
            handleUpdate({ fmt: 'mp4', vc: 'libx264' });
          }}><Film size={12}/> WhatsApp</button>
        </div>
      </div>

      {/* ── Settings Container ── */}
      <div id="settings-container" style={{ marginTop: '14px' }}>
        <div className="settings-tabs">
          <button className={`tab-btn ${activeTab === 'format' ? 'active' : ''}`} onClick={() => setActiveTab('format')}>Output Format</button>
          <button className={`tab-btn ${activeTab === 'quality' ? 'active' : ''}`} onClick={() => setActiveTab('quality')}>Quality</button>
          <button className={`tab-btn ${activeTab === 'filters' ? 'active' : ''}`} onClick={() => setActiveTab('filters')}>Filters</button>
          <button className={`tab-btn ${activeTab === 'audio' ? 'active' : ''}`} onClick={() => setActiveTab('audio')}>Audio</button>
          <button className={`tab-btn ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>Advanced</button>
        </div>

        <div className="settings-panel">
          {activeTab === 'format' && (
            <>
              <div className="sg">
                <span className="sg-label">Container</span>
                <div className="sg-row">
                  <div className="sg-field" style={{ maxWidth: '220px' }}>
                    <select value={options.fmt || 'mp4'} onChange={(e) => handleUpdate({ fmt: e.target.value })}>
                      <option value="mp4">MP4 — Universal</option>
                      <option value="mkv">MKV — Archival</option>
                      <option value="webm">WebM — Open Web</option>
                      <option value="mov">MOV — Apple / Edit</option>
                    </select>
                  </div>
                  <label className="chk-label web-optimize-wrap">
                    <input type="checkbox" checked={true} readOnly /> Web Optimize (faststart, MP4 only)
                  </label>
                </div>
              </div>

              <div className="sg">
                <span className="sg-label">Video Engine</span>
                <div className="codec-group">
                  <label className={`codec-item ${options.vc === 'libx264' || !options.vc ? 'active' : ''}`}>
                    <input type="radio" name="vcodec" checked={options.vc === 'libx264' || !options.vc} onChange={() => handleUpdate({ vc: 'libx264' })} />
                    <div>
                      <div className="ci-label">Standard (Most Compatible)</div>
                      <div className="ci-desc">H.264 — plays on 99% of devices</div>
                    </div>
                    <span className="cap-badge" style={{ marginLeft: 'auto' }}>Available</span>
                  </label>
                  <label className={`codec-item ${options.vc === 'libx265' ? 'active' : ''}`}>
                    <input type="radio" name="vcodec" checked={options.vc === 'libx265'} onChange={() => handleUpdate({ vc: 'libx265' })} />
                    <div>
                      <div className="ci-label">High Efficiency (Modern)</div>
                      <div className="ci-desc">H.265 — ~50% smaller than H.264</div>
                    </div>
                    <span className="cap-badge" style={{ marginLeft: 'auto' }}>Available</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {activeTab === 'quality' && (
             <div className="settings-panel">
               <div className="sg">
                 <span className="sg-label">Quality (CRF) — lower value = higher quality</span>
                 <div className="range-wrap">
                   <span className="range-lbl">28<br/><span style={{fontSize:'.6rem',opacity:.6}}>Small</span></span>
                   <input type="range" min="0" max="51" value={options.crf || '23'} onChange={(e) => handleUpdate({ crf: e.target.value })} />
                   <span className="range-lbl">18<br/><span style={{fontSize:'.6rem',opacity:.6}}>High</span></span>
                 </div>
                 <p style={{fontSize:'.71rem',color:'var(--text-2)',marginTop:'6px'}}>CRF: <strong>{options.crf || '23'}</strong> (default 23)</p>
               </div>

               <div className="sg sg-row">
                 <div className="sg-field">
                   <label className="sg-label">Video Bitrate (kbps) — overrides CRF</label>
                   <input type="number" placeholder="e.g. 4000 (optional)" value={options.vbr || ''} onChange={(e) => handleUpdate({ vbr: e.target.value })} />
                 </div>
                 <div className="sg-field">
                   <label className="sg-label">Audio Bitrate</label>
                   <select value={options.ab || '128k'} onChange={(e) => handleUpdate({ ab: e.target.value })}>
                     <option value="64k">64 kbps</option>
                     <option value="128k">128 kbps</option>
                     <option value="192k">192 kbps</option>
                     <option value="256k">256 kbps</option>
                     <option value="320k">320 kbps (Max)</option>
                   </select>
                 </div>
               </div>

               <div className="sg sg-row">
                 <div className="sg-field">
                   <label className="sg-label">Resolution</label>
                   <select value={options.res || 'original'} onChange={(e) => handleUpdate({ res: e.target.value })}>
                     <option value="original">Original (no change)</option>
                     <option value="4k">4K (3840 px)</option>
                     <option value="1080p">1080p</option>
                     <option value="720p">720p</option>
                     <option value="480p">480p</option>
                     <option value="360p">360p</option>
                   </select>
                 </div>
                 <div className="sg-field">
                   <label className="sg-label">Target File Size (MB) — triggers 2-pass</label>
                   <input type="number" placeholder="e.g. 50 (optional)" value={options.tsz || ''} onChange={(e) => handleUpdate({ tsz: e.target.value })} />
                 </div>
               </div>
             </div>
          )}
          {activeTab === 'filters' && (
             <div className="settings-panel">
               <div className="sg">
                 <span className="sg-label">Visual Trim</span>
                 <div className="sg-row" style={{ marginTop: '10px' }}>
                   <div className="sg-field">
                     <label className="sg-label">Start Time</label>
                     <input type="text" placeholder="HH:MM:SS (blank = from start)" value={options.ts_start || ''} onChange={(e) => handleUpdate({ ts_start: e.target.value })} />
                   </div>
                   <div className="sg-field">
                     <label className="sg-label">End Time</label>
                     <input type="text" placeholder="HH:MM:SS (blank = to end)" value={options.ts_end || ''} onChange={(e) => handleUpdate({ ts_end: e.target.value })} />
                   </div>
                 </div>
               </div>

               <div className="sg">
                 <span className="sg-label">Speed</span>
                 <div className="speed-group">
                   {[0.25, 0.5, 1, 1.5, 2].map(s => (
                     <button key={s} className={`speed-btn ${options.speed === s || (!options.speed && s === 1) ? 'active' : ''}`} onClick={() => handleUpdate({ speed: s })}>
                       {s}×
                     </button>
                   ))}
                 </div>
               </div>

               <div className="sg">
                 <span className="sg-label">Video Filters</span>
                 <div className="check-group">
                   <label className="chk-label"><input type="checkbox" checked={options.deint || false} onChange={(e) => handleUpdate({ deint: e.target.checked })} /> Deinterlace (yadif)</label>
                   <label className="chk-label"><input type="checkbox" checked={options.gray || false} onChange={(e) => handleUpdate({ gray: e.target.checked })} /> Grayscale</label>
                   <label className="chk-label"><input type="checkbox" checked={options.den || false} onChange={(e) => handleUpdate({ den: e.target.checked })} /> Denoise</label>
                   <label className="chk-label"><input type="checkbox" checked={options.sharp || false} onChange={(e) => handleUpdate({ sharp: e.target.checked })} /> Sharpen</label>
                 </div>
               </div>
             </div>
          )}
          {activeTab === 'audio' && (
             <div className="settings-panel">
               <div className="sg sg-row">
                 <div className="sg-field">
                   <label className="sg-label">Audio Codec</label>
                   <select value={options.ac || 'aac'} onChange={(e) => handleUpdate({ ac: e.target.value })}>
                     <option value="aac">AAC (default)</option>
                     <option value="libmp3lame">MP3</option>
                     <option value="libopus">Opus</option>
                     <option value="flac">FLAC (lossless)</option>
                     <option value="copy">Copy (passthrough)</option>
                   </select>
                 </div>
                 <div className="sg-field">
                   <label className="sg-label">Sample Rate</label>
                   <select value={options.sr || ''} onChange={(e) => handleUpdate({ sr: e.target.value })}>
                     <option value="">Original</option>
                     <option value="22050">22050 Hz</option>
                     <option value="44100">44100 Hz (CD)</option>
                     <option value="48000">48000 Hz (DVD)</option>
                   </select>
                 </div>
                 <div className="sg-field">
                   <label className="sg-label">Channels</label>
                   <select value={options.ch || ''} onChange={(e) => handleUpdate({ ch: e.target.value })}>
                     <option value="">Original</option>
                     <option value="1">Mono</option>
                     <option value="2">Stereo</option>
                     <option value="6">5.1 Surround</option>
                   </select>
                 </div>
               </div>

               <div className="sg">
                 <label className="sg-label">Volume — <span>{Math.round((options.vol ?? 1) * 100)}%</span></label>
                 <div className="range-wrap">
                   <span className="range-lbl">0%</span>
                   <input type="range" min="0" max="3" step="0.05" value={options.vol ?? 1.0} onChange={(e) => handleUpdate({ vol: parseFloat(e.target.value) })} />
                   <span className="range-lbl">300%</span>
                 </div>
               </div>

               <div className="sg">
                 <div className="check-group">
                   <label className="chk-label"><input type="checkbox" checked={options.norm || false} onChange={(e) => handleUpdate({ norm: e.target.checked })} /> Normalize Loudness (loudnorm)</label>
                   <label className="chk-label"><input type="checkbox" checked={options.noAudio || false} onChange={(e) => handleUpdate({ noAudio: e.target.checked })} /> Remove Audio (-an)</label>
                 </div>
               </div>
             </div>
          )}
          {activeTab === 'advanced' && (
             <div className="settings-panel">
               <div className="sg sg-row">
                 <div className="sg-field">
                   <label className="sg-label">Encoding Speed (Preset)</label>
                   <select value={options.preset || 'medium'} onChange={(e) => handleUpdate({ preset: e.target.value })}>
                     <option value="veryslow">Very Slow (best quality)</option>
                     <option value="slow">Slow</option>
                     <option value="medium">Medium (balanced)</option>
                     <option value="fast">Fast</option>
                     <option value="ultrafast">Ultra Fast</option>
                   </select>
                 </div>
                 <div className="sg-field">
                   <label className="sg-label">Frame Rate</label>
                   <select value={options.fps || ''} onChange={(e) => handleUpdate({ fps: e.target.value })}>
                     <option value="">Original</option>
                     <option value="24">24</option>
                     <option value="30">30</option>
                     <option value="60">60</option>
                   </select>
                 </div>
                 <div className="sg-field">
                   <label className="sg-label">Pixel Format</label>
                   <select value={options.pixFmt || 'yuv420p'} onChange={(e) => handleUpdate({ pixFmt: e.target.value })}>
                     <option value="yuv420p">yuv420p (most compatible)</option>
                     <option value="yuv422p">yuv422p</option>
                     <option value="yuv444p">yuv444p</option>
                   </select>
                 </div>
               </div>

               <div className="sg">
                 <div className="check-group">
                   <label className="chk-label"><input type="checkbox" checked={options.noMeta || false} onChange={(e) => handleUpdate({ noMeta: e.target.checked })} /> Strip all metadata</label>
                 </div>
               </div>
               
               <div className="sg">
                 <label className="sg-label">Custom FFmpeg Arguments</label>
                 <input type="text" placeholder='-vf eq=brightness=0.1' value={options.custom || ''} onChange={(e) => handleUpdate({ custom: e.target.value })} />
               </div>
             </div>
          )}
        </div>
      </div>

      {/* ── Action Bar ── */}
      <div id="action-bar" className="action-bar">
        {isProcessing && (
           <button className="btn btn-secondary btn-lg" onClick={onCancel}>
             <StopCircle size={16} /> Cancel
           </button>
        )}
        <button id="convert-btn" className="btn btn-primary btn-lg" onClick={() => onExecute(options, activeItem, queue)} disabled={isProcessing || queue.length === 0}>
          <Play size={16} /> {isProcessing ? "Processing..." : "Convert"}
        </button>
      </div>

      {/* ── Progress / Terminal Logs ── */}
      <div style={{ marginTop: '20px' }}>
        <TerminalOutput logs={terminalLogs} title="FFmpeg Log" />
      </div>
      
    </div>
  );
}
