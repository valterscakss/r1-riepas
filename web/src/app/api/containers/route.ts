import { api, conflict, HttpError } from '@/server/http';
import { readGrid, readPrefix } from '@/domain/containers';
import { parseZones } from '@/domain/types';
import { createContainer, listContainers } from '@/server/repo/misc';

export const GET = api({ any: ['screen.spots', 'screen.intake'] }, async () => ({ containers: await listContainers() }));

export const POST = api('admin', async ({ body }) => {
  const b = await body();
  const prefix = readPrefix(b.prefix);
  if (!prefix.ok) throw new HttpError(prefix.status, prefix.error);
  const grid = readGrid(b);
  if (!grid.ok) throw new HttpError(grid.status, grid.error);
  const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null;
  if ((await listContainers()).some((c) => c.prefix === prefix.value)) throw conflict(`Konteiners "${prefix.value}" jau eksistē`);
  // Zones drawn during creation: a brand-new container has no records to guard.
  const zones = typeof b.zones === 'string' && b.zones ? parseZones(b.zones) : [];
  try {
    const container = await createContainer({ prefix: prefix.value, label, ...grid.value, zones: zones.length ? JSON.stringify(zones) : null });
    return Response.json({ ok: true, container }, { status: 201 });
  } catch {
    throw conflict(`Konteiners "${prefix.value}" jau eksistē`); // lost a race on the unique prefix
  }
});
