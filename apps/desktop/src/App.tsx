import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button, Dropzone, Select, Slider, TerminalOutput } from '@ffmpeg-ui/ui';
import { buildFFmpegArgs, CommandOptions } from '@ffmpeg-ui/core';

export default function App() {
  const [capabilities, setCapabilities] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  
  // FFmpeg config state
  const [options, setOptions] = useState<CommandOptions>({
    mode: 'convert',
    input: '',
    fmt: 'mp4',
    vc: 'libx264',
    ac: 'aac',
    crf: '23',
  });

  useEffect(() => {
    // Check Tauri Rust backend for capabilities
    invoke('get_capabilities').then(res => {
        setCapabilities(res);
        setTerminalLogs(prev => [...prev, `[System] FFmpeg Version: ${(res as any).version}`]);
    }).catch(err => {
      setTerminalLogs(prev => [...prev, `[Error] ${err}`]);
    });
  }, []);

  // Whenever file or options change, calculate the preview command using the Core Builder
  useEffect(() => {
    if (file) {
      // Create a dummy options object with the filename logic 
      const testArgs = buildFFmpegArgs({ ...options, input: file.name });
      const rawCommand = `ffmpeg ${testArgs.join(' ')}`;
      setTerminalLogs([`[Preview Generation]:`, rawCommand]);
    }
  }, [options, file]);

  const handleFileDrop = (selectedFile: File) => {
    setFile(selectedFile);
    setTerminalLogs(prev => [...prev, `[Loaded] ${selectedFile.name}`]);
  };

  const handleUpdate = (key: keyof CommandOptions, value: any) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const handleExecute = async () => {
    if (!file) return;
    setTerminalLogs(prev => [...prev, `[Processing] Starting FFmpeg process natively...`]);
    // NOTE: This will eventually be attached to invoke('start_convert')
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <h1>FFmpeg UI <span style={{ color: 'var(--accent-primary)', fontSize: '0.5em', verticalAlign: 'middle' }}>TAURI NATIVE</span></h1>
      
      {!file && (
        <Dropzone onFileSelect={handleFileDrop} accept="video/*, audio/*" />
      )}

      {file && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem' }}>
          {/* Settings Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3>Video Settings</h3>
            
            <Select 
              label="Processing Mode"
              value={options.mode}
              onChange={e => handleUpdate('mode', e.target.value)}
              options={[
                { label: 'Standard Convert', value: 'convert' },
                { label: 'Audio Extract', value: 'audio' },
                { label: 'Hardware Remux', value: 'remux' }
              ]} 
            />

            <Select 
              label="Output Format"
              value={options.fmt}
              onChange={e => handleUpdate('fmt', e.target.value)}
              options={[
                { label: 'MP4', value: 'mp4' },
                { label: 'MKV', value: 'mkv' },
                { label: 'WEBM', value: 'webm' }
              ]} 
            />

            <Select 
              label="Video Codec"
              value={options.vc}
              onChange={e => handleUpdate('vc', e.target.value)}
              options={[
                { label: 'H.264 (Software)', value: 'libx264' },
                { label: 'H.265 (HEVC)', value: 'libx265' },
                { label: 'Copy (Pass-through)', value: 'copy' }
              ]} 
            />

            <Slider 
              label="Quality (CRF)" 
              min="0" max="51" 
              value={options.crf} 
              onChange={e => handleUpdate('crf', e.target.value)}
            />
          </div>

          /* Execution Column */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', gridColumn: 'span 2' }}>
            <TerminalOutput logs={terminalLogs} title="FFmpeg Pipeline" />
            
            <div style={{ display: 'flex', gap: '1rem', marginTop: 'auto' }}>
              <Button variant="ghost" onClick={() => setFile(null)}>Clear File</Button>
              <Button fullWidth onClick={handleExecute} disabled={!capabilities?.has_ffmpeg}>Start Encode</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
