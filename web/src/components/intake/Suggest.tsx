'use client';

import type { ReactNode } from 'react';

/** A dropdown of suggestions under an input; mousedown so the input doesn't blur first. */
export function Suggest<T>({ items, hi, onPick, render }: { items: T[]; hi: number; onPick: (i: number) => void; render: (x: T) => ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="suggest" role="listbox">
      {items.map((x, i) => (
        <div key={i} role="option" aria-selected={i === hi} className={i === hi ? 'on' : undefined} onMouseDown={(e) => { e.preventDefault(); onPick(i); }}>{render(x)}</div>
      ))}
    </div>
  );
}

/** Arrow keys / Enter / Escape over a suggestion list. Returns true when it handled the key. */
export function suggestKeys(e: React.KeyboardEvent, len: number, hi: number, setHi: (n: number) => void, pick: (i: number) => void, close: () => void): boolean {
  if (!len) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, len - 1)); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); return true; }
  if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(hi); return true; }
  if (e.key === 'Escape') { close(); return true; }
  return false;
}
