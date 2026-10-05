import { api, notFound } from '@/server/http';
import { deleteTask } from '@/server/repo/misc';

export const DELETE = api<{ id: string }>('user', async ({ params }) => {
  if (!(await deleteTask(params.id))) throw notFound('Uzdevums nav atrasts');
  return { ok: true };
});
