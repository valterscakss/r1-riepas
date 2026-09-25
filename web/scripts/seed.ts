/**
 * npm run db:seed [-- --file path/to/seed.json] [--force]
 *
 * Loads a seed file (default: the synthetic data/sample-seed.json) into an EMPTY
 * storage table. --force loads even when rows exist. The real seed built from
 * the workbook (npm run import:emit-seed at the repo root) contains customer
 * data and stays out of git.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createPool } from '../src/server/db/client';
import { storage } from '../src/server/db/schema';

type SeedRecord = Partial<Record<string, unknown>>;

const args = process.argv.slice(2);
const at = args.indexOf('--file');
const file = at >= 0 ? args[at + 1] : new URL('../data/sample-seed.json', import.meta.url).pathname;
const url = process.env.DATABASE_URL;
if (!url) { console.error('[seed] DATABASE_URL is required'); process.exit(1); }

const raw = JSON.parse(readFileSync(file, 'utf8')) as { records?: SeedRecord[] } | SeedRecord[];
const records = Array.isArray(raw) ? raw : raw.records ?? [];
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

const pool = createPool(url, 1);
const db = drizzle(pool);
try {
  const [{ n }] = (await db.execute<{ n: string }>(sql`select count(*) as n from storage`)).rows;
  if (Number(n) > 0 && !args.includes('--force')) {
    console.log(`[seed] storage already has ${n} rows — nothing to do (use --force to add anyway).`);
  } else {
    for (let i = 0; i < records.length; i += 500) {
      await db.insert(storage).values(records.slice(i, i + 500).map((r) => ({
        season: str(r.season), location: str(r.location), plate: str(r.plate), makeModel: str(r.makeModel),
        customerName: str(r.customerName), isCompany: !!r.isCompany, phone: str(r.phone), size1: str(r.size1),
        brand: str(r.brand), quantity: str(r.quantity), size2: str(r.size2), rimNote: str(r.rimNote),
        notes: str(r.notes), intakeDate: str(r.intakeDate), releaseDate: str(r.releaseDate),
        status: str(r.status) ?? (r.releaseDate ? 'released' : 'active'),
        threadDepth: str(r.threadDepth), smsCode: str(r.smsCode), feeEur: str(r.feeEur),
      })));
    }
    console.log(`[seed] loaded ${records.length} records from ${file}`);
  }
} finally {
  await pool.end();
}
