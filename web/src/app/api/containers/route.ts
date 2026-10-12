import { api, conflict, HttpError } from '@/server/http';
import { planContainerEdit, readGrid, readPrefix } from '@/domain/containers';
import { createContainer, deleteContainer, listContainers, updateContainer } from '@/server/repo/misc';
import { foreignPrefix, loadUniverse } from '@/server/services';
import { parseNames } from '@/domain/types';

export const GET = api({ any: ['screen.spots', 'screen.intake'] }, async ({ branchId }) => ({ containers: await listContainers(branchId) }));

export const POST = api('admin', async ({ body, branchId }) => {
  const b = await body();
  const prefix = readPrefix(b.prefix);
  if (!prefix.ok) throw new HttpError(prefix.status, prefix.error);
  const grid = readGrid(b);
  if (!grid.ok) throw new HttpError(grid.status, grid.error);
  const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null;
  // Rack letters are unique across ALL branches, so a code like "A1" always names
  // exactly one physical spot — no guessing which shop a slip refers to.
  const clash = (await listContainers()).find((c) => c.prefix === prefix.value);
  if (clash) throw conflict(`Konteiners "${prefix.value}" jau eksistē${clash.branchId === branchId ? '' : ' citā filiālē'} — izvēlies citu burtu`);
  let created;
  try {
    created = await createContainer({ prefix: prefix.value, label, ...grid.value, branchId });
  } catch {
    throw conflict(`Konteiners "${prefix.value}" jau eksistē`); // lost a race on the unique prefix
  }
  // The place numbers and zones drawn in the editor go through the same checks as
  // a redraw, so what the editor showed is what gets saved — and a name another
  // container already uses is refused instead of merging two places.
  if (b.names !== undefined || b.zones !== undefined) {
    const plan = planContainerEdit(created, { rows: grid.value.rows, cols: grid.value.cols, cells: grid.value.cells ?? undefined, names: b.names, zones: b.zones }, await loadUniverse(branchId));
    if (!plan.ok) { await deleteContainer(created.id); throw new HttpError(plan.status, plan.error); }
    for (const name of Object.values(parseNames(plan.value.names))) {
      const fp = await foreignPrefix(name, branchId);
      if (fp) { await deleteContainer(created.id); throw conflict(`Burts "${fp}" pieder citai filiālei — izvēlies citu nosaukumu`); }
    }
    created = (await updateContainer(created.id, plan.value)) ?? created;
  }
  return Response.json({ ok: true, container: created }, { status: 201 });
});
