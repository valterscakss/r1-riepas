import { api, errorJson } from '@/server/http';
import { hashPassword, verifyPassword } from '@/server/auth';
import * as usersRepo from '@/server/repo/users';
import { MIN_PW } from '@/domain/users';

export const POST = api('user', async ({ user, body }) => {
  const b = await body();
  if (String(b.newPassword ?? '').length < MIN_PW) return errorJson(400, `Jaunajai parolei jābūt vismaz ${MIN_PW} rakstzīmes`);
  const row = await usersRepo.getUser(user.username);
  if (!row || !(await verifyPassword(String(b.currentPassword ?? ''), row.passwordHash))) return errorJson(401, 'Nepareiza pašreizējā parole');
  await usersRepo.setPassword(row.username, await hashPassword(String(b.newPassword)));
  return { ok: true };
});
