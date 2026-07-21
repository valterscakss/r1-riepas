/**
 * Bulk-load a seed dataset into Postgres / Supabase.
 *
 * Usage:
 *   DATABASE_URL="postgres://…"  tsx scripts/load-postgres.ts [--file data/real-seed.json] [--truncate]
 *
 * Reads the normalized seed (from `npm run import:emit-seed`) and inserts rows
 * into the `storage` table, creating the table if needed. Use --truncate to
 * replace existing rows (careful in production).
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const FILE = opt('file') ?? 'data/real-seed.json';
const TRUNCATE = args.includes('--truncate');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }

const DDL = `CREATE TABLE IF NOT EXISTS storage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, season TEXT, location TEXT, plate TEXT,
  make_model TEXT, customer_name TEXT, is_company BOOLEAN NOT NULL DEFAULT false, phone TEXT,
  size1 TEXT, brand TEXT, quantity TEXT, size2 TEXT, rim_note TEXT, notes TEXT,
  intake_date TEXT, release_date TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());`;

function rowsFrom(raw: any): any[] {
  const recs: any[] = Array.isArray(raw) ? raw : raw.records ?? [];
  return recs.map((r) => [
    r.season ?? r.sheet ?? null,
    r.location ?? r.locationCode ?? null,
    r.plate ?? null,
    r.makeModel ?? null,
    r.customerName ?? null,
    r.isCompany ? true : false,
    r.phone ?? r.phoneE164 ?? null,
    r.size1 ?? r.tires?.[0]?.size ?? null,
    r.brand ?? r.tires?.[0]?.brand ?? null,
    r.quantity ?? r.quantityRaw ?? null,
    r.size2 ?? r.tires?.[1]?.size ?? null,
    r.rimNote ?? null,
    r.notes ?? null,
    r.intakeDate ?? null,
    r.releaseDate ?? null,
    r.status ?? (r.releaseDate ? 'released' : 'active'),
  ]);
}

const COLS = ['season', 'location', 'plate', 'make_model', 'customer_name', 'is_company', 'phone', 'size1', 'brand', 'quantity', 'size2', 'rim_note', 'notes', 'intake_date', 'release_date', 'status'];

async function main() {
  const ssl = /supabase|sslmode=require|amazonaws/.test(url!) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl, max: 4 });
  await pool.query(DDL);
  if (TRUNCATE) { await pool.query('TRUNCATE storage RESTART IDENTITY'); console.log('Truncated storage.'); }

  const rows = rowsFrom(JSON.parse(readFileSync(FILE, 'utf8')));
  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values: any[] = [];
    const tuples = chunk.map((row, r) => {
      const ph = COLS.map((_, c) => `$${r * COLS.length + c + 1}`);
      values.push(...row);
      return `(${ph.join(',')})`;
    });
    await pool.query(`INSERT INTO storage (${COLS.join(',')}) VALUES ${tuples.join(',')}`, values);
    done += chunk.length;
    process.stdout.write(`\rInserted ${done}/${rows.length}`);
  }
  console.log(`\nDone. Loaded ${done} records into storage.`);
  await pool.end();
}
main().catch((e) => { console.error('\nLoad failed:', e.message); process.exit(1); });
