import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type express from 'express';
import type { Store, User } from './types.js';

export const COOKIE = 'r1_session';
const DEV_SECRET = 'dev-only-insecure-secret-change-me';
const SECRET = process.env.AUTH_SECRET || DEV_SECRET;
if (SECRET === DEV_SECRET) {
  console.warn('[auth] AUTH_SECRET not set — using an insecure dev secret. Set AUTH_SECRET in production.');
}

export interface SessionUser { id: string; username: string; name: string; role: 'admin' | 'staff'; }

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

/** Read the session user off the request cookie, if any. */
export function currentUser(req: express.Request): SessionUser | null {
  const token = (req as express.Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
  return token ? verifyToken(token) : null;
}

/** Middleware: require any authenticated staff user. */
export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: { message: 'Authentication required' } });
  (req as express.Request & { user?: SessionUser }).user = u;
  next();
}

/** Middleware: require an admin (e.g. for imports / user management). */
export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
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
  if ((await store.countUsers()) > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('[auth] No users and ADMIN_PASSWORD not set — no admin was created. Set ADMIN_USERNAME/ADMIN_PASSWORD.');
    return;
  }
  await store.createUser({ username, name: 'Administrator', passwordHash: await hashPassword(password), role: 'admin' });
  console.log(`[auth] Seeded initial admin user "${username}".`);
}
