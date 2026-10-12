/** "€12,50" — the shop's money format. */
export const eur = (n: number | string | null | undefined): string => `€${Number(n ?? 0).toFixed(2).replace('.', ',')}`;

/** Fee as stored text → "€12,50", or "—" when unpriced. */
export const feeText = (fee: string | null | undefined): string => (fee ? eur(fee) : '—');

export const threadText = (t: string | null | undefined): string => (t ? `${t} mm` : '—');

/**
 * Timestamps arrive as a plain date (intake/release columns), an ISO string
 * (Postgres) or "YYYY-MM-DD HH:MM:SS" (older SQLite rows). A naive timestamp is
 * UTC. Returns epoch ms, 0 when unreadable.
 */
export function tms(d: string | null | undefined): number {
  if (!d) return 0;
  let s = d.trim().replace(' ', 'T');
  if (!s.includes('T')) s += 'T00:00:00';
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A stored value in the viewer's LOCAL date + time (DD.MM.YYYY / HH:MM).
 * Date-only values show just the date.
 */
export function evWhen(s: string | null | undefined): { d: string; t: string } {
  if (!s) return { d: '', t: '' };
  const str = String(s);
  const md = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (md) return { d: `${md[3]}.${md[2]}.${md[1]}`, t: '' };
  const dt = new Date(!str.includes('T') && !str.includes('Z') ? `${str.replace(' ', 'T')}Z` : str);
  if (Number.isNaN(dt.getTime())) return { d: str, t: '' };
  return { d: `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`, t: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
}

/** ISO date → DD.MM.YYYY for printed documents. */
export function lvDate(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (v instanceof Date) return `${pad(v.getDate())}.${pad(v.getMonth() + 1)}.${v.getFullYear()}`;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v);
}

export const MONTHS = ['janvāris', 'februāris', 'marts', 'aprīlis', 'maijs', 'jūnijs', 'jūlijs', 'augusts', 'septembris', 'oktobris', 'novembris', 'decembris'];
export const DAYS = ['Svētdiena', 'Pirmdiena', 'Otrdiena', 'Trešdiena', 'Ceturtdiena', 'Piektdiena', 'Sestdiena'];

/** "PAVASARIS" March–August, "RUDENS" otherwise — the season a new intake belongs to. */
export function seasonOf(d: Date): string {
  const m = d.getMonth() + 1;
  return `${d.getFullYear()} ${m >= 3 && m < 9 ? 'PAVASARIS' : 'RUDENS'}`;
}

/** Who did it, in capitals so the person stands out; system actions read "R1". */
export const actorName = (a: string | null | undefined): string => String(a == null || a === '' ? 'R1' : a).toUpperCase();

export function initialsOf(n: string | null | undefined): string {
  return String(n || '—').replace(/^SIA\s*/i, '').replace(/["']/g, '').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0] || '').join('').toUpperCase() || '—';
}

export const todayIso = (now = new Date()): string => now.toISOString().slice(0, 10);
