import React from 'react';
import { X, ExternalLink, Terminal, Monitor, Globe, Server, Code2 } from 'lucide-react';

export interface AboutModalProps {
  onClose: () => void;
  /** e.g. "Desktop (Tauri)" | "Web (WebAssembly)" | "Web (Local Server)" */
  platform: string;
  ffmpegVersion?: string | null;
}

const LINK_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderRadius: 8,
  background: 'var(--glass-2)',
  border: '1px solid var(--border)',
  color: 'var(--text-1)',
  textDecoration: 'none',
  fontSize: '.78rem',
  fontWeight: 600,
  transition: 'border-color 180ms ease, background 180ms ease',
  cursor: 'pointer',
};

function LinkRow({
  href,
  icon,
  label,
  sub,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={LINK_STYLE}
      onMouseOver={e => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border-2)';
        (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-3)';
      }}
      onMouseOut={e => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-2)';
      }}
    >
      <span style={{ color: 'var(--text-2)', display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block' }}>{label}</span>
        <span style={{ fontSize: '.67rem', color: 'var(--text-2)', fontWeight: 400 }}>{sub}</span>
      </span>
      <ExternalLink size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
    </a>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform.toLowerCase().includes('desktop')) return <Monitor size={12} />;
  if (platform.toLowerCase().includes('server')) return <Server size={12} />;
  return <Globe size={12} />;
}

export function AboutModal({ onClose, platform, ffmpegVersion }: AboutModalProps) {
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 10px',
    borderRadius: 99,
    fontSize: '.68rem',
    fontWeight: 600,
    background: 'var(--glass-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-2)',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div
        className="modal-container"
        style={{ maxWidth: 420 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-header-left">
            <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>🎬</span>
            <div>
              <div className="modal-title" style={{ fontSize: '.92rem' }}>FFmpeg UI</div>
              <div className="modal-subtitle">A visual frontend for FFmpeg</div>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Platform + FFmpeg version badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={badgeStyle}>
              <PlatformIcon platform={platform} /> {platform}
            </span>
            {ffmpegVersion && (
              <span style={{ ...badgeStyle, color: 'var(--success)', borderColor: 'rgba(22,163,74,.3)', background: 'rgba(22,163,74,.06)' }}>
                🟢 FFmpeg {ffmpegVersion.split('-')[0].trim()}
              </span>
            )}
          </div>

          {/* Description */}
          <p style={{ fontSize: '.78rem', color: 'var(--text-2)', lineHeight: 1.75, margin: 0 }}>
            Convert, remux, trim, and process media files without touching the terminal.
            Runs natively on desktop via Tauri, or directly in the browser using WebAssembly.
            All FFmpeg command building is handled for you.
          </p>

          {/* Links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <LinkRow
              href="https://github.com/bennypepper/FFmpeg-UI"
              icon={<Code2 size={15} />}
              label="GitHub Repository"
              sub="github.com/bennypepper/FFmpeg-UI"
            />
            <LinkRow
              href="https://ffmpeg.org"
              icon={<Terminal size={15} />}
              label="Powered by FFmpeg"
              sub="Open-source multimedia framework"
            />
          </div>

          {/* Footer: author + license */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
            fontSize: '.68rem',
            color: 'var(--text-3)',
          }}>
            <span>By <strong style={{ color: 'var(--text-2)' }}>Benedict Pepper</strong></span>
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: 'var(--glass-2)',
              border: '1px solid var(--border)',
              fontSize: '.62rem',
              fontWeight: 600,
              letterSpacing: '.05em',
            }}>
              MIT License
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
