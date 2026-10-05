import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url));
// Any constant works; it only has to be the same for every instance.
const LOCK_KEY = 4_711_001;

/**
 * Apply pending migrations. An advisory lock makes concurrent runs (two deploys,
 * a deploy racing a developer) wait for each other instead of colliding.
 */
export async function runMigrations(pool: pg.Pool, folder = MIGRATIONS): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
