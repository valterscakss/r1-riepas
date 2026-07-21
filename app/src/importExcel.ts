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

const STD_HEADER = ['VIETA', 'AUTO NR.', 'NOSAUKUMS', 'VĀRDS', 'TELEFONA NR.', 'IZMĒRS'];
const isStandard = (header: unknown[]): boolean => {
  const h = header.map((c) => (c ? String(c).trim().toUpperCase() : ''));
  return STD_HEADER.every((w, i) => h[i] === w);
};

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
    if (grid.length === 0 || !isStandard(grid[0])) continue;
    sheets++;
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r] as unknown[];
      rows++;
      const [vieta, auto, make, vards, phone, size, brand, skaits, diski, piezimes, recv, issue] = row;
      const anyData = [auto, make, vards, phone, size, brand, skaits].some((c) => clean(c) !== null);
      if (!anyData) { skipped++; continue; }
      const ph = normPhone(phone);
      const di = interpretDiski(diski);
      const qty = parseQty(skaits);
      const nameStr = clean(vards);
      const isCompany = ph.looksCompany || (nameStr !== null && /^[A-ZĀČĒĢĪĶĻŅŠŪŽ0-9 .&-]{2,}$/.test(nameStr) && nameStr === nameStr.toUpperCase() && /[A-Z]/.test(nameStr));
      const releaseDate = parseDate(issue);
      records.push({
        season: name,
        location: clean(vieta)?.toUpperCase().replace(/\s+/g, '') ?? null,
        plate: normPlate(auto),
        makeModel: clean(make),
        customerName: nameStr,
        isCompany,
        phone: anon ? (ph.phone ? DUMMY_PHONE : null) : ph.phone,
        size1: normSize(size),
        brand: clean(brand),
        quantity: qty.raw,
        size2: di.size2,
        rimNote: di.rimNote,
        notes: clean(piezimes),
        intakeDate: parseDate(recv),
        releaseDate,
        status: releaseDate ? 'released' : 'active',
      });
      parsed++;
    }
  }
  return { records, summary: { sheets, rows, parsed, skipped } };
}
