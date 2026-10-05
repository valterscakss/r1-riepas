import { api } from '@/server/http';
import { deletePushSub } from '@/server/repo/misc';

export const POST = api('user', async ({ body }) => {
  const b = await body();
  if (typeof b.endpoint === 'string' && b.endpoint) await deletePushSub(b.endpoint);
  return { ok: true };
});
