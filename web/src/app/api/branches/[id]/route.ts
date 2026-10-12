import { api, bad, notFound } from '@/server/http';
import { bustBranches } from '@/server/branch';
import { listBranches, updateBranch } from '@/server/repo/misc';

/** Rename a branch or switch it off/on (admin). At least one must stay active. */
export const PATCH = api<{ id: string }>('admin', async ({ params, body }) => {
  const b = await body();
  const patch: { name?: string; active?: boolean } = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name || name.length > 40) throw bad('Nosaukums: 1–40 rakstzīmes');
    patch.name = name;
  }
  if (b.active !== undefined) {
    const active = !!b.active;
    // Never leave the shop with no branch to work in.
    if (!active && !(await listBranches()).some((x) => x.active && x.id !== params.id)) throw bad('Vismaz vienai filiālei jāpaliek aktīvai');
    patch.active = active;
  }
  const branch = await updateBranch(params.id, patch);
  if (!branch) throw notFound('Filiāle nav atrasta');
  bustBranches();
  return { ok: true, branch };
});
