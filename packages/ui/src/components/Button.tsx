import React from 'react';
import styles from '../styles/Button.module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children: React.ReactNode;
}

export function Button({ 
  variant = 'primary', 
  size = 'md', 
  fullWidth = false, 
  className = '', 
  children, 
  ...props 
}: ButtonProps) {
  
  const classNames = [
    styles.base,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : '',
    'focus-ring',
    className
  ].filter(Boolean).join(' ');

  return (
    <button className={classNames} {...props}>
      {children}
    </button>
  );
}
