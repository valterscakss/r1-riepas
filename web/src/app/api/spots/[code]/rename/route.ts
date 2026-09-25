import { api, HttpError } from '@/server/http';
import { planSpotRename } from '@/domain/containers';
import { loadUniverse } from '@/server/services';
import { renameLocation } from '@/server/repo/records';
import { updateContainer } from '@/server/repo/misc';

/**
 * Rename a place. Every record on the old code moves with it, so occupancy and
 * history follow the physical place, not the label.
 */
export const POST = api<{ code: string }>('admin', async ({ params, body }) => {
  const plan = planSpotRename(decodeURIComponent(params.code), (await body()).name, await loadUniverse());
  if (!plan.ok) throw new HttpError(plan.status, plan.error);
  if (!plan.value) return { ok: true, changed: 0, name: String((await body()).name ?? '').toUpperCase().replace(/\s+/g, '') };
  const { from, to, container } = plan.value;
  if (container) await updateContainer(container.id, { names: container.names });
  return { ok: true, changed: await renameLocation(from, to), name: to };
});
