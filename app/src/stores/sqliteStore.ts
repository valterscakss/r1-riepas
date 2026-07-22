import Database from 'better-sqlite3';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store, StorageRecord, IntakeInput, User } from '../types.js';

/**
 * SQLite datastore — the self-contained default backend. A real, durable, local
 * database in a single file. No external service, no credentials, nothing for a
 * company IT policy to block. Backup = copy the .db file (or schedule an export).
 */
const DDL = `
CREATE TABLE IF NOT EXISTS storage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  season       TEXT,
  location     TEXT,
  plate        TEXT,
  makeModel    TEXT,
  customerName TEXT,
  isCompany    INTEGER NOT NULL DEFAULT 0,
  phone        TEXT,
  size1        TEXT,
  brand        TEXT,
  quantity     TEXT,
  size2        TEXT,
  rimNote      TEXT,
  notes        TEXT,
  intakeDate   TEXT,
  releaseDate  TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  threadDepth  TEXT,
  smsCode      TEXT,
  feeEur       TEXT,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_storage_plate  ON storage(plate);
CREATE INDEX IF NOT EXISTS idx_storage_status ON storage(status);
CREATE INDEX IF NOT EXISTS idx_storage_location ON storage(location);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

interface Row {
  id: number; season: string | null; location: string | null; plate: string | null;
  makeModel: string | null; customerName: string | null; isCompany: number;
  phone: string | null; size1: string | null; brand: string | null; quantity: string | null;
  size2: string | null; rimNote: string | null; notes: string | null;
  intakeDate: string | null; releaseDate: string | null; status: string;
  threadDepth?: string | null; smsCode?: string | null; feeEur?: string | null;
}

const toRecord = (r: Row): StorageRecord => ({
  id: String(r.id), season: r.season, location: r.location, plate: r.plate,
  makeModel: r.makeModel, customerName: r.customerName, isCompany: !!r.isCompany,
  phone: r.phone, size1: r.size1, brand: r.brand, quantity: r.quantity,
  size2: r.size2, rimNote: r.rimNote, notes: r.notes,
  intakeDate: r.intakeDate, releaseDate: r.releaseDate,
  status: r.status === 'released' ? 'released' : 'active',
  threadDepth: r.threadDepth ?? null, smsCode: r.smsCode ?? null, feeEur: r.feeEur ?? null,
});

export class SqliteStore implements Store {
  private db: Database.Database;
  private seededFrom: string | null = null;

  constructor(dbFile: string, seedFile?: string) {
    mkdirSync(dirname(dbFile), { recursive: true });
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(DDL);
    for (const col of ['threadDepth', 'smsCode', 'feeEur']) {
      try { this.db.exec(`ALTER TABLE storage ADD COLUMN ${col} TEXT`); } catch { /* exists */ }
    }
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM storage').get() as { n: number }).n;
    if (count === 0 && seedFile && existsSync(seedFile)) this.seed(seedFile);
  }

  private seed(seedFile: string) {
    const raw = JSON.parse(readFileSync(seedFile, 'utf8'));
    const rows: any[] = Array.isArray(raw) ? raw : raw.records ?? [];
    const insert = this.db.prepare(`INSERT INTO storage
      (season, location, plate, makeModel, customerName, isCompany, phone, size1, brand, quantity, size2, rimNote, notes, intakeDate, releaseDate, status)
      VALUES (@season, @location, @plate, @makeModel, @customerName, @isCompany, @phone, @size1, @brand, @quantity, @size2, @rimNote, @notes, @intakeDate, @releaseDate, @status)`);
    const tx = this.db.transaction((items: any[]) => {
      for (const r of items) {
        insert.run({
          season: r.season ?? r.sheet ?? null,
          location: r.location ?? r.locationCode ?? null,
          plate: r.plate ?? null,
          makeModel: r.makeModel ?? null,
          customerName: r.customerName ?? null,
          isCompany: r.isCompany ? 1 : 0,
          phone: r.phone ?? r.phoneE164 ?? null,
          size1: r.size1 ?? r.tires?.[0]?.size ?? null,
          brand: r.brand ?? r.tires?.[0]?.brand ?? null,
          quantity: r.quantity ?? r.quantityRaw ?? null,
          size2: r.size2 ?? r.tires?.[1]?.size ?? null,
          rimNote: r.rimNote ?? null,
          notes: r.notes ?? null,
          intakeDate: r.intakeDate ?? null,
          releaseDate: r.releaseDate ?? null,
          status: r.status ?? (r.releaseDate ? 'released' : 'active'),
        });
      }
    });
    tx(rows);
    this.seededFrom = seedFile;
  }

  kind() {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM storage').get() as { n: number }).n;
    return `sqlite (${n} records${this.seededFrom ? `, seeded from ${this.seededFrom}` : ''})`;
  }

  async list(opts?: { status?: 'active' | 'released'; q?: string }): Promise<StorageRecord[]> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts?.status) { where.push('status = @status'); params.status = opts.status; }
    if (opts?.q) {
      where.push('(UPPER(plate) LIKE @q OR UPPER(location) LIKE @q OR UPPER(customerName) LIKE @q OR phone LIKE @q OR UPPER(makeModel) LIKE @q)');
      params.q = `%${opts.q.toUpperCase()}%`;
    }
    const sql = `SELECT * FROM storage ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
    return (this.db.prepare(sql).all(params) as Row[]).map(toRecord);
  }

  async get(id: string): Promise<StorageRecord | null> {
    const r = this.db.prepare('SELECT * FROM storage WHERE id = ?').get(Number(id)) as Row | undefined;
    return r ? toRecord(r) : null;
  }

  async create(input: IntakeInput): Promise<StorageRecord> {
    const rec = {
      season: input.season ?? null, location: input.location ?? null, plate: input.plate ?? null,
      makeModel: input.makeModel ?? null, customerName: input.customerName ?? null,
      isCompany: input.isCompany ? 1 : 0, phone: input.phone ?? null,
      size1: input.size1 ?? null, brand: input.brand ?? null, quantity: input.quantity ?? null,
      size2: input.size2 ?? null, rimNote: input.rimNote ?? null, notes: input.notes ?? null,
      intakeDate: input.intakeDate ?? new Date().toISOString().slice(0, 10),
      releaseDate: null as string | null, status: 'active',
      threadDepth: input.threadDepth ?? null, smsCode: input.smsCode ?? null, feeEur: input.feeEur ?? null,
    };
    const info = this.db.prepare(`INSERT INTO storage
      (season, location, plate, makeModel, customerName, isCompany, phone, size1, brand, quantity, size2, rimNote, notes, intakeDate, releaseDate, status, threadDepth, smsCode, feeEur)
      VALUES (@season, @location, @plate, @makeModel, @customerName, @isCompany, @phone, @size1, @brand, @quantity, @size2, @rimNote, @notes, @intakeDate, @releaseDate, @status, @threadDepth, @smsCode, @feeEur)`).run(rec);
    return (await this.get(String(info.lastInsertRowid)))!;
  }

  async release(id: string, opts: { releaseDate?: string }): Promise<StorageRecord | null> {
    const date = opts.releaseDate ?? new Date().toISOString().slice(0, 10);
    const info = this.db.prepare(`UPDATE storage SET status = 'released', releaseDate = ? WHERE id = ?`).run(date, Number(id));
    if (info.changes === 0) return null;
    return this.get(id);
  }

  async replaceAll(records: IntakeInput[]): Promise<{ imported: number }> {
    const insert = this.db.prepare(`INSERT INTO storage
      (season, location, plate, makeModel, customerName, isCompany, phone, size1, brand, quantity, size2, rimNote, notes, intakeDate, releaseDate, status)
      VALUES (@season, @location, @plate, @makeModel, @customerName, @isCompany, @phone, @size1, @brand, @quantity, @size2, @rimNote, @notes, @intakeDate, @releaseDate, @status)`);
    const tx = this.db.transaction((items: IntakeInput[]) => {
      this.db.prepare('DELETE FROM storage').run();
      for (const r of items) {
        insert.run({
          season: r.season ?? null, location: r.location ?? null, plate: r.plate ?? null,
          makeModel: r.makeModel ?? null, customerName: r.customerName ?? null,
          isCompany: r.isCompany ? 1 : 0, phone: r.phone ?? null,
          size1: r.size1 ?? null, brand: r.brand ?? null, quantity: r.quantity ?? null,
          size2: r.size2 ?? null, rimNote: r.rimNote ?? null, notes: r.notes ?? null,
          intakeDate: r.intakeDate ?? null, releaseDate: (r as { releaseDate?: string }).releaseDate ?? null,
          status: (r as { status?: string }).status ?? ((r as { releaseDate?: string }).releaseDate ? 'released' : 'active'),
        });
      }
      return items.length;
    });
    return { imported: tx(records) };
  }

  // --- Auth ---
  async ensureAuth(): Promise<void> { /* table created in constructor DDL */ }

  async getUserByUsername(username: string): Promise<User | null> {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; name: string; password_hash: string; role: string } | undefined;
    return r ? { id: String(r.id), username: r.username, name: r.name, passwordHash: r.password_hash, role: r.role === 'admin' ? 'admin' : 'staff' } : null;
  }

  async createUser(u: { username: string; name: string; passwordHash: string; role: 'admin' | 'staff' }): Promise<void> {
    this.db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)')
      .run(u.username.toLowerCase(), u.name, u.passwordHash, u.role);
  }

  async setPasswordByUsername(username: string, passwordHash: string): Promise<boolean> {
    const info = this.db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash, username.toLowerCase());
    return info.changes > 0;
  }

  async countUsers(): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }
}
