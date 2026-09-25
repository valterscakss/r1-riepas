import { NextRequest } from 'next/server';
import { hashPassword } from '@/server/auth';
import * as usersRepo from '@/server/repo/users';
import { resetIpFailures } from '@/server/auth';
import type { Role } from '@/domain/types';

type Handler<P> = (req: NextRequest, ctx?: { params?: Promise<P> }) => Promise<Response>;

export interface CallOpts<P> {
  method?: string;
  body?: unknown;
  form?: FormData;
  cookie?: string;
  params?: P;
  headers?: Record<string, string>;
}

/** Invoke a Route Handler the way Next does, and parse the JSON reply. */
// Replies are asserted field by field in the tests, so they are typed loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<P = Record<string, string>, T = any>(handler: Handler<P>, url: string, o: CallOpts<P> = {}): Promise<{ status: number; body: T; res: Response }> {
  const headers = new Headers(o.headers);
  if (o.cookie) headers.set('cookie', o.cookie);
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers.set('content-type', 'application/json'); }
  const req = new NextRequest(new URL(url, 'http://localhost'), { method: o.method ?? (body ? 'POST' : 'GET'), headers, body });
  const res = await handler(req, { params: Promise.resolve((o.params ?? {}) as P) });
  const type = res.headers.get('content-type') ?? '';
  const parsed = type.includes('json') ? await res.json() : undefined;
  return { status: res.status, body: parsed as T, res };
}

export async function makeUser(username: string, role: Role, perms?: Record<string, boolean>, password = 'password123') {
  await usersRepo.createUser({ username, name: username.toUpperCase(), role, passwordHash: await hashPassword(password) });
  if (perms) await usersRepo.setUserPerms(username, JSON.stringify(perms));
}

/** Sign in through the real login route; returns the session cookie. */
export async function login(username: string, password = 'password123'): Promise<string> {
  resetIpFailures();
  const { POST } = await import('@/app/api/login/route');
  const r = await call(POST, '/api/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.res.headers.get('set-cookie')!.split(';')[0];
}
