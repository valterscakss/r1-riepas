import { api, conflict, notFound } from '@/server/http';
import { commentOf } from '@/domain/records';
import { normCode } from '@/domain/types';
import { loadUniverse } from '@/server/services';
import { blockSpot } from '@/server/repo/records';
import { logEvent } from '@/server/repo/misc';

/** Hold an empty place (no tires) so it is not handed out. */
export const POST = api<{ code: string }>({ perm: 'act.operate' }, async ({ params, body, actor }) => {
  const code = normCode(decodeURIComponent(params.code));
  // Membership in the place universe is the real check — custom names
  // (PLAUKTS-1) don't match letters+number but are perfectly valid.
  const u = await loadUniverse();
  if (!u.spots.some((s) => s.code === code)) throw notFound('Nezināma vieta');
  if (u.occupied.has(code)) throw conflict('Vieta jau ir aizņemta');
  const rec = await blockSpot(code);
  await logEvent(rec.id, 'blocked', commentOf((await body()).comment), actor);
  return Response.json(rec, { status: 201 });
});
