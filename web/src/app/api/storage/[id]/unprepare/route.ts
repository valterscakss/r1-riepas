import { api } from '@/server/http';
import { assertSameBranch, unprepare } from '@/server/services';

/** Undo a prepare — the set goes back in its place. */
export const POST = api<{ id: string }>({ perm: 'act.operate' }, async ({ params, body, actor, branchId }) => {
  await assertSameBranch(params.id, branchId);
  return unprepare(params.id, await body(), actor);
});
