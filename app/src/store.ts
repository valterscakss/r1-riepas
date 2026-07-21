import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Store } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Datastore selection (in priority order):
 *   1. DATABASE_URL  -> Postgres / Supabase  (production)
 *   2. SHEET_ID+TAB  -> Google Sheets        (opt-in)
 *   3. otherwise     -> SQLite               (local dev / self-contained)
 * Stores are imported dynamically so a serverless build (Vercel) never bundles
 * the native SQLite module when Postgres is in use.
 */
async function makeStore(): Promise<Store> {
  if (process.env.DATABASE_URL) {
    const { PostgresStore } = await import('./stores/postgresStore.js');
    return new PostgresStore(process.env.DATABASE_URL);
  }
  if (process.env.SHEET_ID && process.env.SHEET_TAB) {
    const { SheetsStore } = await import('./stores/sheetsStore.js');
    return new SheetsStore(process.env.SHEET_ID, process.env.SHEET_TAB);
  }
  const { SqliteStore } = await import('./stores/sqliteStore.js');
  const dataDir = join(__dirname, '..', 'data');
  const dbFile = process.env.DB_FILE ?? join(dataDir, 'r1.db');
  const realSeed = join(dataDir, 'real-seed.json');
  const seed = process.env.SEED_FILE ?? (existsSync(realSeed) ? realSeed : join(dataDir, 'sample-seed.json'));
  return new SqliteStore(dbFile, seed);
}

let storeP: Promise<Store> | null = null;
/** Lazily construct the store once, seed the initial admin, and reuse it. */
export function getStore(): Promise<Store> {
  if (!storeP) {
    storeP = makeStore().then(async (s) => {
      const { seedAdmin } = await import('./auth.js');
      try { await seedAdmin(s); } catch (e) { console.error('[auth] admin seed failed:', e); }
      return s;
    });
  }
  return storeP;
}
