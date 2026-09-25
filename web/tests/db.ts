import { drizzle } from 'drizzle-orm/node-postgres';
import { createPool, setDb, type DB } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import * as schema from '@/server/db/schema';
import type pg from 'pg';

let pool: pg.Pool | null = null;

/**
 * A clean, migrated test database: the public schema is dropped and rebuilt
 * from the migrations, so each test file starts from exactly production's shape.
 */
export async function freshDb(): Promise<DB> {
  pool ??= createPool(process.env.TEST_DATABASE_URL!, 4);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await runMigrations(pool);
  const db = drizzle(pool, { schema });
  setDb(db, pool);
  return db;
}

export async function closeDb(): Promise<void> {
  setDb(undefined);
  if (pool) { await pool.end(); pool = null; }
}
