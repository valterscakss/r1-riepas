import { api, bad, notFound } from '@/server/http';
import { redactEventComment } from '@/domain/perms';
import { getRecord } from '@/server/repo/records';
import { addEvent, listEvents } from '@/server/repo/misc';
import { assertSameBranch } from '@/server/services';

type P = { id: string };

export const GET = api<P>('user', async ({ params, perms, branchId }) => {
  await assertSameBranch(params.id, branchId);
  return { events: (await listEvents(params.id)).map((e) => ({ ...e, comment: redactEventComment(e.action, e.comment, perms) })) };
});

export const POST = api<P>({ perm: 'act.media' }, async ({ params, body, actor, branchId }) => {
  const rec = await getRecord(params.id);
  if (!rec) throw notFound();
  await assertSameBranch(rec.id, branchId);
  const b = await body();
  const comment = typeof b.comment === 'string' ? b.comment.trim() : '';
  if (!comment) throw bad('Komentārs ir tukšs');
  const event = await addEvent({ recordId: rec.id, action: 'comment', comment: comment.slice(0, 500), actor });
  return Response.json({ ok: true, event }, { status: 201 });
});
