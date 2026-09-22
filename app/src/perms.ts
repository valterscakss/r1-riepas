import type express from 'express';
import type { Store, StorageRecord, Role } from './types.js';
import { AUTH_DISABLED, currentUser, type SessionUser } from './auth.js';

/**
 * Per-user permissions. Every screen, action and sensitive data field is a key
 * an admin can tick on or off per user; the role only supplies the DEFAULTS.
 *
 * Enforcement is server-side: endpoints are gated by requirePerm(), and record
 * payloads pass through redactRecord() so a user without `field.phone` never
 * receives a phone number at all — hiding it in the UI would not be protection.
 */
export const PERM_KEYS = [
  // Screens (sidebar sections)
  'screen.home', 'screen.warehouse', 'screen.intake', 'screen.release', 'screen.pending',
  'screen.spots', 'screen.customers', 'screen.table', 'screen.analytics', 'screen.history',
  // Actions
  'act.operate',  // intake / release / prepare / block — the physical workflows
  'act.edit',     // edit record data fields
  'act.media',    // add photos and comments to records
  'act.export',   // download Excel files
  // Sensitive data fields (redacted from every payload when off)
  'field.phone', 'field.customer', 'field.price', 'field.sms',
] as const;
export type PermKey = typeof PERM_KEYS[number];
export type Perms = Record<PermKey, boolean>;

const ALL_ON = Object.fromEntries(PERM_KEYS.map((k) => [k, true])) as Perms;
const ALL_OFF = Object.fromEntries(PERM_KEYS.map((k) => [k, false])) as Perms;

export const ROLE_DEFAULTS: Record<Role, Perms> = {
  admin: { ...ALL_ON },
  staff: { ...ALL_ON },
  warehouse: {
    ...ALL_OFF,
    'screen.warehouse': true,
    'screen.table': true,   // find any tire set in the full list…
    'act.media': true,      // …and add photos/comments to it
    // phone / customer / price / SMS stay hidden unless the admin ticks them
  },
  // The downstairs floor: same starting point as the warehouse, plus the spot
  // map, since that is what you work from when fetching and shelving sets.
  leja: {
    ...ALL_OFF,
    'screen.warehouse': true,
    'screen.table': true,
    'screen.spots': true,
    'act.media': true,
  },
};

/**
 * Effective permissions = role defaults + per-user overrides. Admins are always
 * ALL_ON regardless of overrides, so an admin cannot lock themselves out.
 * Cached briefly so list endpoints don't pay a user-table read per request;
 * bustPerms() clears the entry the moment an admin saves a change.
 */
const cache = new Map<string, { perms: Perms; at: number }>();
const TTL = 30_000;

export function bustPerms(username: string): void {
  cache.delete(username.toLowerCase());
}

export async function effectivePerms(store: Store, user: SessionUser): Promise<Perms> {
  if (user.role === 'admin') return ALL_ON;
  const key = user.username.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.perms;
  // The role comes from the user's own row rather than from the token they are
  // holding, so renaming a user or changing their role takes effect on their
  // open session instead of waiting up to 12 hours for the token to expire.
  // A token naming a user that no longer exists — because they were renamed or
  // removed — grants nothing, which sends them back to the login screen.
  let row: { role: Role } | null = null;
  try { row = await store.getUserByUsername(key); } catch { row = { role: user.role }; }
  if (!row) { const none = { ...ALL_OFF }; cache.set(key, { perms: none, at: Date.now() }); return none; }
  if (row.role === 'admin') { cache.set(key, { perms: { ...ALL_ON }, at: Date.now() }); return ALL_ON; }
  const base = { ...(ROLE_DEFAULTS[row.role] ?? ROLE_DEFAULTS.staff) };
  try {
    const raw = await store.getUserPerms(key);
    if (raw) {
      const over = JSON.parse(raw) as Record<string, unknown>;
      for (const k of PERM_KEYS) if (typeof over[k] === 'boolean') base[k] = over[k] as boolean;
    }
  } catch { /* fall back to role defaults */ }
  cache.set(key, { perms: base, at: Date.now() });
  return base;
}

export type PermRequest = express.Request & { user?: SessionUser; perms?: Perms };

/** Endpoint gate: authenticated AND holding the given permission. */
export function requirePerm(getStore: () => Promise<Store>, key: PermKey) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (async () => {
      if (AUTH_DISABLED()) { (req as PermRequest).perms = ALL_ON; return next(); }
      const u = currentUser(req);
      if (!u) return res.status(401).json({ error: { message: 'Authentication required' } });
      const perms = await effectivePerms(await getStore(), u);
      if (!perms[key]) return res.status(403).json({ error: { message: 'Nav tiesību šai sadaļai' } });
      (req as PermRequest).user = u;
      (req as PermRequest).perms = perms;
      next();
    })().catch(next);
  };
}

/** Like requirePerm but passes when ANY of the keys is held (shared endpoints). */
export function requireAnyPerm(getStore: () => Promise<Store>, keys: PermKey[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (async () => {
      if (AUTH_DISABLED()) { (req as PermRequest).perms = ALL_ON; return next(); }
      const u = currentUser(req);
      if (!u) return res.status(401).json({ error: { message: 'Authentication required' } });
      const perms = await effectivePerms(await getStore(), u);
      if (!keys.some((k) => perms[k])) return res.status(403).json({ error: { message: 'Nav tiesību šai sadaļai' } });
      (req as PermRequest).user = u;
      (req as PermRequest).perms = perms;
      next();
    })().catch(next);
  };
}

/** Attach perms without gating (endpoints open to every role, e.g. GET a record). */
export function attachPerms(getStore: () => Promise<Store>) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (async () => {
      if (AUTH_DISABLED()) { (req as PermRequest).perms = ALL_ON; return next(); }
      const u = currentUser(req);
      if (u) (req as PermRequest).perms = await effectivePerms(await getStore(), u);
      next();
    })().catch(next);
  };
}

export function permsOf(req: express.Request): Perms {
  return (req as PermRequest).perms ?? ALL_ON;
}

/** Strip the fields this user may not see. Never mutates the original. */
export function redactRecord<T extends Partial<StorageRecord>>(rec: T, perms: Perms): T {
  if (perms['field.phone'] && perms['field.customer'] && perms['field.price'] && perms['field.sms']) return rec;
  const out = { ...rec };
  if (!perms['field.phone'] && 'phone' in out) out.phone = null;
  if (!perms['field.customer'] && 'customerName' in out) out.customerName = null;
  if (!perms['field.price'] && 'feeEur' in out) out.feeEur = null;
  if (!perms['field.sms'] && 'smsCode' in out) out.smsCode = null;
  return out;
}

export function redactAll<T extends Partial<StorageRecord>>(recs: T[], perms: Perms): T[] {
  if (perms['field.phone'] && perms['field.customer'] && perms['field.price'] && perms['field.sms']) return recs;
  return recs.map((r) => redactRecord(r, perms));
}
