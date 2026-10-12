'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { Perms } from '@/domain/perms';
import type { SessionUser } from '@/server/auth';
import { SessionProvider } from './session';
import { ToastProvider } from './toast';
import { DialogProvider } from './dialogs';

export function Providers({ user, perms, children }: { user: SessionUser; perms: Perms; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: (n, e) => n < 1 && (e as { status?: number }).status !== 401 },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      <SessionProvider user={user} perms={perms}>
        <ToastProvider>
          <DialogProvider>{children}</DialogProvider>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
