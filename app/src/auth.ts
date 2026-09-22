import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import type express from 'express';
import type { Store, User, Role } from './types.js';

export const COOKIE = 'r1_session';
const DEV_SECRET = 'dev-only-insecure-secret-change-me';
const SECRET = process.env.AUTH_SECRET || DEV_SECRET;
if (SECRET === DEV_SECRET) {
  console.warn('[auth] AUTH_SECRET not set — using an insecure dev secret. Set AUTH_SECRET in production.');
}

export interface SessionUser { id: string; username: string; name: string; role: Role; }

/** Settings key holding a fingerprint of the ADMIN_PASSWORD already applied. */
const ADMIN_PW_KEY = 'admin_password_applied';

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function signToken(u: SessionUser): string {
  return jwt.sign(u, SECRET, { expiresIn: '12h' });
}
export function verifyToken(token: string): SessionUser | null {
  try {
    const d = jwt.verify(token, SECRET) as SessionUser & { iat: number; exp: number };
    return { id: d.id, username: d.username, name: d.name, role: d.role };
  } catch {
    return null;
  }
}

/**
 * Read the session user from either the Authorization: Bearer header (preferred —
 * cookie-independent, works even when the browser blocks cookies) or the cookie.
 */
export function currentUser(req: express.Request): SessionUser | null {
  const auth = req.headers['authorization'];
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const cookie = (req as express.Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
  const token = bearer || cookie;
  return token ? verifyToken(token) : null;
}

/** When AUTH_DISABLED=true, everyone is treated as this admin (demo mode). */
export const AUTH_DISABLED = () => process.env.AUTH_DISABLED === 'true';
export const DEMO_USER: SessionUser = { id: '0', username: 'demo', name: 'Demo', role: 'admin' };

/** Middleware: require any authenticated staff user. */
export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (AUTH_DISABLED()) { (req as express.Request & { user?: SessionUser }).user = DEMO_USER; return next(); }
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: { message: 'Authentication required' } });
  (req as express.Request & { user?: SessionUser }).user = u;
  next();
}

/**
 * Middleware: require a desk user. Only admin and staff pass — the floor roles
 * ('warehouse', 'leja') reach the endpoints that stay on plain requireAuth: the
 * job queue, single records, photos, comments, and push registration. This is an
 * allow-list on purpose, so a role added later is shut out until someone decides
 * otherwise rather than being let in by default.
 */
export function requireStaff(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (AUTH_DISABLED()) { (req as express.Request & { user?: SessionUser }).user = DEMO_USER; return next(); }
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: { message: 'Authentication required' } });
  if (u.role !== 'admin' && u.role !== 'staff') return res.status(403).json({ error: { message: 'Šī sadaļa nav pieejama šim lietotājam' } });
  (req as express.Request & { user?: SessionUser }).user = u;
  next();
}

/** Middleware: require an admin (e.g. for imports / user management). */
export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (AUTH_DISABLED()) { (req as express.Request & { user?: SessionUser }).user = DEMO_USER; return next(); }
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: { message: 'Authentication required' } });
  if (u.role !== 'admin') return res.status(403).json({ error: { message: 'Admin role required' } });
  (req as express.Request & { user?: SessionUser }).user = u;
  next();
}

export const toSession = (u: User): SessionUser => ({ id: u.id, username: u.username, name: u.name, role: u.role });

/**
 * Ensure an initial admin exists. Seeds from ADMIN_USERNAME / ADMIN_PASSWORD when
 * the users table is empty, so a fresh deploy has exactly one known admin.
 */
export async function seedAdmin(store: Store): Promise<void> {
  await store.ensureAuth();
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  // Fingerprint of the ADMIN_PASSWORD this database has already had applied.
  const fingerprint = password ? createHash('sha256').update(`${username}:${password}`).digest('hex') : null;
  const remember = async () => {
    if (fingerprint) { try { await store.setSetting(ADMIN_PW_KEY, fingerprint); } catch { /* best effort */ } }
  };
  if ((await store.countUsers()) === 0) {
    if (!password) {
      console.warn('[auth] No users and ADMIN_PASSWORD not set — no admin was created. Set ADMIN_USERNAME/ADMIN_PASSWORD.');
      return;
    }
    await store.createUser({ username, name: 'Administrator', passwordHash: await hashPassword(password), role: 'admin' });
    // Record it here too, or the next cold start reads "nothing applied yet" and
    // overwrites whatever password the admin has chosen since.
    await remember();
    console.log(`[auth] Seeded initial admin user "${username}".`);
    return;
  }
  // Admin already exists. ADMIN_PASSWORD still acts as a reset lever — change the
  // env var, redeploy, and the admin password follows — but it must only fire when
  // the env value actually CHANGES. Re-applying it unconditionally used to run on
  // every cold start, silently reverting any password set through "Mainīt paroli"
  // minutes after the user chose it.
  if (!password) return;
  let applied: unknown = null;
  try { applied = await store.getSetting(ADMIN_PW_KEY); } catch { /* store without settings — fall through */ }
  if (applied === fingerprint) return;
  // A database that predates this bookkeeping has no fingerprint. Record the
  // current env value WITHOUT forcing it, so an admin password that has since been
  // changed by hand survives; changing ADMIN_PASSWORD from here on still resets it.
  if (applied === null || applied === undefined) {
    await remember();
    console.log('[auth] Recorded the current ADMIN_PASSWORD; it applies only if the value changes.');
    return;
  }
  const ok = await store.setPasswordByUsername(username, await hashPassword(password));
  if (!ok) return;
  await remember();
  console.log(`[auth] ADMIN_PASSWORD changed — reset the password for admin user "${username}".`);
}
