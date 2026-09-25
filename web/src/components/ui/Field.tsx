'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { genPassword } from './password';

export function Field({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`field ${className}`}><label>{label}</label>{children}</div>;
}

/** A password box with a "generate" button next to it. */
export function PasswordField({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input className="input mono" style={{ flex: 1, letterSpacing: '.03em' }} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" {...rest} />
      <button type="button" className="btn" style={{ height: 'var(--h)' }} onClick={() => onChange(genPassword(12))}>🎲 Ģenerēt</button>
    </div>
  );
}
