import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { normRole, type Role, type User } from '@/domain/types';
import * as usersRepo from './repo/users';
import { getSetting, setSetting } from './repo/misc';

/** Same cookie name as the Express app, so a signed-in browser stays signed in across the switch. */
export const SESSION_COOKIE = 'r1_session';
export const SESSION_TTL_S = 12 * 60 * 60;

export interface SessionUser { id: string; username: string; name: string; role: Role }

const DEV_SECRET = 'dev-only-insecure-secret-change-me';
let warned = false;
function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET must be set in production');
    if (!warned) { console.warn('[auth] AUTH_SECRET not set — using an insecure dev secret.'); warned = true; }
  }
  return new TextEncoder().encode(s || DEV_SECRET);
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** HS256 with the same claims as jsonwebtoken produced, so old tokens verify here and vice versa. */
export async function signToken(u: SessionUser): Promise<string> {
  return new SignJWT({ id: u.id, username: u.username, name: u.name, role: u.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(secret());
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (typeof payload.username !== 'string') return null;
    return { id: String(payload.id ?? ''), username: payload.username, name: String(payload.name ?? payload.username), role: normRole(payload.role) };
  } catch { return null; }
}

/** The session token from the cookie, or an `Authorization: Bearer` header (API clients, old installed PWAs). */
export function tokenFrom(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export const toSession = (u: User): SessionUser => ({ id: u.id, username: u.username, name: u.name, role: u.role });

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_S}${secure}`;
}
export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ---- Initial admin ----

/** Settings key holding a fingerprint of the ADMIN_PASSWORD already applied. */
const ADMIN_PW_KEY = 'admin_password_applied';

/**
 * Seed the first admin from ADMIN_USERNAME / ADMIN_PASSWORD on an empty users
 * table. Afterwards ADMIN_PASSWORD is a reset lever that fires only when the env
 * value CHANGES (tracked by fingerprint), so a password chosen through "Mainīt
 * paroli" survives restarts. Same rules and settings key as the Express app.
 */
export async function ensureAdmin(): Promise<void> {
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fingerprint = password ? createHash('sha256').update(`${username}:${password}`).digest('hex') : null;
  const remember = async () => { if (fingerprint) await setSetting(ADMIN_PW_KEY, fingerprint).catch(() => undefined); };
  if ((await usersRepo.countUsers()) === 0) {
    if (!password) { console.warn('[auth] No users and ADMIN_PASSWORD not set — no admin was created.'); return; }
    await usersRepo.createUser({ username, name: 'Administrator', passwordHash: await hashPassword(password), role: 'admin' });
    await remember();
    console.log(`[auth] Seeded initial admin user "${username}".`);
    return;
  }
  if (!password) return;
  const applied = await getSetting<string>(ADMIN_PW_KEY).catch(() => null);
  if (applied === fingerprint) return;
  // A database that predates this bookkeeping: record without forcing, so a
  // password changed by hand survives; later env changes still reset it.
  if (applied === null) { await remember(); return; }
  if (await usersRepo.setPassword(username, await hashPassword(password))) {
    await remember();
    console.log(`[auth] ADMIN_PASSWORD changed — reset the password for admin user "${username}".`);
  }
}

let adminP: Promise<void> | null = null;
/** Run ensureAdmin once per server process; a failure is retried on the next request. */
export function ensureAdminOnce(): Promise<void> {
  adminP ??= ensureAdmin().catch((e) => { adminP = null; console.error('[auth] admin seed failed:', e); });
  return adminP;
}

// ---- Login throttling ----

/**
 * Brute-force guard. Failures per username live in the settings table so the
 * count holds across serverless instances; a per-IP count in memory slows one
 * client spraying many usernames at the same instance.
 */
export const LOGIN_MAX_FAILS = 5;
const LOGIN_IP_MAX_FAILS = 20;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
type FailRec = { n: number; first: number };
const ipFails = new Map<string, FailRec>();
const failKey = (u: string) => `login_fail:${u}`;
const live = (r: FailRec | null | undefined, now: number): r is FailRec => !!r && now - r.first < LOGIN_WINDOW_MS;

/** Minutes until the lockout lifts, or 0 when the attempt may proceed. */
export async function loginBlockedFor(username: string, ip: string, now = Date.now()): Promise<number> {
  const ipRec = ipFails.get(ip);
  const userRec = await getSetting<FailRec>(failKey(username)).catch(() => null);
  const blocked = [live(ipRec, now) && ipRec.n >= LOGIN_IP_MAX_FAILS ? ipRec : null, live(userRec, now) && userRec.n >= LOGIN_MAX_FAILS ? userRec : null]
    .filter((r): r is FailRec => !!r);
  if (!blocked.length) return 0;
  const until = Math.max(...blocked.map((r) => r.first + LOGIN_WINDOW_MS));
  return Math.max(1, Math.ceil((until - now) / 60000));
}

export async function recordLoginFailure(username: string, ip: string, now = Date.now()): Promise<void> {
  const prev = await getSetting<FailRec>(failKey(username)).catch(() => null);
  await setSetting(failKey(username), live(prev, now) ? { n: prev.n + 1, first: prev.first } : { n: 1, first: now }).catch(() => undefined);
  const ipRec = ipFails.get(ip);
  if (ipFails.size > 5000) ipFails.clear(); // bounded memory; the per-user count is the real guard
  ipFails.set(ip, live(ipRec, now) ? { n: ipRec.n + 1, first: ipRec.first } : { n: 1, first: now });
}

export async function clearLoginFailures(username: string): Promise<void> {
  await setSetting(failKey(username), { n: 0, first: 0 }).catch(() => undefined);
}

/** Test hook. */
export const resetIpFailures = () => ipFails.clear();
