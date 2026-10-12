import { api, bad, notFound, bustUser } from '@/server/http';
import { diffFromDefaults, parseOverrides, PERM_KEYS, ROLE_DEFAULTS } from '@/domain/perms';
import * as usersRepo from '@/server/repo/users';

type P = { username: string };

/** Per-user checklist: role defaults, this user's overrides, and the result. */
export const GET = api<P>('admin', async ({ params }) => {
  const u = decodeURIComponent(params.username).trim().toLowerCase();
  const target = await usersRepo.getUser(u);
  if (!target) throw notFound('Lietotājs nav atrasts');
  const defaults = ROLE_DEFAULTS[target.role] ?? ROLE_DEFAULTS.staff;
  const overrides = parseOverrides(target.perms);
  return { username: u, role: target.role, keys: PERM_KEYS, defaults, overrides, effective: { ...defaults, ...overrides } };
});

/** Store only real deviations from the role defaults, so a later role change brings its new defaults. */
export const PUT = api<P>('admin', async ({ params, body }) => {
  const u = decodeURIComponent(params.username).trim().toLowerCase();
  const target = await usersRepo.getUser(u);
  if (!target) throw notFound('Lietotājs nav atrasts');
  if (target.role === 'admin') throw bad('Administratoram vienmēr ir visas tiesības');
  const overrides = diffFromDefaults(target.role, await body());
  await usersRepo.setUserPerms(u, Object.keys(overrides).length ? JSON.stringify(overrides) : null);
  bustUser(u);
  return { ok: true, overrides };
});
