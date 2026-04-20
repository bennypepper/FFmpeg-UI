import React, { useRef, useState, DragEvent, ChangeEvent } from 'react';
import styles from '../styles/Dropzone.module.css';

export interface DropzoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSizeMB?: number;
}

export function Dropzone({ onFileSelect, accept = 'video/*, audio/*', maxSizeMB }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const processFile = (file: File) => {
    if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
      alert(`File too large. Maximum size is ${maxSizeMB}MB.`);
      return;
    }
    onFileSelect(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div 
      className={`${styles.dropzone} ${isDragging ? styles.isDragging : ''}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input 
        ref={fileInputRef}
        type="file" 
        className={styles.fileInput} 
        onChange={handleChange}
        accept={accept}
      />
      <div className={styles.content}>
        <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        <p className={styles.title}>Drop your media file here</p>
        <p className={styles.subtitle}>or click to browse</p>
      </div>
    </div>
  );
}
