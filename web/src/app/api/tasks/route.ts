import { api, bad, qs } from '@/server/http';
import { parseOrder } from '@/domain/tasks';
import { countOpenTasks, createTask, listTasks } from '@/server/repo/misc';
import { announceTask } from '@/server/services';

/** The warehouse queue. Every signed-in role works from it. */
export const GET = api('user', async ({ query }) => {
  const s = qs(query, 'status');
  const status = s === 'done' ? 'done' : s === 'all' ? undefined : 'open';
  const tasks = await listTasks({ status, limit: status === 'done' ? 50 : 200 });
  return { tasks, open: status === 'open' ? tasks.length : await countOpenTasks() };
});

/** A free-text order for the warehouse ("4× Nokian 205/55/16 no A ceha"). */
export const POST = api('user', async ({ body, actor }) => {
  const b = await body();
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) throw bad('Ieraksti, ko vajag no noliktavas');
  const up = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);
  const task = await createTask({ kind: 'order', recordId: null, ...parseOrder(text), location: up(b.location), plate: up(b.plate), createdBy: actor });
  announceTask(task);
  return Response.json({ ok: true, task }, { status: 201 });
});
