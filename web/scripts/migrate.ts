/**
 * npm run db:migrate            — apply migrations to DATABASE_URL
 * tsx scripts/migrate.ts --if-configured
 *                               — same, but a no-op when DATABASE_URL is unset
 *                                 (used in the build, so CI builds without a DB)
 */
import { createPool } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';

const url = process.env.DATABASE_URL;
const soft = process.argv.includes('--if-configured');
// Preview deployments usually share the production DATABASE_URL. An unmerged
// branch must never change the production schema, so only production builds
// (or builds outside Vercel) migrate.
if (soft && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
  console.log(`[migrate] VERCEL_ENV=${process.env.VERCEL_ENV} — skipping migrations (production builds only).`);
  process.exit(0);
}
if (!url) {
  if (soft) {
    console.log('[migrate] DATABASE_URL not set — skipping migrations.');
    process.exit(0);
  }
  console.error('[migrate] DATABASE_URL is required');
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  await runMigrations(pool);
  console.log('[migrate] database is up to date');
} catch (e) {
  console.error('[migrate] failed:', e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
