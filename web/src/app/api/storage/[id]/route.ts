import { api, bad, notFound } from '@/server/http';
import { redactRecord } from '@/domain/perms';
import { editSummary, readEditPatch } from '@/domain/records';
import * as records from '@/server/repo/records';
import { logEvent } from '@/server/repo/misc';

type P = { id: string };

// Open to every signed-in role (the floor opens records from the job queue);
// the fields they may not see are cut out.
export const GET = api<P>('user', async ({ params, perms }) => {
  const rec = await records.getRecord(params.id);
  if (!rec) throw notFound();
  return redactRecord(rec, perms);
});

/** Manual edit (Tabula). Only allowlisted keys apply; the history records old → new. */
export const PATCH = api<P>({ perm: 'act.edit' }, async ({ params, body, actor }) => {
  const b = await body();
  const patch = readEditPatch(b);
  if (!Object.keys(patch).length) throw bad('No editable fields provided');
  const before = await records.getRecord(params.id);
  const rec = await records.updateRecord(params.id, patch);
  if (!rec) throw notFound();
  await logEvent(rec.id, 'edited', editSummary(before, rec, Object.keys(patch), b.comment).slice(0, 500), actor);
  return { ok: true, record: rec };
});
