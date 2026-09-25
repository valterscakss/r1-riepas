/**
 * Fresh E2E database: schema dropped, migrations applied, synthetic sample
 * loaded, one rack drawn, an admin and a floor ('leja') user created.
 * (The server only seeds an admin into an EMPTY users table, so both are made here.)
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { createPool } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { containers, storage, users } from '../src/server/db/schema';
import { hashPassword } from '../src/server/auth';
import { E2E_ADMIN } from '../playwright.config';

const url = process.env.E2E_DATABASE_URL ?? 'postgres://r1:r1@localhost:5432/r1_e2e';
const admin = new pg.Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
await admin.connect();
const name = new URL(url).pathname.slice(1);
const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
if (!exists.rowCount) await admin.query(`create database "${name}"`);
await admin.end();

const pool = createPool(url, 1);
await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
await runMigrations(pool);
const db = drizzle(pool);
const seed = JSON.parse(readFileSync(new URL('../data/sample-seed.json', import.meta.url), 'utf8')) as { records: Array<Record<string, unknown>> };
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
await db.insert(storage).values(seed.records.map((r) => ({
  season: s(r.season), location: s(r.location), plate: s(r.plate), makeModel: s(r.makeModel), customerName: s(r.customerName),
  isCompany: !!r.isCompany, phone: s(r.phone), size1: s(r.size1), brand: s(r.brand), quantity: s(r.quantity), size2: s(r.size2),
  rimNote: s(r.rimNote), notes: s(r.notes), intakeDate: s(r.intakeDate), releaseDate: s(r.releaseDate), status: s(r.status) ?? 'active',
})));
await db.insert(containers).values({ prefix: 'A', rows: 2, cols: 4 });
await db.insert(users).values({ username: E2E_ADMIN.username, name: 'Administrator', role: 'admin', passwordHash: await hashPassword(E2E_ADMIN.password) });
await db.insert(users).values({ username: 'leja', name: 'Lejas Darbinieks', role: 'leja', passwordHash: await hashPassword('leja-password') });
await pool.end();
console.log(`[e2e] database ${name} ready`);
