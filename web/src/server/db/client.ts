import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;

/**
 * TLS for hosted Postgres. Supabase signs its certificates with its own root CA,
 * which Node does not trust by default. Put that CA (Supabase → Settings →
 * Database → SSL certificate) in DATABASE_CA_CERT to get a fully verified
 * connection; without it the link is still encrypted but the server certificate
 * is not checked — the old app's behaviour, now with a warning in the log.
 */
function sslFor(url: string): pg.PoolConfig['ssl'] {
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) return { ca, rejectUnauthorized: true };
  if (/supabase|sslmode=require|amazonaws|neon\.tech/.test(url)) {
    console.warn('[db] DATABASE_CA_CERT not set — TLS is on but the server certificate is not verified.');
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export function createPool(url: string, max = Number(process.env.DATABASE_POOL_MAX ?? 3)): pg.Pool {
  // Serverless: many short-lived instances, so each keeps only a few connections.
  // Point DATABASE_URL at the Supabase pooler (port 6543) in production.
  return new pg.Pool({ connectionString: url, ssl: sslFor(url), max, idleTimeoutMillis: 10_000 });
}

// One pool per server process; survives Next dev hot reloads via globalThis.
const g = globalThis as unknown as { __r1Pool?: pg.Pool; __r1Db?: DB };

export function getDb(): DB {
  if (!g.__r1Db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__r1Pool = createPool(url);
    g.__r1Db = drizzle(g.__r1Pool, { schema });
  }
  return g.__r1Db;
}

/** Tests swap in their own database. */
export function setDb(db: DB | undefined, pool?: pg.Pool): void {
  g.__r1Db = db;
  g.__r1Pool = pool;
}
