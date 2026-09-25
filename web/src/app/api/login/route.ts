import { api, clientIp, errorJson } from '@/server/http';
import { clearLoginFailures, loginBlockedFor, recordLoginFailure, sessionCookie, signToken, toSession, verifyPassword } from '@/server/auth';
import { computePerms } from '@/domain/perms';
import * as usersRepo from '@/server/repo/users';

export const POST = api('public', async ({ req, body }) => {
  const b = await body();
  if (!b.username || !b.password) return errorJson(400, 'Username and password required');
  // Case-insensitive username (guards against mobile auto-capitalisation).
  const username = String(b.username).trim().toLowerCase();
  const ip = clientIp(req);
  const wait = await loginBlockedFor(username, ip);
  if (wait) return errorJson(429, `Pārāk daudz neveiksmīgu mēģinājumu. Mēģini vēlreiz pēc ${wait} min.`);
  const user = await usersRepo.getUser(username);
  if (!user || !(await verifyPassword(String(b.password), user.passwordHash))) {
    await recordLoginFailure(username, ip);
    return errorJson(401, 'Invalid username or password');
  }
  await clearLoginFailures(username);
  const session = toSession(user);
  const token = await signToken(session);
  // The token also comes back in the body for API clients; the web UI relies on
  // the httpOnly cookie alone, so script on the page never holds the session.
  return Response.json({ user: session, token, perms: computePerms(user.role, user.perms) }, { headers: { 'Set-Cookie': sessionCookie(token) } });
});
