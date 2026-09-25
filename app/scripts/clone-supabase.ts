/**
 * Copy every app table from Supabase into a local Postgres (e.g. the
 * docker-compose `db` service) through the Supabase REST API — no database
 * password or direct Postgres connection to Supabase needed.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_… \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
 *     tsx scripts/clone-supabase.ts
 *
 * Creates the tables with the app's own DDL, then TRUNCATEs and reloads them,
 * keeping the original ids. Refuses to write to a *.supabase.* DATABASE_URL.
 */
import pg from 'pg';
import { DDL } from '../src/stores/postgresStore.js';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
if (!SUPABASE_URL || !KEY) { console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required'); process.exit(1); }
if (/supabase/.test(DATABASE_URL)) { console.error('DATABASE_URL points at Supabase — this script only writes to a local copy.'); process.exit(1); }

// Table → column to page by (its primary key).
const TABLES: Record<string, string> = {
  users: 'id', containers: 'id', storage: 'id', record_events: 'id', tasks: 'id',
  photos: 'id', settings: 'key', push_subs: 'endpoint',
};
const PAGE = 1000;

async function fetchAll(table: string, orderBy: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=${orderBy}.asc&limit=${PAGE}&offset=${offset}`,
      { headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await pool.query(DDL);
  await pool.query(`TRUNCATE ${Object.keys(TABLES).join(', ')} RESTART IDENTITY`);

  for (const [table, orderBy] of Object.entries(TABLES)) {
    const rows = await fetchAll(table, orderBy);
    if (rows.length) {
      // Supabase may carry columns the local DDL doesn't know yet — add them as TEXT.
      const { rows: have } = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
      const known = new Set(have.map((r) => r.column_name));
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      for (const c of cols.filter((c) => !known.has(c))) {
        console.warn(`  ${table}.${c} is not in the app DDL — adding it as TEXT`);
        await pool.query(`ALTER TABLE ${table} ADD COLUMN "${c}" TEXT`);
      }
      const batch = Math.max(1, Math.floor(60000 / cols.length));
      for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        const values: unknown[] = [];
        const tuples = chunk.map((row) => `(${cols.map((c) => {
          const v = row[c];
          values.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? null);
          return `$${values.length}`;
        }).join(',')})`);
        await pool.query(
          `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) OVERRIDING SYSTEM VALUE VALUES ${tuples.join(',')}`, values);
      }
    }
    if (orderBy === 'id') {
      await pool.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}))`);
    }
    console.log(`${table.padEnd(14)} ${rows.length}`);
  }
  await pool.end();
  console.log('Done.');
}
main().catch((e) => { console.error('Clone failed:', e.message); process.exit(1); });
