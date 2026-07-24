import pg from 'pg';
import type { Store, StorageRecord, IntakeInput, User, Container } from '../types.js';

/**
 * Postgres datastore — the production backend for Supabase (or any Postgres).
 * Set DATABASE_URL to the Supabase connection string. The table is created on
 * first use, so pointing at an empty database just works; the same DDL lives in
 * db/supabase/001_storage.sql for review / manual runs.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS storage (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season        TEXT,
  location      TEXT,
  plate         TEXT,
  make_model    TEXT,
  customer_name TEXT,
  is_company    BOOLEAN NOT NULL DEFAULT false,
  phone         TEXT,
  size1         TEXT,
  brand         TEXT,
  quantity      TEXT,
  size2         TEXT,
  rim_note      TEXT,
  notes         TEXT,
  intake_date   TEXT,
  release_date  TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE storage ADD COLUMN IF NOT EXISTS thread_depth TEXT;
ALTER TABLE storage ADD COLUMN IF NOT EXISTS sms_code TEXT;
ALTER TABLE storage ADD COLUMN IF NOT EXISTS fee_eur TEXT;
ALTER TABLE storage ADD COLUMN IF NOT EXISTS prepared_date TEXT;
CREATE INDEX IF NOT EXISTS idx_storage_plate ON storage(UPPER(plate));
CREATE INDEX IF NOT EXISTS idx_storage_status ON storage(status);
CREATE INDEX IF NOT EXISTS idx_storage_location ON storage(location);

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS containers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prefix     TEXT UNIQUE NOT NULL,
  label      TEXT,
  rows       INTEGER NOT NULL DEFAULT 1,
  cols       INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

interface Row {
  id: number; season: string | null; location: string | null; plate: string | null;
  make_model: string | null; customer_name: string | null; is_company: boolean;
  phone: string | null; size1: string | null; brand: string | null; quantity: string | null;
  size2: string | null; rim_note: string | null; notes: string | null;
  intake_date: string | null; release_date: string | null; status: string;
  thread_depth?: string | null; sms_code?: string | null; fee_eur?: string | null; prepared_date?: string | null;
}

const normStatus = (s: string): 'active' | 'prepared' | 'blocked' | 'released' =>
  s === 'released' ? 'released' : s === 'prepared' ? 'prepared' : s === 'blocked' ? 'blocked' : 'active';

const toRecord = (r: Row): StorageRecord => ({
  id: String(r.id), season: r.season, location: r.location, plate: r.plate,
  makeModel: r.make_model, customerName: r.customer_name, isCompany: !!r.is_company,
  phone: r.phone, size1: r.size1, brand: r.brand, quantity: r.quantity,
  size2: r.size2, rimNote: r.rim_note, notes: r.notes,
  intakeDate: r.intake_date, releaseDate: r.release_date,
  status: normStatus(r.status), preparedDate: r.prepared_date ?? null,
  threadDepth: r.thread_depth ?? null, smsCode: r.sms_code ?? null, feeEur: r.fee_eur ?? null,
});

export class PostgresStore implements Store {
  private pool: pg.Pool;
  private initP: Promise<void> | null = null;

  constructor(connectionString: string) {
    // Supabase requires SSL; accept its managed cert.
    const ssl = /supabase|sslmode=require|amazonaws/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined;
    this.pool = new pg.Pool({ connectionString, ssl, max: 3 });
  }

  private init(): Promise<void> {
    if (!this.initP) this.initP = this.pool.query(DDL).then(() => undefined);
    return this.initP;
  }

  kind() {
    return 'postgres (supabase)';
  }

  async list(opts?: { status?: 'active' | 'prepared' | 'released'; q?: string }): Promise<StorageRecord[]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts?.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
    if (opts?.q) {
      params.push(`%${opts.q.toUpperCase()}%`);
      const p = `$${params.length}`;
      where.push(`(UPPER(plate) LIKE ${p} OR UPPER(location) LIKE ${p} OR UPPER(customer_name) LIKE ${p} OR phone LIKE ${p} OR UPPER(make_model) LIKE ${p})`);
    }
    const sql = `SELECT * FROM storage ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
    const res = await this.pool.query<Row>(sql, params);
    return res.rows.map(toRecord);
  }

  async get(id: string): Promise<StorageRecord | null> {
    await this.init();
    const res = await this.pool.query<Row>('SELECT * FROM storage WHERE id = $1', [Number(id)]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async create(input: IntakeInput): Promise<StorageRecord> {
    await this.init();
    const res = await this.pool.query<Row>(
      `INSERT INTO storage
        (season, location, plate, make_model, customer_name, is_company, phone, size1, brand, quantity, size2, rim_note, notes, intake_date, release_date, status, thread_depth, sms_code, fee_eur)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,'active',$15,$16,$17) RETURNING *`,
      [
        input.season ?? null, input.location ?? null, input.plate ?? null, input.makeModel ?? null,
        input.customerName ?? null, input.isCompany ?? false, input.phone ?? null,
        input.size1 ?? null, input.brand ?? null, input.quantity ?? null, input.size2 ?? null,
        input.rimNote ?? null, input.notes ?? null, input.intakeDate ?? new Date().toISOString().slice(0, 10),
        input.threadDepth ?? null, input.smsCode ?? null, input.feeEur ?? null,
      ],
    );
    return toRecord(res.rows[0]);
  }

  async release(id: string, opts: { releaseDate?: string }): Promise<StorageRecord | null> {
    await this.init();
    const date = opts.releaseDate ?? new Date().toISOString().slice(0, 10);
    const res = await this.pool.query<Row>(
      `UPDATE storage SET status = 'released', release_date = $1 WHERE id = $2 RETURNING *`,
      [date, Number(id)],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async prepare(id: string, opts: { preparedDate?: string; active?: boolean }): Promise<StorageRecord | null> {
    await this.init();
    const res = opts.active
      ? await this.pool.query<Row>(`UPDATE storage SET status = 'active', prepared_date = NULL WHERE id = $1 RETURNING *`, [Number(id)])
      : await this.pool.query<Row>(`UPDATE storage SET status = 'prepared', prepared_date = $1 WHERE id = $2 RETURNING *`,
          [opts.preparedDate ?? new Date().toISOString().slice(0, 10), Number(id)]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async blockSpot(location: string): Promise<StorageRecord> {
    await this.init();
    const res = await this.pool.query<Row>(
      `INSERT INTO storage (location, status, intake_date, notes) VALUES ($1,'blocked',$2,'Bloķēts') RETURNING *`,
      [location, new Date().toISOString().slice(0, 10)]);
    return toRecord(res.rows[0]);
  }

  async deleteRecord(id: string): Promise<boolean> {
    await this.init();
    const res = await this.pool.query('DELETE FROM storage WHERE id = $1', [Number(id)]);
    return (res.rowCount ?? 0) > 0;
  }

  async updateRecord(id: string, patch: Partial<StorageRecord>): Promise<StorageRecord | null> {
    await this.init();
    // field → column allowlist (snake_case). Only these keys are writable via edit.
    const MAP: Record<string, string> = {
      season: 'season', location: 'location', plate: 'plate', makeModel: 'make_model',
      customerName: 'customer_name', phone: 'phone', size1: 'size1', brand: 'brand',
      quantity: 'quantity', size2: 'size2', rimNote: 'rim_note', notes: 'notes',
      intakeDate: 'intake_date', releaseDate: 'release_date', threadDepth: 'thread_depth',
      smsCode: 'sms_code', feeEur: 'fee_eur',
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [key, col] of Object.entries(MAP)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        const v = (patch as Record<string, unknown>)[key];
        vals.push(v === '' || v === undefined ? null : v);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'isCompany')) { vals.push(!!patch.isCompany); sets.push(`is_company = $${vals.length}`); }
    if (!sets.length) return this.get(id);
    vals.push(Number(id));
    const res = await this.pool.query<Row>(`UPDATE storage SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async replaceAll(records: IntakeInput[]): Promise<{ imported: number }> {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE storage RESTART IDENTITY');
      const COLS = ['season', 'location', 'plate', 'make_model', 'customer_name', 'is_company', 'phone', 'size1', 'brand', 'quantity', 'size2', 'rim_note', 'notes', 'intake_date', 'release_date', 'status'];
      const BATCH = 500;
      let imported = 0;
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH);
        const values: unknown[] = [];
        const tuples = chunk.map((r, idx) => {
          const rd = (r as { releaseDate?: string }).releaseDate ?? null;
          const st = (r as { status?: string }).status ?? (rd ? 'released' : 'active');
          values.push(
            r.season ?? null, r.location ?? null, r.plate ?? null, r.makeModel ?? null,
            r.customerName ?? null, r.isCompany ?? false, r.phone ?? null, r.size1 ?? null,
            r.brand ?? null, r.quantity ?? null, r.size2 ?? null, r.rimNote ?? null,
            r.notes ?? null, r.intakeDate ?? null, rd, st,
          );
          const base = idx * COLS.length;
          return `(${COLS.map((_, c) => `$${base + c + 1}`).join(',')})`;
        });
        await client.query(`INSERT INTO storage (${COLS.join(',')}) VALUES ${tuples.join(',')}`, values);
        imported += chunk.length;
      }
      await client.query('COMMIT');
      return { imported };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // --- Auth ---
  async ensureAuth(): Promise<void> { await this.init(); }

  async getUserByUsername(username: string): Promise<User | null> {
    await this.init();
    const res = await this.pool.query<{ id: number; username: string; name: string; password_hash: string; role: string }>(
      'SELECT * FROM users WHERE username = $1', [username]);
    const r = res.rows[0];
    return r ? { id: String(r.id), username: r.username, name: r.name, passwordHash: r.password_hash, role: r.role === 'admin' ? 'admin' : 'staff' } : null;
  }

  async createUser(u: { username: string; name: string; passwordHash: string; role: 'admin' | 'staff' }): Promise<void> {
    await this.init();
    await this.pool.query('INSERT INTO users (username, name, password_hash, role) VALUES ($1,$2,$3,$4)',
      [u.username.toLowerCase(), u.name, u.passwordHash, u.role]);
  }

  async setPasswordByUsername(username: string, passwordHash: string): Promise<boolean> {
    await this.init();
    const res = await this.pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [passwordHash, username.toLowerCase()]);
    return (res.rowCount ?? 0) > 0;
  }

  async countUsers(): Promise<number> {
    await this.init();
    const res = await this.pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM users');
    return Number(res.rows[0].n);
  }

  async listUsers(): Promise<Array<{ id: string; username: string; name: string; role: 'admin' | 'staff'; createdAt: string | null }>> {
    await this.init();
    const res = await this.pool.query<{ id: number; username: string; name: string; role: string; created_at: string | null }>(
      'SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC, id ASC');
    return res.rows.map((r) => ({
      id: String(r.id), username: r.username, name: r.name,
      role: r.role === 'admin' ? 'admin' : 'staff', createdAt: r.created_at ? String(r.created_at) : null,
    }));
  }

  async deleteUserByUsername(username: string): Promise<boolean> {
    await this.init();
    const res = await this.pool.query('DELETE FROM users WHERE username = $1', [username.toLowerCase()]);
    return (res.rowCount ?? 0) > 0;
  }

  // --- Containers ---
  async listContainers(): Promise<Container[]> {
    await this.init();
    const res = await this.pool.query<{ id: number; prefix: string; label: string | null; rows: number; cols: number; created_at: string | null }>(
      'SELECT id, prefix, label, rows, cols, created_at FROM containers ORDER BY prefix ASC');
    return res.rows.map((r) => ({ id: String(r.id), prefix: r.prefix, label: r.label, rows: r.rows, cols: r.cols, createdAt: r.created_at ? String(r.created_at) : null }));
  }

  async createContainer(c: { prefix: string; label: string | null; rows: number; cols: number }): Promise<Container> {
    await this.init();
    const res = await this.pool.query<{ id: number; prefix: string; label: string | null; rows: number; cols: number; created_at: string | null }>(
      'INSERT INTO containers (prefix, label, rows, cols) VALUES ($1,$2,$3,$4) RETURNING id, prefix, label, rows, cols, created_at',
      [c.prefix, c.label, c.rows, c.cols]);
    const r = res.rows[0];
    return { id: String(r.id), prefix: r.prefix, label: r.label, rows: r.rows, cols: r.cols, createdAt: r.created_at ? String(r.created_at) : null };
  }

  async deleteContainer(id: string): Promise<boolean> {
    await this.init();
    const res = await this.pool.query('DELETE FROM containers WHERE id = $1', [Number(id)]);
    return (res.rowCount ?? 0) > 0;
  }
}
