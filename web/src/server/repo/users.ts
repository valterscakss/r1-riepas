import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { normRole, type Role, type User, type UserSummary } from '@/domain/types';

const lc = (s: string) => s.toLowerCase();

export async function getUser(username: string): Promise<(User & { perms: string | null }) | null> {
  const [r] = await getDb().select().from(users).where(eq(users.username, lc(username)));
  return r ? { id: String(r.id), username: r.username, name: r.name, passwordHash: r.passwordHash, role: normRole(r.role), perms: r.perms ?? null } : null;
}

export async function listUsers(): Promise<UserSummary[]> {
  const rows = await getDb().select({ id: users.id, username: users.username, name: users.name, role: users.role, perms: users.perms, createdAt: users.createdAt })
    .from(users).orderBy(asc(users.createdAt), asc(users.id));
  return rows.map((r) => ({ id: String(r.id), username: r.username, name: r.name, role: normRole(r.role), perms: r.perms ?? null, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null }));
}

export async function countUsers(): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users);
  return r.n;
}

export async function countAdmins(): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, 'admin'));
  return r.n;
}

export async function createUser(u: { username: string; name: string; passwordHash: string; role: Role }): Promise<void> {
  await getDb().insert(users).values({ ...u, username: lc(u.username) });
}

export async function updateUser(username: string, patch: { username?: string; name?: string; role?: Role }): Promise<boolean> {
  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.username !== undefined) set.username = lc(patch.username);
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.role !== undefined) set.role = patch.role;
  if (!Object.keys(set).length) return false;
  return (await getDb().update(users).set(set).where(eq(users.username, lc(username))).returning({ id: users.id })).length > 0;
}

export async function setPassword(username: string, passwordHash: string): Promise<boolean> {
  return (await getDb().update(users).set({ passwordHash }).where(eq(users.username, lc(username))).returning({ id: users.id })).length > 0;
}

export async function setUserPerms(username: string, perms: string | null): Promise<boolean> {
  return (await getDb().update(users).set({ perms }).where(eq(users.username, lc(username))).returning({ id: users.id })).length > 0;
}

export async function deleteUser(username: string): Promise<boolean> {
  return (await getDb().delete(users).where(eq(users.username, lc(username))).returning({ id: users.id })).length > 0;
}
