import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, freshDb } from './db';
import { runMigrations } from '@/server/db/migrate';
import { createPool } from '@/server/db/client';

afterAll(closeDb);

describe('baseline migration', () => {
  it('builds every table the Express app used', async () => {
    const db = await freshDb();
    const { rows } = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    expect(rows.map((r) => r.table_name)).toEqual(
      ['branches', 'containers', 'photos', 'push_subs', 'record_events', 'settings', 'storage', 'tasks', 'users']);
  });

  it('is a no-op when run again', async () => {
    await freshDb();
    const pool = createPool(process.env.TEST_DATABASE_URL!, 1);
    await expect(runMigrations(pool)).resolves.toBeUndefined();
    await pool.end();
  });

  it('upgrades a database the Express app created, fixing its BRĪVS / AIZŅEMTS placeholder rows', async () => {
    const db = await freshDb();
    // Rewind to what production looks like today: the legacy table with legacy rows
    // and no record of any migration having run.
    await db.execute(sql.raw(`
      DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;
      CREATE TABLE storage (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, season TEXT, location TEXT, plate TEXT,
        make_model TEXT, customer_name TEXT, is_company BOOLEAN NOT NULL DEFAULT false, phone TEXT, size1 TEXT, brand TEXT,
        quantity TEXT, size2 TEXT, rim_note TEXT, notes TEXT, intake_date TEXT, release_date TEXT,
        status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO storage (location, plate) VALUES ('A1', 'BRĪVS'), ('A2', ' aizņemts '), ('A3', 'AB1234');
    `));
    const pool = createPool(process.env.TEST_DATABASE_URL!, 1);
    await runMigrations(pool);
    await pool.end();
    const { rows } = await db.execute<{ location: string; status: string; plate: string | null; sms_code: string | null; branch_id: number }>(
      sql`select location, status, plate, sms_code, branch_id from storage order by location`);
    const { rows: br } = await db.execute<{ id: number; name: string }>(sql`select id, name from branches`);
    expect(br).toHaveLength(1);
    // Rows that predate branches are adopted by the first shop, which is created once.
    expect(rows).toEqual([
      { location: 'A1', status: 'free', plate: null, sms_code: null, branch_id: br[0].id },
      { location: 'A2', status: 'blocked', plate: null, sms_code: null, branch_id: br[0].id },
      { location: 'A3', status: 'active', plate: 'AB1234', sms_code: null, branch_id: br[0].id },
    ]);
  });

  it('leaves a database alone that the Express app already moved to branches', async () => {
    const db = await freshDb();
    // The Express app ships the same change and creates it on its first boot.
    await db.execute(sql.raw(`
      DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;
      CREATE TABLE storage (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, season TEXT, location TEXT, plate TEXT,
        make_model TEXT, customer_name TEXT, is_company BOOLEAN NOT NULL DEFAULT false, phone TEXT, size1 TEXT, brand TEXT,
        quantity TEXT, size2 TEXT, rim_note TEXT, notes TEXT, intake_date TEXT, release_date TEXT,
        status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), branch_id INTEGER);
      CREATE TABLE branches (id SERIAL PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO branches (name) VALUES ('Rīga'), ('Jūrmala');
      INSERT INTO storage (location, plate, branch_id) VALUES ('A1', 'AB1', 1), ('D1', 'CD2', 2);
    `));
    const pool = createPool(process.env.TEST_DATABASE_URL!, 1);
    await runMigrations(pool);
    await pool.end();
    const { rows: br } = await db.execute<{ name: string }>(sql`select name from branches order by id`);
    expect(br.map((b) => b.name)).toEqual(['Rīga', 'Jūrmala']);
    const { rows } = await db.execute<{ location: string; branch_id: number }>(sql`select location, branch_id from storage order by location`);
    expect(rows).toEqual([{ location: 'A1', branch_id: 1 }, { location: 'D1', branch_id: 2 }]);
  });
});
