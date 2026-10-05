import type { Branch } from '@/domain/types';
import * as misc from './repo/misc';
import * as usersRepo from './repo/users';

// A request names the shop it works in with the X-Branch header. The value is
// always checked against the branches the user may open, so the header can never
// widen access. Both lookups are cached briefly: list endpoints would otherwise
// pay two extra reads per request.
const TTL = 30_000;
let branchList: { at: number; rows: Branch[] } | null = null;
const allowedCache = new Map<string, { at: number; ids: string[] | null }>();

/** Forget cached branches (all of them, or one user's access) after an admin change. */
export function bustBranches(username?: string): void {
  branchList = null;
  if (username) allowedCache.delete(username.toLowerCase());
  else allowedCache.clear();
}

async function activeBranches(): Promise<Branch[]> {
  if (branchList && Date.now() - branchList.at < TTL) return branchList.rows;
  let rows: Branch[] = [];
  try { rows = (await misc.listBranches()).filter((b) => b.active); } catch { rows = []; }
  branchList = { at: Date.now(), rows };
  return rows;
}

async function allowedIds(username: string): Promise<string[] | null> {
  const key = username.toLowerCase();
  const hit = allowedCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.ids;
  let ids: string[] | null = null;
  try { ids = await usersRepo.getUserBranches(key); } catch { ids = null; }
  allowedCache.set(key, { at: Date.now(), ids });
  return ids;
}

/** The branches this user may open. No restriction stored = all of them. */
export async function branchesFor(username: string): Promise<Branch[]> {
  const all = await activeBranches();
  const allowed = await allowedIds(username);
  if (!allowed) return all;
  const set = new Set(allowed);
  return all.filter((b) => set.has(b.id));
}

/** The branch a request works in: the asked-for one if allowed, else the first allowed. '' only when none exist. */
export function pickBranch(mine: Branch[], asked: string | null): string {
  const a = (asked ?? '').trim();
  return mine.some((b) => b.id === a) ? a : (mine[0]?.id ?? '');
}
