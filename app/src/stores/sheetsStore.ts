import type { Store, StorageRecord, IntakeInput, User } from '../types.js';
import { matches } from '../types.js';

/**
 * Google Sheets datastore — the production backend. The Google Sheet keeps the
 * SAME 13-column layout the shop already uses, so it stays readable/editable in
 * Sheets while this UI reads and writes rows via the Sheets API.
 *
 * Column order (matches the workbook's modern layout):
 *  A VIETA | B AUTO NR. | C NOSAUKUMS(vehicle) | D VĀRDS | E TELEFONA NR. |
 *  F IZMĒRS | G NOSAUKUMS(tire) | H SKAITS | I DISKI | J PIEZĪMES |
 *  K SAŅEMŠANAS DATUMS | L IZSNIEGŠANAS DATUMS | M PARAKSTS
 *
 * Config via env:
 *   SHEET_ID   – the spreadsheet id
 *   SHEET_TAB  – the tab (current season), e.g. "2025 RUDENS"
 *   GOOGLE_SERVICE_ACCOUNT_JSON – service-account key JSON (string), or
 *   GOOGLE_APPLICATION_CREDENTIALS – path to the key file
 * Share the Sheet with the service account's email (Editor).
 */
const COL_COUNT = 13;
const LAST_COL = 'M';

export class SheetsStore implements Store {
  private sheets: any;
  private ready = false;

  constructor(
    private readonly sheetId: string,
    private readonly tab: string,
  ) {}

  private async init() {
    if (this.ready) return;
    const { google } = await import('googleapis');
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      ...(raw ? { credentials: JSON.parse(raw) } : {}),
    });
    this.sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });
    this.ready = true;
  }

  kind() {
    return `google-sheets (${this.sheetId} / ${this.tab})`;
  }

  private rowToRecord(row: any[], rowNumber: number): StorageRecord {
    const g = (i: number) => {
      const v = row[i];
      return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
    };
    const diski = g(8);
    const isSize2 = diski ? /^\d{3}\/\d{1,2}[\/R]?\d{2}/i.test(diski) : false;
    const release = g(11);
    return {
      id: `${this.tab}:${rowNumber}`,
      season: this.tab,
      location: g(0),
      plate: g(1),
      makeModel: g(2),
      customerName: g(3),
      isCompany: false,
      phone: g(4),
      size1: g(5),
      brand: g(6),
      quantity: g(7),
      size2: isSize2 ? diski : null,
      rimNote: isSize2 ? null : diski,
      notes: g(9),
      intakeDate: g(10),
      releaseDate: release,
      status: release ? 'released' : 'active',
    };
  }

  private recordToRow(r: IntakeInput): (string | null)[] {
    const diski = r.size2 ?? r.rimNote ?? null;
    return [
      r.location ?? null, r.plate ?? null, r.makeModel ?? null, r.customerName ?? null,
      r.phone ?? null, r.size1 ?? null, r.brand ?? null, r.quantity ?? null,
      diski, r.notes ?? null, r.intakeDate ?? new Date().toISOString().slice(0, 10),
      null, null,
    ];
  }

  async list(opts?: { status?: 'active' | 'released'; q?: string }): Promise<StorageRecord[]> {
    await this.init();
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `${this.tab}!A2:${LAST_COL}`,
    });
    const rows: any[][] = res.data.values ?? [];
    let out = rows
      .map((row, i) => this.rowToRecord(row, i + 2)) // +2: header row 1, data from row 2
      .filter((r) => r.location || r.plate || r.customerName || r.size1);
    if (opts?.status) out = out.filter((r) => r.status === opts.status);
    if (opts?.q) out = out.filter((r) => matches(r, opts.q!));
    return out;
  }

  async get(id: string): Promise<StorageRecord | null> {
    const all = await this.list();
    return all.find((r) => r.id === id) ?? null;
  }

  async create(input: IntakeInput): Promise<StorageRecord> {
    await this.init();
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: `${this.tab}!A:${LAST_COL}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [this.recordToRow(input)] },
    });
    // Re-read to get the assigned row number / id.
    const all = await this.list();
    const match = all.reverse().find((r) => r.plate === input.plate && r.location === input.location);
    return match ?? { ...(input as any), id: `${this.tab}:new`, status: 'active', releaseDate: null };
  }

  async release(id: string, opts: { releaseDate?: string }): Promise<StorageRecord | null> {
    await this.init();
    const rowNumber = Number(id.split(':')[1]);
    if (!rowNumber) return null;
    const date = opts.releaseDate ?? new Date().toISOString().slice(0, 10);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: `${this.tab}!L${rowNumber}`, // IZSNIEGŠANAS DATUMS
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[date]] },
    });
    return this.get(id);
  }

  // Auth and bulk import are not supported on the Sheets backend (use Postgres/SQLite).
  private unsupported(): never {
    throw new Error('This operation requires the Postgres or SQLite backend, not Google Sheets.');
  }
  async replaceAll(): Promise<{ imported: number }> { return this.unsupported(); }
  async ensureAuth(): Promise<void> { /* no-op */ }
  async getUserByUsername(): Promise<User | null> { return this.unsupported(); }
  async createUser(): Promise<void> { return this.unsupported(); }
  async countUsers(): Promise<number> { return 0; }
}

// (COL_COUNT kept for reference/validation of the layout width.)
void COL_COUNT;
