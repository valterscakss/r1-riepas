import { api, conflict, HttpError } from '@/server/http';
import { planContainerEdit, readGrid, readPrefix } from '@/domain/containers';
import { createContainer, deleteContainer, listContainers, updateContainer } from '@/server/repo/misc';
import { loadUniverse } from '@/server/services';

export const GET = api({ any: ['screen.spots', 'screen.intake'] }, async () => ({ containers: await listContainers() }));

export const POST = api('admin', async ({ body }) => {
  const b = await body();
  const prefix = readPrefix(b.prefix);
  if (!prefix.ok) throw new HttpError(prefix.status, prefix.error);
  const grid = readGrid(b);
  if (!grid.ok) throw new HttpError(grid.status, grid.error);
  const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null;
  if ((await listContainers()).some((c) => c.prefix === prefix.value)) throw conflict(`Konteiners "${prefix.value}" jau eksistē`);
  let created;
  try {
    created = await createContainer({ prefix: prefix.value, label, ...grid.value });
  } catch {
    throw conflict(`Konteiners "${prefix.value}" jau eksistē`); // lost a race on the unique prefix
  }
  // The place numbers and zones drawn in the editor go through the same checks as
  // a redraw, so what the editor showed is what gets saved — and a name another
  // container already uses is refused instead of merging two places.
  if (b.names !== undefined || b.zones !== undefined) {
    const plan = planContainerEdit(created, { rows: grid.value.rows, cols: grid.value.cols, cells: grid.value.cells ?? undefined, names: b.names, zones: b.zones }, await loadUniverse());
    if (!plan.ok) { await deleteContainer(created.id); throw new HttpError(plan.status, plan.error); }
    created = (await updateContainer(created.id, plan.value)) ?? created;
  }
  return Response.json({ ok: true, container: created }, { status: 201 });
});
