import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, store: 'postgres' });
  } catch (e) {
    console.error('[health] database check failed:', e);
    return Response.json({ ok: false, store: 'postgres' }, { status: 503 });
  }
}
