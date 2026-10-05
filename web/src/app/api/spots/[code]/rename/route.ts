import { api, conflict, HttpError } from '@/server/http';
import { planSpotRename } from '@/domain/containers';
import { foreignPrefix, loadUniverse } from '@/server/services';
import { renameLocation } from '@/server/repo/records';
import { updateContainer } from '@/server/repo/misc';

/**
 * Rename a place. Every record on the old code moves with it, so occupancy and
 * history follow the physical place, not the label.
 */
export const POST = api<{ code: string }>('admin', async ({ params, body, branchId }) => {
  const plan = planSpotRename(decodeURIComponent(params.code), (await body()).name, await loadUniverse(branchId));
  if (!plan.ok) throw new HttpError(plan.status, plan.error);
  if (!plan.value) return { ok: true, changed: 0, name: String((await body()).name ?? '').toUpperCase().replace(/\s+/g, '') };
  const { from, to, container } = plan.value;
  const fp = await foreignPrefix(to, branchId);
  if (fp) throw conflict(`Burts "${fp}" pieder citai filiālei — izvēlies citu nosaukumu`);
  if (container) await updateContainer(container.id, { names: container.names });
  return { ok: true, changed: await renameLocation(from, to), name: to };
});
