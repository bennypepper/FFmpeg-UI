import { useEffect, useRef } from 'react';
import styles from '../styles/TerminalOutput.module.css';

export interface TerminalOutputProps {
  logs: string[];
  title?: string;
}

export function TerminalOutput({ logs, title = 'FFmpeg Output' }: TerminalOutputProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={styles.terminal}>
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
      </div>
      <div className={styles.content} ref={contentRef} role="log" aria-live="polite">
        {logs.length === 0 ? (
          <span style={{ opacity: 0.5 }}>Waiting for command execution...</span>
        ) : (
          logs.map((log, i) => <div key={i}>{log}</div>)
        )}
      </div>
    </div>
  );
}
