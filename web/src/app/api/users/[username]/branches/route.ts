import { api, bad, notFound } from '@/server/http';
import { bustBranches } from '@/server/branch';
import { listBranches } from '@/server/repo/misc';
import * as users from '@/server/repo/users';

type P = { username: string };
const lc = (s: string) => s.trim().toLowerCase();

/** Which branches one user may open. null = every branch, including ones added later. */
export const GET = api<P>('admin', async ({ params }) => {
  const u = lc(decodeURIComponent(params.username));
  if (!(await users.getUser(u))) throw notFound('Lietotājs nav atrasts');
  return { username: u, branches: await users.getUserBranches(u), all: await listBranches() };
});

export const PUT = api<P>('admin', async ({ params, body }) => {
  const u = lc(decodeURIComponent(params.username));
  if (!(await users.getUser(u))) throw notFound('Lietotājs nav atrasts');
  const raw = (await body()).branches;
  let ids: string[] | null = null;
  if (Array.isArray(raw)) {
    const live = new Set((await listBranches()).map((b) => b.id));
    ids = [...new Set(raw.map(String))].filter((x) => live.has(x));
    if (!ids.length) throw bad('Jāatzīmē vismaz viena filiāle');
    // Ticking every branch is the same as no restriction, and keeps working when
    // a third shop is added later.
    if (ids.length === live.size) ids = null;
  }
  await users.setUserBranches(u, ids);
  bustBranches(u);
  return { ok: true, branches: ids };
});
