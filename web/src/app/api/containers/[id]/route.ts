import { api, conflict, HttpError, notFound } from '@/server/http';
import { planContainerEdit } from '@/domain/containers';
import { foreignPrefix, loadUniverse } from '@/server/services';
import { parseNames } from '@/domain/types';
import { listContainers } from '@/server/repo/misc';
import { deleteContainer, updateContainer } from '@/server/repo/misc';

type P = { id: string };

/** Redraw a container. Places holding tires cannot be drawn away. */
export const PATCH = api<P>('admin', async ({ params, body, branchId }) => {
  const u = await loadUniverse(branchId);
  const def = u.defs.find((c) => c.id === params.id);
  if (!def) throw notFound('Konteiners nav atrasts');
  const plan = planContainerEdit(def, await body(), u);
  if (!plan.ok) throw new HttpError(plan.status, plan.error);
  const before = new Set(Object.values(parseNames(def.names)));
  for (const name of Object.values(parseNames(plan.value.names))) {
    if (before.has(name)) continue;
    const fp = await foreignPrefix(name, branchId);
    if (fp) throw conflict(`Burts "${fp}" pieder citai filiālei — izvēlies citu nosaukumu`);
  }
  return { ok: true, container: await updateContainer(def.id, plan.value) };
});

/** Removes the drawing only; records on its places stay. */
export const DELETE = api<P>('admin', async ({ params, branchId }) => {
  if (!(await listContainers(branchId)).some((c) => c.id === params.id) || !(await deleteContainer(params.id))) throw notFound('Konteiners nav atrasts');
  return { ok: true };
});
