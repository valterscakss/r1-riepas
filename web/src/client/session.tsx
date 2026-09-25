'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PermKey, Perms } from '@/domain/perms';
import type { SessionUser } from '@/server/auth';

interface SessionCtx {
  user: SessionUser;
  perms: Perms;
  isAdmin: boolean;
  /** Admins can do everything; others follow their effective permissions. */
  can: (k: PermKey) => boolean;
  /** After renaming yourself the header should follow without a reload. */
  setUser: (u: SessionUser) => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ user: initial, perms, children }: { user: SessionUser; perms: Perms; children: ReactNode }) {
  const [user, setUser] = useState(initial);
  const value = useMemo<SessionCtx>(() => {
    const isAdmin = user.role === 'admin';
    return { user, perms, isAdmin, can: (k) => isAdmin || !!perms[k], setUser };
  }, [user, perms]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
