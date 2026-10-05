import { clearedSessionCookie } from '@/server/auth';

export function POST() {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie() } });
}
