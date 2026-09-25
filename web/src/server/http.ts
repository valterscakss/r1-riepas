import type { NextRequest } from 'next/server';
import { ALL_OFF, computePerms, type PermKey, type Perms } from '@/domain/perms';
import type { Role } from '@/domain/types';
import { ensureAdminOnce, tokenFrom, verifyToken, type SessionUser } from './auth';
import * as usersRepo from './repo/users';

/** A failure the client should see as-is. Anything else is logged and becomes a generic 500. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const bad = (message: string) => new HttpError(400, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

export const errorJson = (status: number, message: string) => Response.json({ error: { message } }, { status });

/**
 * Who may call an endpoint:
 *  - 'public'  — anyone
 *  - 'user'    — any signed-in user (their perms are still attached for redaction)
 *  - 'admin'   — the user's CURRENT role is admin
 *  - { perm }  — holds that permission; { any } — holds at least one of them
 */
export type Access = 'public' | 'user' | 'admin' | { perm: PermKey } | { any: PermKey[] };

export interface Ctx<P> {
  req: NextRequest;
  params: P;
  user: SessionUser;
  perms: Perms;
  /** Username for the history / task stamps. */
  actor: string;
  query: URLSearchParams;
  /** The JSON body as an object; malformed or missing → {}. */
  body: () => Promise<Record<string, unknown>>;
}

// Role and permissions come from the user's row, not from the token they hold,
// so a rename, a role change or a deletion takes effect on open sessions at once.
// Cached briefly so list endpoints don't pay a users-table read per request.
const TTL = 30_000;
const cache = new Map<string, { at: number; row: { name: string; role: Role; perms: Perms } | null }>();

export function bustUser(username: string): void { cache.delete(username.toLowerCase()); }
/** Test hook: forget every cached user. */
export function clearUserCache(): void { cache.clear(); }

async function currentRow(username: string) {
  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.row;
  const u = await usersRepo.getUser(key);
  const row = u ? { name: u.name, role: u.role, perms: computePerms(u.role, u.perms) } : null;
  cache.set(key, { at: Date.now(), row });
  return row;
}

/** The signed-in user and their effective permissions, or null. */
export async function sessionFrom(req: Request): Promise<{ user: SessionUser; perms: Perms } | null> {
  const token = tokenFrom(req);
  const claims = token ? await verifyToken(token) : null;
  if (!claims) return null;
  const row = await currentRow(claims.username);
  if (!row) return null; // renamed or deleted: the token names nobody
  return { user: { ...claims, name: row.name, role: row.role }, perms: row.perms };
}

function allowed(access: Exclude<Access, 'public'>, user: SessionUser, perms: Perms): boolean {
  if (access === 'user') return true;
  if (access === 'admin') return user.role === 'admin';
  if ('perm' in access) return perms[access.perm];
  return access.any.some((k) => perms[k]);
}

type Handler<P> = (ctx: Ctx<P>) => Promise<Response | object>;

/** Wrap a Route Handler with authentication, authorisation and error handling. */
export function api<P = Record<string, string>>(access: Access, fn: Handler<P>) {
  return async (req: NextRequest, context?: { params?: Promise<P> }): Promise<Response> => {
    try {
      await ensureAdminOnce();
      const params = (context?.params ? await context.params : {}) as P;
      let user: SessionUser = { id: '', username: '', name: '', role: 'staff' };
      let perms: Perms = ALL_OFF;
      if (access !== 'public') {
        const s = await sessionFrom(req);
        if (!s) return errorJson(401, 'Authentication required');
        if (!allowed(access, s.user, s.perms)) return errorJson(403, access === 'admin' ? 'Admin role required' : 'Nav tiesību šai sadaļai');
        ({ user, perms } = s);
      }
      let parsed: Record<string, unknown> | null = null;
      const body = async () => {
        if (parsed) return parsed;
        try {
          const v = await req.json();
          parsed = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
        } catch { parsed = {}; }
        return parsed;
      };
      const out = await fn({ req, params, user, perms, actor: user.username, query: req.nextUrl.searchParams, body });
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      if (e instanceof HttpError) return errorJson(e.status, e.message);
      console.error(`[api] ${req.method} ${req.nextUrl.pathname} failed:`, e);
      return errorJson(500, 'Servera kļūda. Mēģini vēlreiz.');
    }
  };
}

/** A string query parameter, trimmed; '' when absent. */
export const qs = (q: URLSearchParams, k: string) => (q.get(k) ?? '').trim();

export const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
