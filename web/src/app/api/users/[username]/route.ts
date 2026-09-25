import { api, bad, conflict, notFound, bustUser } from '@/server/http';
import { normRole, type Role } from '@/domain/types';
import { sessionCookie, signToken } from '@/server/auth';
import * as usersRepo from '@/server/repo/users';
import { USERNAME_RE, USERNAME_RULE } from '@/domain/users';

type P = { username: string };

/**
 * Edit login name, display name and role. The row keeps its id and permission
 * overrides. Editing yourself hands back a fresh token (and cookie) so the
 * admin isn't logged out of the session they are doing it from.
 */
export const PATCH = api<P>('admin', async ({ params, body, user }) => {
  const from = decodeURIComponent(params.username).trim().toLowerCase();
  const target = await usersRepo.getUser(from);
  if (!target) throw notFound('Lietotājs nav atrasts');
  const b = await body();
  const isSelf = user.username.toLowerCase() === from;
  const patch: { username?: string; name?: string; role?: Role } = {};
  if (b.username !== undefined) {
    const to = String(b.username).trim().toLowerCase();
    if (!USERNAME_RE.test(to)) throw bad(USERNAME_RULE);
    if (to !== from) {
      if (await usersRepo.getUser(to)) throw conflict('Lietotājs ar šādu vārdu jau eksistē');
      patch.username = to;
    }
  }
  if (b.name !== undefined) {
    const nm = String(b.name).trim();
    if (!nm) throw bad('Vārds ir obligāts');
    if (nm !== target.name) patch.name = nm;
  }
  if (b.role !== undefined) {
    const rl = normRole(b.role);
    if (rl !== target.role) {
      if (isSelf) throw bad('Savu lomu nevar mainīt — palūdz to izdarīt citam administratoram');
      if (target.role === 'admin' && (await usersRepo.countAdmins()) <= 1) throw bad('Nevar noņemt pēdējam administratoram administratora lomu');
      patch.role = rl;
    }
  }
  if (!Object.keys(patch).length) return { ok: true, changed: false, user: { username: target.username, name: target.name, role: target.role } };
  await usersRepo.updateUser(from, patch);
  bustUser(from);
  if (patch.username) bustUser(patch.username);
  const next = { id: target.id, username: patch.username ?? target.username, name: patch.name ?? target.name, role: patch.role ?? target.role };
  const token = isSelf ? await signToken(next) : undefined;
  return Response.json({
    ok: true, changed: true, user: { username: next.username, name: next.name, role: next.role },
    token, reauth: !isSelf && !!(patch.username || patch.role),
  }, token ? { headers: { 'Set-Cookie': sessionCookie(token) } } : undefined);
});

export const DELETE = api<P>('admin', async ({ params, user }) => {
  const u = decodeURIComponent(params.username).trim().toLowerCase();
  const target = await usersRepo.getUser(u);
  if (!target) throw notFound('Lietotājs nav atrasts');
  if (user.username.toLowerCase() === u) throw bad('Nevar dzēst savu kontu');
  if (target.role === 'admin' && (await usersRepo.countAdmins()) <= 1) throw bad('Nevar dzēst pēdējo administratoru');
  await usersRepo.deleteUser(u);
  bustUser(u);
  return { ok: true };
});
