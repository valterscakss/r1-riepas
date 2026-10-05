import { api, bad, bustUser, conflict } from '@/server/http';
import { normRole } from '@/domain/types';
import { hashPassword } from '@/server/auth';
import * as usersRepo from '@/server/repo/users';
import { MIN_PW, USERNAME_RE, USERNAME_RULE } from '@/domain/users';

export const GET = api('admin', async () => ({ users: await usersRepo.listUsers() }));

export const POST = api('admin', async ({ body }) => {
  const b = await body();
  const username = String(b.username ?? '').trim().toLowerCase();
  const name = String(b.name ?? '').trim();
  const role = normRole(b.role); // anything unrecognised lands on 'staff'
  if (!USERNAME_RE.test(username)) throw bad(USERNAME_RULE);
  if (!name) throw bad('Vārds ir obligāts');
  if (String(b.password ?? '').length < MIN_PW) throw bad(`Parolei jābūt vismaz ${MIN_PW} rakstzīmes`);
  if (await usersRepo.getUser(username)) throw conflict('Lietotājs ar šādu vārdu jau eksistē');
  await usersRepo.createUser({ username, name, role, passwordHash: await hashPassword(String(b.password)) });
  bustUser(username); // a name reused right after a delete must not inherit the cached "no such user"
  return { ok: true, user: { username, name, role } };
});
