import React, { useEffect, useRef } from 'react';
import styles from '../styles/TerminalOutput.module.css';

export interface TerminalOutputProps {
  logs: string[];
  title?: string;
}

export function TerminalOutput({ logs, title = 'FFmpeg Output' }: TerminalOutputProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new logs
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={styles.terminal}>
      <div className={styles.header}>
        <div className={`${styles.dot} ${styles.red}`} />
        <div className={`${styles.dot} ${styles.yellow}`} />
        <div className={`${styles.dot} ${styles.green}`} />
        <div className={styles.title}>{title}</div>
      </div>
      <div className={styles.content} ref={contentRef}>
        {logs.length === 0 ? (
          <span style={{ opacity: 0.5 }}>Waiting for command execution...</span>
        ) : (
          logs.map((log, i) => <div key={i}>{log}</div>)
        )}
      </div>
    </div>
  );
}
