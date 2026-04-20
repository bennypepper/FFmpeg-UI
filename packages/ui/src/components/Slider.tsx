import React, { InputHTMLAttributes } from 'react';
import styles from '../styles/Slider.module.css';

export interface SliderProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  valueDisplay?: string | number;
}

export function Slider({ label, valueDisplay, className = '', ...props }: SliderProps) {
  return (
    <div className={`${styles.container} ${className}`}>
      <div className={styles.header}>
        <label className={styles.label}>{label}</label>
        <div className={styles.value}>
          {valueDisplay !== undefined ? valueDisplay : props.value}
        </div>
      </div>
      <input 
        type="range" 
        className={styles.input} 
        {...props} 
      />
    </div>
  );
}
