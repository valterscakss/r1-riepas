import { api, HttpError, notFound } from '@/server/http';
import { planContainerEdit } from '@/domain/containers';
import { loadUniverse } from '@/server/services';
import { deleteContainer, updateContainer } from '@/server/repo/misc';

type P = { id: string };

/** Redraw a container. Places holding tires cannot be drawn away. */
export const PATCH = api<P>('admin', async ({ params, body }) => {
  const u = await loadUniverse();
  const def = u.defs.find((c) => c.id === params.id);
  if (!def) throw notFound('Konteiners nav atrasts');
  const plan = planContainerEdit(def, await body(), u);
  if (!plan.ok) throw new HttpError(plan.status, plan.error);
  return { ok: true, container: await updateContainer(def.id, plan.value) };
});

/** Removes the drawing only; records on its places stay. */
export const DELETE = api<P>('admin', async ({ params }) => {
  if (!(await deleteContainer(params.id))) throw notFound('Konteiners nav atrasts');
  return { ok: true };
});
