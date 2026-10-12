import type { PermKey } from '@/domain/perms';

export type ScreenKey = 'home' | 'warehouse' | 'intake' | 'release' | 'pending' | 'spots' | 'customers' | 'table' | 'analytics' | 'history' | 'users' | 'settings' | 'help';

export interface Screen { key: ScreenKey; href: string; label: string; icon: string; perm?: PermKey; admin?: boolean; main?: boolean }

/** Sidebar order. A screen whose permission the user lacks is neither shown nor reachable. */
export const SCREENS: Screen[] = [
  { key: 'home', href: '/sakums', label: 'Sākums', icon: '◧', perm: 'screen.home' },
  { key: 'warehouse', href: '/noliktava', label: 'Noliktava', icon: '▦', perm: 'screen.warehouse' },
  { key: 'intake', href: '/jauna-glabasana', label: 'Jauna glabāšana', icon: '↓', perm: 'screen.intake', main: true },
  { key: 'release', href: '/izsniegt', label: 'Izsniegt glabāšanu', icon: '↑', perm: 'screen.release', main: true },
  { key: 'pending', href: '/sagatavotie', label: 'Sagatavotie', icon: '◔', perm: 'screen.pending' },
  { key: 'spots', href: '/novietnes', label: 'Novietnes', icon: '⊞', perm: 'screen.spots' },
  { key: 'customers', href: '/klienti', label: 'Klienti', icon: '◉', perm: 'screen.customers' },
  { key: 'table', href: '/tabula', label: 'Tabula', icon: '▤', perm: 'screen.table' },
  { key: 'analytics', href: '/analitika', label: 'Analītika', icon: '◫', perm: 'screen.analytics' },
  { key: 'history', href: '/vesture', label: 'Vēsture', icon: '≡', perm: 'screen.history' },
  { key: 'users', href: '/lietotaji', label: 'Lietotāji', icon: '◔', admin: true },
  { key: 'settings', href: '/iestatijumi', label: 'Iestatījumi', icon: '⚙', admin: true },
  { key: 'help', href: '/instrukcija', label: 'Instrukcija', icon: '?' },
];

export const screenByKey = (k: string) => SCREENS.find((s) => s.key === k);
export const screenByPath = (p: string) => SCREENS.find((s) => p === s.href || p.startsWith(`${s.href}/`));

export function canOpen(s: Screen, perms: Record<string, boolean>, isAdmin: boolean): boolean {
  if (s.admin) return isAdmin;
  return !s.perm || isAdmin || !!perms[s.perm];
}

/** Where a user lands when nothing better is known. */
export function firstScreen(perms: Record<string, boolean>, isAdmin: boolean): Screen {
  for (const k of ['home', 'warehouse', 'table', 'history', 'spots', 'customers'] as ScreenKey[]) {
    const s = screenByKey(k)!;
    if (canOpen(s, perms, isAdmin)) return s;
  }
  return screenByKey('help')!;
}

export const LAST_VIEW_KEY = 'r1_last_view';
