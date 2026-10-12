import { redirect } from 'next/navigation';
import { pageSession } from '@/server/session';
import { Providers } from '@/client/providers';
import { AppShell } from '@/components/AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await pageSession();
  if (!s) redirect('/login');
  return (
    <Providers user={s.user} perms={s.perms}>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
