import type { IntakeInput } from './types.js';

/**
 * Parse an uploaded workbook (Buffer) into normalized storage records.
 * This is the accuracy-critical pipeline: it reads the shop's modern 13-column
 * seasonal sheets, normalizes messy values, and produces rows to REPLACE the DB
 * (Excel = source of truth). The file itself is never stored — only parsed.
 */
export type ParsedRecord = IntakeInput & { releaseDate: string | null; status: 'active' | 'released' };
export interface ParseResult {
  records: ParsedRecord[];
  summary: { sheets: number; rows: number; parsed: number; skipped: number };
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

function normPlate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  return s.toUpperCase().replace(/[^A-Z0-9ĀČĒĢĪĶĻŅŠŪŽ]/g, '') || null;
}

function normPhone(v: unknown): { phone: string | null; looksCompany: boolean } {
  if (v === null || v === undefined) return { phone: null, looksCompany: false };
  if (typeof v === 'number') {
    const d = String(Math.trunc(v));
    if (d.length === 8 && /^2/.test(d)) return { phone: `+371${d}`, looksCompany: false };
    return { phone: d.length >= 8 ? `+${d}` : null, looksCompany: false };
  }
  const s = clean(v);
  if (!s) return { phone: null, looksCompany: false };
  const d = s.replace(/\D/g, '');
  if (d.length === 8 && /^2/.test(d)) return { phone: `+371${d}`, looksCompany: false };
  return { phone: null, looksCompany: true }; // non-numeric → a company name in the phone column
}

function normSize(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const m = s.replace(/\s/g, '').match(/^(\d{3})\/(\d{1,2})[/R]?(\d{2})$/i);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

function parseQty(v: unknown): { raw: string | null; staggered: boolean } {
  const s = clean(v);
  if (!s) return { raw: null, staggered: false };
  return { raw: s, staggered: /\+/.test(s) };
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function interpretDiski(v: unknown): { size2: string | null; rimNote: string | null } {
  const s = clean(v);
  if (!s) return { size2: null, rimNote: null };
  if (/^\s*\d{3}\/\d{1,2}[/R]?\d{2}/i.test(s)) return { size2: normSize(s), rimNote: null };
  return { size2: null, rimNote: s };
}

const hnorm = (c: unknown): string => (c == null ? '' : String(c).trim().toUpperCase().replace(/\s+/g, ' '));

// Find the header row within the first few rows (tolerates a title row above it).
function findHeaderRow(grid: unknown[][]): number {
  for (let i = 0; i < Math.min(grid.length, 6); i++) {
    const h = (grid[i] ?? []).map(hnorm);
    if (h.includes('VIETA') && h.some((x) => x.startsWith('AUTO')) && h.some((x) => x.startsWith('IZMĒR') || x.startsWith('IZMER'))) return i;
  }
  return -1;
}

interface ColMap {
  vieta: number; auto: number; make: number; vards: number; phone: number; size: number;
  brand: number; skaits: number; diski: number; piezimes: number; recv: number; issue: number;
  size2: number; thread: number;
}
// Map columns BY HEADER NAME (not fixed position) so the same layout with extra /
// reordered columns still imports. NOSAUKUMS appears twice (vehicle make + tire
// brand); the one before IZMĒRS is the make, the one after is the brand.
function buildColMap(headerRow: unknown[]): ColMap {
  const h = headerRow.map(hnorm);
  const idxOf = (...names: string[]) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const idxLike = (pred: (x: string) => boolean) => h.findIndex(pred);
  const size = idxOf('IZMĒRS', 'IZMERS');
  const nosauk: number[] = [];
  h.forEach((x, i) => { if (x === 'NOSAUKUMS') nosauk.push(i); });
  let make = idxOf('MARKA', 'AUTO NOSAUKUMS', 'AUTO MARKA');
  let brand = idxOf('RAŽOTĀJS', 'RAZOTAJS');
  if (nosauk.length >= 2) { make = nosauk.find((i) => i < size) ?? nosauk[0]; brand = nosauk.find((i) => i > size) ?? nosauk[1]; }
  else { if (make < 0 && nosauk.length) make = nosauk[0]; if (brand < 0) brand = idxLike((x, ) => x === 'NOSAUKUMS'); }
  return {
    vieta: idxOf('VIETA'),
    auto: idxLike((x) => x.startsWith('AUTO') || x === 'NUMURS'),
    make, vards: idxOf('VĀRDS', 'VARDS', 'KLIENTS'),
    phone: idxLike((x) => x.startsWith('TELEFON')),
    size, brand,
    skaits: idxOf('SKAITS', 'DAUDZUMS'),
    diski: idxOf('DISKI'),
    piezimes: idxOf('PIEZĪMES', 'PIEZIMES', 'KOMENTĀRS', 'KOMENTARS'),
    recv: idxLike((x) => x.startsWith('SAŅEM') || x.startsWith('SANEM')),
    issue: idxLike((x) => x.startsWith('IZSNIEG')),
    // Optional extra columns the updated legacy file may add:
    size2: idxLike((x) => (x.includes('IZMĒR') || x.includes('IZMER')) && /2|II|OTR/.test(x)),
    thread: idxLike((x) => x.includes('PROTEKT') || x.includes('DZIĻ') || x.includes('DZIL')),
  };
}
const NOTE_SIZE = /\b(\d{3})\/(\d{1,2})[/R]?(\d{2})\b/i;

// Testing placeholder: while ANONYMIZE_PHONES=true, every phone is replaced with
// an obvious dummy so real numbers aren't exposed during testing. Turn the flag
// off and re-import to restore the actual numbers from the workbook.
const DUMMY_PHONE = process.env.DUMMY_PHONE || '01010101010';
const anonymizePhones = () => process.env.ANONYMIZE_PHONES === 'true';

export async function parseWorkbook(buffer: Buffer): Promise<ParseResult> {
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const records: ParsedRecord[] = [];
  const anon = anonymizePhones();
  let sheets = 0, rows = 0, parsed = 0, skipped = 0;

  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, blankrows: false });
    const hdr = findHeaderRow(grid);
    if (hdr < 0) continue;
    const m = buildColMap(grid[hdr]);
    const at = (row: unknown[], i: number) => (i >= 0 ? row[i] : null);
    sheets++;
    for (let r = hdr + 1; r < grid.length; r++) {
      const row = grid[r] as unknown[];
      rows++;
      const auto = at(row, m.auto), make = at(row, m.make), vards = at(row, m.vards),
        phone = at(row, m.phone), size = at(row, m.size), brand = at(row, m.brand), skaits = at(row, m.skaits);
      const anyData = [auto, make, vards, phone, size, brand, skaits].some((c) => clean(c) !== null);
      if (!anyData) { skipped++; continue; }
      const ph = normPhone(phone);
      const di = interpretDiski(at(row, m.diski));
      const qty = parseQty(skaits);
      const nameStr = clean(vards);
      const isCompany = ph.looksCompany || (nameStr !== null && /^[A-ZĀČĒĢĪĶĻŅŠŪŽ0-9 .&-]{2,}$/.test(nameStr) && nameStr === nameStr.toUpperCase() && /[A-Z]/.test(nameStr));
      const releaseDate = parseDate(at(row, m.issue));
      // Second size: a dedicated 2nd-size column, then DISKI-as-size, then a size
      // written into PIEZĪMES (a 2+2 staggered set's rear size). If the note is only
      // that size, drop it from notes so it isn't duplicated.
      let notes = clean(at(row, m.piezimes));
      let size2 = (m.size2 >= 0 ? normSize(at(row, m.size2)) : null) ?? di.size2;
      if (!size2 && notes) {
        const nm = notes.match(NOTE_SIZE);
        if (nm) { size2 = `${nm[1]}/${nm[2]}/${nm[3]}`; if (/^\s*\d{3}\/\d{1,2}[/R]?\d{2}\s*$/i.test(notes)) notes = null; }
      }
      const thread = m.thread >= 0 ? clean(at(row, m.thread)) : null;
      records.push({
        season: name,
        location: clean(at(row, m.vieta))?.toUpperCase().replace(/\s+/g, '') ?? null,
        plate: normPlate(auto),
        makeModel: clean(make),
        customerName: nameStr,
        isCompany,
        phone: anon ? (ph.phone ? DUMMY_PHONE : null) : ph.phone,
        size1: normSize(size),
        brand: clean(brand),
        quantity: qty.raw,
        size2,
        rimNote: di.rimNote,
        notes,
        intakeDate: parseDate(at(row, m.recv)),
        releaseDate,
        status: releaseDate ? 'released' : 'active',
        threadDepth: thread, smsCode: null, feeEur: null,
      });
      parsed++;
    }
  }
  return { records, summary: { sheets, rows, parsed, skipped } };
}
