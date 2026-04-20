import React, { SelectHTMLAttributes } from 'react';
import styles from '../styles/Select.module.css';

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
}

export function Select({ label, options, className = '', ...props }: SelectProps) {
  return (
    <div className={`${styles.container} ${className}`}>
      {label && <label className={styles.label}>{label}</label>}
      <div className={styles.wrapper}>
        <select className={styles.select} {...props}>
          {options.map((opt, i) => (
            <option key={i} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}
