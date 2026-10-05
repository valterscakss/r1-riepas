import { api } from '@/server/http';
import { assertSameBranch, release } from '@/server/services';

export const POST = api<{ id: string }>({ perm: 'act.operate' }, async ({ params, body, actor, branchId }) => {
  await assertSameBranch(params.id, branchId);
  return release(params.id, await body(), actor);
});
