import { api, bad, notFound } from '@/server/http';
import { hashPassword } from '@/server/auth';
import * as usersRepo from '@/server/repo/users';
import { MIN_PW } from '@/domain/users';

export const POST = api<{ username: string }>('admin', async ({ params, body }) => {
  const u = decodeURIComponent(params.username).trim().toLowerCase();
  const password = String((await body()).password ?? '');
  if (password.length < MIN_PW) throw bad(`Parolei jābūt vismaz ${MIN_PW} rakstzīmes`);
  if (!(await usersRepo.setPassword(u, await hashPassword(password)))) throw notFound('Lietotājs nav atrasts');
  return { ok: true };
});
