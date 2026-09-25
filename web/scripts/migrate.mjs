// Plain-JS migration runner for the Docker image (no tsx there). Same lock and
// folder as src/server/db/migrate.ts.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const url = process.env.DATABASE_URL;
if (!url) { console.error('[migrate] DATABASE_URL is required'); process.exit(1); }
const ca = process.env.DATABASE_CA_CERT;
const ssl = ca ? { ca, rejectUnauthorized: true } : /supabase|sslmode=require|amazonaws|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined;
const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [4711001]);
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('[migrate] database is up to date');
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [4711001]).catch(() => {});
  await client.end();
}
