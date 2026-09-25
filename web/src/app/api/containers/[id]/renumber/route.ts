import { api, HttpError, notFound } from '@/server/http';
import { planRenumber } from '@/domain/containers';
import { loadUniverse } from '@/server/services';
import { renameLocation } from '@/server/repo/records';
import { updateContainer } from '@/server/repo/misc';

/** Clean sequential numbers again; every record moves with its place. */
export const POST = api<{ id: string }>('admin', async ({ params }) => {
  const u = await loadUniverse();
  const def = u.defs.find((c) => c.id === params.id);
  if (!def) throw notFound('Konteiners nav atrasts');
  const plan = planRenumber(def, u);
  if (!plan.ok) throw new HttpError(plan.status, plan.error);
  let renamed = 0;
  for (const s of plan.value.steps) renamed += await renameLocation(s.from, s.to);
  const container = await updateContainer(def.id, { names: plan.value.names });
  return { ok: true, places: plan.value.places, changed: plan.value.changed, renamed, container };
});
