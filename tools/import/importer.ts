/**
 * R1 Tires — Excel migration importer (Phase 1)
 *
 * Reads the source workbook (GLabasana.xlsx) and produces a NORMALIZED, validated
 * dataset plus a reconciliation report. Runs as a DRY-RUN by default: it parses,
 * normalizes and validates without writing to a database, so the migration can be
 * rehearsed and reviewed (SRS FR-2.5.1, and requirements-review B5).
 *
 * Scope: the 12 sheets using the modern 13-column layout
 *   VIETA | AUTO NR. | NOSAUKUMS | VĀRDS | TELEFONA NR. | IZMĒRS | NOSAUKUMS |
 *   SKAITS | DISKI | PIEZĪMES | SAŅEMŠANAS DATUMS | IZSNIEGŠANAS DATUMS | PARAKSTS
 * Older layouts (pre-2018) are reported as skipped, not silently dropped.
 *
 * Usage:
 *   tsx tools/import/importer.ts --dry-run [--file <path>] [--report <out.json>]
 */
import XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const getFlag = (name: string) => args.includes(`--${name}`);
const getOpt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const FILE =
  getOpt('file') ??
  '/root/.claude/uploads/f1214ab8-7935-5cce-abee-4141f5d84200/fddfd33a-GLabasana.xlsx';
const REPORT = getOpt('report');
const DRY_RUN = getFlag('dry-run') || true; // only dry-run is implemented for now

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------
type Severity = 'error' | 'warning' | 'info';
interface Issue {
  sheet: string;
  row: number;
  severity: Severity;
  field: string;
  message: string;
  raw?: unknown;
}
interface NormalTire {
  position: number;
  size: string | null;
  sizeRaw: string | null;
  brand: string | null;
  quantity: number | null;
}
interface NormalRecord {
  sheet: string;
  row: number;
  locationCode: string | null;
  plate: string | null;
  makeModel: string | null;
  customerName: string | null;
  isCompany: boolean;
  phoneE164: string | null;
  phoneRaw: string | null;
  quantityRaw: string | null;
  quantityTotal: number | null;
  isStaggered: boolean;
  rimNote: string | null;
  rimType: 'none' | 'alloy' | 'steel' | 'unknown';
  notes: string | null;
  intakeDate: string | null;
  releaseDate: string | null;
  status: 'active' | 'released';
  tires: NormalTire[];
}

const issues: Issue[] = [];
const record = (i: Issue) => issues.push(i);

// --------------------------------------------------------------------------
// Normalizers
// --------------------------------------------------------------------------
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** License plate: uppercase, strip spaces/punctuation. Flags name-like values. */
function normalizePlate(v: unknown, ctx: { sheet: string; row: number }): string | null {
  const s = clean(v);
  if (!s) return null;
  const up = s.toUpperCase().replace(/[^A-Z0-9ĀČĒĢĪĶĻŅŠŪŽ]/g, '');
  if (!/\d/.test(up)) {
    record({ ...ctx, severity: 'warning', field: 'plate', message: `Plate has no digits, may be a name: "${s}"`, raw: s });
  }
  return up || null;
}

/** Phone: Latvian mobile → E.164 (+371XXXXXXXX). Non-numeric text signals a company. */
function normalizePhone(v: unknown, ctx: { sheet: string; row: number }): { e164: string | null; raw: string | null; looksCompany: boolean } {
  if (v === null || v === undefined) return { e164: null, raw: null, looksCompany: false };
  if (typeof v === 'number') {
    const digits = String(Math.trunc(v));
    if (digits.length === 8 && /^2/.test(digits)) return { e164: `+371${digits}`, raw: digits, looksCompany: false };
    record({ ...ctx, severity: 'warning', field: 'phone', message: `Unusual phone length: "${digits}"`, raw: digits });
    return { e164: digits.length >= 8 ? `+${digits}` : null, raw: digits, looksCompany: false };
  }
  const s = clean(v);
  if (!s) return { e164: null, raw: null, looksCompany: false };
  const digits = s.replace(/\D/g, '');
  if (digits.length === 8 && /^2/.test(digits)) return { e164: `+371${digits}`, raw: s, looksCompany: false };
  // non-numeric → almost certainly a company name placed in the phone column
  record({ ...ctx, severity: 'info', field: 'phone', message: `Phone column holds non-numeric text (likely company): "${s}"`, raw: s });
  return { e164: null, raw: s, looksCompany: true };
}

/** Tire size → canonical "W/A/D" (e.g. 235/50/19). Accepts "225/55R16" too. */
function normalizeSize(v: unknown, ctx: { sheet: string; row: number }, field = 'size'): { size: string | null; raw: string | null } {
  const s = clean(v);
  if (!s) return { size: null, raw: null };
  const m = s.replace(/\s/g, '').match(/^(\d{3})\/(\d{1,2})[\/R]?(\d{2})$/i);
  if (m) return { size: `${m[1]}/${m[2]}/${m[3]}`, raw: s };
  record({ ...ctx, severity: 'warning', field, message: `Unrecognized tire size format: "${s}"`, raw: s });
  return { size: null, raw: s };
}

/** SKAITS "4" | "2+2" | "3+1" → total + staggered flag. */
function parseQuantity(v: unknown, ctx: { sheet: string; row: number }): { raw: string | null; total: number | null; staggered: boolean } {
  const s = clean(v);
  if (!s) return { raw: null, total: null, staggered: false };
  const parts = s.match(/\d+/g);
  if (!parts) {
    record({ ...ctx, severity: 'warning', field: 'quantity', message: `Unparseable count: "${s}"`, raw: s });
    return { raw: s, total: null, staggered: false };
  }
  const total = parts.reduce((a, b) => a + Number(b), 0);
  const staggered = /\+/.test(s);
  if (total < 1 || total > 8) {
    record({ ...ctx, severity: 'info', field: 'quantity', message: `Unusual count total ${total} from "${s}"`, raw: s });
  }
  return { raw: s, total, staggered };
}

/** Date "dd.mm.yyyy." or JS Date/serial → ISO yyyy-mm-dd. */
function parseDate(v: unknown, ctx: { sheet: string; row: number }, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  record({ ...ctx, severity: 'warning', field, message: `Unrecognized date: "${s}"`, raw: s });
  return null;
}

/** DISKI column: may hold a 2nd tire size (staggered) OR a rim note. */
function interpretDiski(v: unknown, ctx: { sheet: string; row: number }): { secondSize: { size: string | null; raw: string | null } | null; rimNote: string | null; rimType: NormalRecord['rimType'] } {
  const s = clean(v);
  if (!s) return { secondSize: null, rimNote: null, rimType: 'unknown' };
  if (/^\s*\d{3}\/\d{1,2}[\/R]?\d{2}/i.test(s)) {
    return { secondSize: normalizeSize(s, ctx, 'size2'), rimNote: null, rimType: 'unknown' };
  }
  const low = s.toLowerCase();
  let rimType: NormalRecord['rimType'] = 'unknown';
  if (/liet/.test(low)) rimType = 'alloy';        // "lietie diski" = alloy
  else if (/dzelz|tērau|terau/.test(low)) rimType = 'steel'; // "dzelz diski" = steel
  return { secondSize: null, rimNote: s, rimType };
}

const STD_HEADER = ['VIETA', 'AUTO NR.', 'NOSAUKUMS', 'VĀRDS', 'TELEFONA NR.', 'IZMĒRS'];
function isStandardLayout(header: unknown[]): boolean {
  const h = header.map((c) => (c ? String(c).trim().toUpperCase() : ''));
  return STD_HEADER.every((want, i) => h[i] === want);
}

const seasonMeta = (sheet: string): { term: 'spring' | 'autumn' | null; year: number | null } => {
  const up = sheet.toUpperCase();
  const term = /PAVASAR/.test(up) ? 'spring' : /RUDEN/.test(up) ? 'autumn' : null;
  const ym = up.match(/(20\d{2})/);
  return { term, year: ym ? Number(ym[1]) : null };
};

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
const wb = XLSX.readFile(FILE, { cellDates: true });
const records: NormalRecord[] = [];
const perSheet: Array<{ sheet: string; layout: string; rows: number; occupied: number; imported: number; flagged: number }> = [];
const skippedSheets: string[] = [];

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
  if (rows.length === 0) continue;
  if (!isStandardLayout(rows[0])) {
    skippedSheets.push(sheetName);
    continue;
  }
  const { term, year } = seasonMeta(sheetName);
  if (!term || !year) {
    record({ sheet: sheetName, row: 1, severity: 'info', field: 'season', message: `Could not derive season term/year from sheet name` });
  }
  let occupied = 0, imported = 0, flagged = 0;
  const flaggedRows = new Set<number>();
  const issuesBefore = issues.length;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const ctx = { sheet: sheetName, row: r + 1 }; // 1-based, header = row 1
    const [vieta, auto, make, vards, phone, size, brand, skaits, diski, piezimes, recv, issue] = row as unknown[];

    // Empty spot? (a VIETA with nothing else)
    const anyData = [auto, make, vards, phone, size, brand, skaits].some((c) => clean(c) !== null);
    if (!anyData) continue;
    occupied++;

    const plate = normalizePlate(auto, ctx);
    const ph = normalizePhone(phone, ctx);
    const sz = normalizeSize(size, ctx);
    const qty = parseQuantity(skaits, ctx);
    const di = interpretDiski(diski, ctx);
    const intakeDate = parseDate(recv, ctx, 'intake_date');
    const releaseDate = parseDate(issue, ctx, 'release_date');
    const nameStr = clean(vards);
    const isCompany = ph.looksCompany || (nameStr !== null && /^[A-ZĀČĒĢĪĶĻŅŠŪŽ0-9 .&-]{2,}$/.test(nameStr) && nameStr === nameStr.toUpperCase() && /[A-Z]/.test(nameStr));

    const tires: NormalTire[] = [];
    if (sz.size || sz.raw || brand) {
      tires.push({ position: 1, size: sz.size, sizeRaw: sz.raw, brand: clean(brand), quantity: qty.total });
    }
    if (di.secondSize && (di.secondSize.size || di.secondSize.raw)) {
      tires.push({ position: 2, size: di.secondSize.size, sizeRaw: di.secondSize.raw, brand: clean(brand), quantity: null });
    }

    records.push({
      sheet: sheetName, row: r + 1,
      locationCode: clean(vieta)?.toUpperCase().replace(/\s+/g, '') ?? null,
      plate, makeModel: clean(make),
      customerName: nameStr, isCompany,
      phoneE164: ph.e164, phoneRaw: ph.raw,
      quantityRaw: qty.raw, quantityTotal: qty.total, isStaggered: qty.staggered,
      rimNote: di.rimNote, rimType: di.rimType,
      notes: clean(piezimes),
      intakeDate, releaseDate,
      status: releaseDate ? 'released' : 'active',
      tires,
    });
    imported++;
  }

  // count rows that produced at least one issue in this sheet
  for (let k = issuesBefore; k < issues.length; k++) flaggedRows.add(issues[k].row);
  flagged = flaggedRows.size;
  perSheet.push({ sheet: sheetName, layout: 'standard-13col', rows: rows.length - 1, occupied, imported, flagged });
}

// --------------------------------------------------------------------------
// Reconciliation
// --------------------------------------------------------------------------
const uniquePlates = new Set(records.map((r) => r.plate).filter(Boolean));
const uniqueLocations = new Set(records.map((r) => r.locationCode).filter(Boolean));
const uniquePhones = new Set(records.map((r) => r.phoneE164).filter(Boolean));
const bySeverity = (s: Severity) => issues.filter((i) => i.severity === s).length;

const report = {
  source_file: FILE,
  dry_run: DRY_RUN,
  sheets_imported: perSheet.length,
  sheets_skipped_nonstandard_layout: skippedSheets.length,
  skipped_sheets: skippedSheets,
  totals: {
    tire_sets: records.length,
    tires: records.reduce((a, r) => a + r.tires.length, 0),
    active: records.filter((r) => r.status === 'active').length,
    released: records.filter((r) => r.status === 'released').length,
    staggered_sets: records.filter((r) => r.isStaggered).length,
    unique_plates: uniquePlates.size,
    unique_locations: uniqueLocations.size,
    unique_phones: uniquePhones.size,
    likely_companies: records.filter((r) => r.isCompany).length,
    rows_without_plate: records.filter((r) => !r.plate).length,
    rows_without_phone: records.filter((r) => !r.phoneE164).length,
  },
  issues: {
    error: bySeverity('error'),
    warning: bySeverity('warning'),
    info: bySeverity('info'),
    total: issues.length,
  },
  issues_by_field: Object.entries(
    issues.reduce<Record<string, number>>((acc, i) => ((acc[i.field] = (acc[i.field] ?? 0) + 1), acc), {}),
  ).sort((a, b) => b[1] - a[1]),
  per_sheet: perSheet,
  sample_issues: issues.slice(0, 15),
};

// --------------------------------------------------------------------------
// Output
// --------------------------------------------------------------------------
console.log('\n===== R1 Tires — Excel import DRY RUN =====');
console.log(`Source: ${FILE}`);
console.log(`Sheets imported (standard layout): ${report.sheets_imported}`);
console.log(`Sheets skipped (older layouts):    ${report.sheets_skipped_nonstandard_layout}`);
console.log('\n--- Totals ---');
for (const [k, v] of Object.entries(report.totals)) console.log(`  ${k.padEnd(26)} ${v}`);
console.log('\n--- Data issues (quarantined, not dropped) ---');
console.log(`  errors:   ${report.issues.error}`);
console.log(`  warnings: ${report.issues.warning}`);
console.log(`  info:     ${report.issues.info}`);
console.log('  by field:', report.issues_by_field.map(([f, n]) => `${f}=${n}`).join('  '));
console.log('\n(No database writes — this is a dry run. Review the report before a real load.)');

if (REPORT) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${REPORT}`);
}
