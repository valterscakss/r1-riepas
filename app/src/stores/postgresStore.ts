import pg from 'pg';
import type { Store, StorageRecord, IntakeInput } from '../types.js';

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
CREATE INDEX IF NOT EXISTS idx_storage_plate ON storage(UPPER(plate));
CREATE INDEX IF NOT EXISTS idx_storage_status ON storage(status);
CREATE INDEX IF NOT EXISTS idx_storage_location ON storage(location);
`;

interface Row {
  id: number; season: string | null; location: string | null; plate: string | null;
  make_model: string | null; customer_name: string | null; is_company: boolean;
  phone: string | null; size1: string | null; brand: string | null; quantity: string | null;
  size2: string | null; rim_note: string | null; notes: string | null;
  intake_date: string | null; release_date: string | null; status: string;
}

const toRecord = (r: Row): StorageRecord => ({
  id: String(r.id), season: r.season, location: r.location, plate: r.plate,
  makeModel: r.make_model, customerName: r.customer_name, isCompany: !!r.is_company,
  phone: r.phone, size1: r.size1, brand: r.brand, quantity: r.quantity,
  size2: r.size2, rimNote: r.rim_note, notes: r.notes,
  intakeDate: r.intake_date, releaseDate: r.release_date,
  status: r.status === 'released' ? 'released' : 'active',
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

  async list(opts?: { status?: 'active' | 'released'; q?: string }): Promise<StorageRecord[]> {
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
        (season, location, plate, make_model, customer_name, is_company, phone, size1, brand, quantity, size2, rim_note, notes, intake_date, release_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,'active') RETURNING *`,
      [
        input.season ?? null, input.location ?? null, input.plate ?? null, input.makeModel ?? null,
        input.customerName ?? null, input.isCompany ?? false, input.phone ?? null,
        input.size1 ?? null, input.brand ?? null, input.quantity ?? null, input.size2 ?? null,
        input.rimNote ?? null, input.notes ?? null, input.intakeDate ?? new Date().toISOString().slice(0, 10),
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
}
