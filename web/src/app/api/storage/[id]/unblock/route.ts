import { api, bad, notFound } from '@/server/http';
import * as records from '@/server/repo/records';

/** Unblock: remove the placeholder that was holding the place. */
export const POST = api<{ id: string }>({ perm: 'act.operate' }, async ({ params }) => {
  const rec = await records.getRecord(params.id);
  if (!rec) throw notFound();
  if (rec.status !== 'blocked') throw bad('Šī vieta nav bloķēta');
  await records.deleteRecord(rec.id);
  return { ok: true };
});
