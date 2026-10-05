import { api, bad } from '@/server/http';
import { bustBranches } from '@/server/branch';
import { createBranch } from '@/server/repo/misc';

/** The branches the signed-in user may open, and the one this request works in. */
export const GET = api('user', async ({ branches, branchId }) => ({
  branches: branches.map((b) => ({ id: b.id, name: b.name })),
  active: branchId,
}));

const readName = (v: unknown): string => {
  const name = String(v ?? '').trim();
  if (!name || name.length > 40) throw bad('Nosaukums: 1–40 rakstzīmes');
  return name;
};

/** Add a shop (admin). */
export const POST = api('admin', async ({ body }) => {
  const branch = await createBranch(readName((await body()).name));
  bustBranches();
  return Response.json({ ok: true, branch }, { status: 201 });
});
