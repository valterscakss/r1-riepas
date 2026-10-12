'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { canOpen, LAST_VIEW_KEY, screenByKey } from '@/client/nav';

/** Reopen the screen this device was last on (the warehouse phone lives on one). */
export function LastView({ perms, isAdmin, fallback }: { perms: Record<string, boolean>; isAdmin: boolean; fallback: string }) {
  const router = useRouter();
  useEffect(() => {
    let target = fallback;
    try {
      const s = screenByKey(localStorage.getItem(LAST_VIEW_KEY) ?? '');
      if (s && !s.admin && canOpen(s, perms, isAdmin)) target = s.href;
    } catch { /* storage blocked — use the default */ }
    router.replace(target);
  }, [router, perms, isAdmin, fallback]);
  return null;
}
