import { api, notFound } from '@/server/http';
import { setTaskStatus } from '@/server/repo/misc';

export const POST = api<{ id: string }>('user', async ({ params }) => {
  const task = await setTaskStatus(params.id, 'open', null);
  if (!task) throw notFound('Uzdevums nav atrasts');
  return { ok: true, task };
});
