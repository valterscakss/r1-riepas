import { api, HttpError, notFound } from '@/server/http';
import { deleteEvent, getEvent, updateEventComment } from '@/server/repo/misc';

type P = { id: string };

/**
 * Only comments are editable. The rest of the history (created, released,
 * edited…) is the audit trail and stays as it was written.
 */
async function comment(id: string) {
  const ev = await getEvent(id);
  if (!ev) throw notFound();
  if (ev.action !== 'comment') throw new HttpError(403, 'Labot vai dzēst var tikai komentārus');
  return ev;
}

export const PATCH = api<P>({ perm: 'act.media' }, async ({ params, body }) => {
  await comment(params.id);
  const b = await body();
  const text = typeof b.comment === 'string' ? b.comment.trim().slice(0, 500) : '';
  return { ok: true, event: await updateEventComment(params.id, text || null) };
});

export const DELETE = api<P>({ perm: 'act.media' }, async ({ params }) => {
  await comment(params.id);
  await deleteEvent(params.id);
  return { ok: true };
});
