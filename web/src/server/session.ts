import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { PermKey, Perms } from '@/domain/perms';
import { canOpen, firstScreen, screenByKey, type ScreenKey } from '@/client/nav';
import { ensureAdminOnce, SESSION_COOKIE, type SessionUser } from './auth';
import { sessionFromToken } from './http';

/** The signed-in user for a page render, or null. */
export async function pageSession(): Promise<{ user: SessionUser; perms: Perms } | null> {
  await ensureAdminOnce();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionFromToken(token);
}

/**
 * Gate a screen: signed out → login; not allowed → the first screen this user
 * may open. The API enforces the same rules; this only keeps the UI honest.
 */
export async function requireScreen(key: ScreenKey): Promise<{ user: SessionUser; perms: Perms }> {
  const s = await pageSession();
  if (!s) redirect('/login');
  const screen = screenByKey(key)!;
  if (!canOpen(screen, s.perms, s.user.role === 'admin')) redirect(firstScreen(s.perms, s.user.role === 'admin').href);
  return s;
}

export const hasPerm = (s: { user: SessionUser; perms: Perms }, k: PermKey) => s.user.role === 'admin' || s.perms[k];
