import type { StorageRecord } from './types';

/** "2255017" → "225/50/17" while typing. */
export function maskSize(v: string | null | undefined): string {
  const d = String(v || '').replace(/[^0-9]/g, '').slice(0, 7);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}/${d.slice(3)}`;
  return `${d.slice(0, 3)}/${d.slice(3, 5)}/${d.slice(5)}`;
}

/** Normalise "225/50R17", "225 / 50 / 17" → "225/50/17"; anything else → null. */
export function normSize(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.replace(/\s/g, '').match(/^(\d{3})\/(\d{1,2})[/R]?(\d{2})$/i);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

const NOTE_SIZE = /\b(\d{3})\/(\d{1,2})[/R]?(\d{2})\b/i;
const NOTE_SIZE_STRICT = /\b(\d{3}\/\d{1,2}\/\d{2})\b/;

/** A size written in PIEZĪMES means the staggered set's 2nd size (lenient: 225/50R17 too). */
export function noteSize(notes: string | null | undefined): string | null {
  const m = String(notes || '').match(NOTE_SIZE);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

/** The server's stricter reading of the same thing (only "225/50/17"). */
export function noteSizeStrict(notes: string | null | undefined): string | null {
  return notes?.match(NOTE_SIZE_STRICT)?.[1] ?? null;
}

/** Second size for display: the column, else a size found in the notes. */
export const size2Of = (r: Pick<StorageRecord, 'size2' | 'notes'>): string => r.size2 || noteSize(r.notes) || '';

/** Notes for display: a note that is nothing but the 2nd size is already shown as size2. */
export function notesOf(r: Pick<StorageRecord, 'notes'>): string {
  const n = r.notes || '';
  return /^\s*\d{3}\/\d{1,2}[/R]?\d{2}\s*$/i.test(n) ? '' : n;
}
