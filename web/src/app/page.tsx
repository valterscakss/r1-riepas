import { redirect } from 'next/navigation';
import { pageSession } from '@/server/session';
import { canOpen, firstScreen, screenByKey } from '@/client/nav';
import { LastView } from '@/components/LastView';

/**
 * The entry point. `?view=warehouse` (notification clicks, home-screen
 * shortcuts, links from the old app) jumps straight to that screen; otherwise
 * the browser reopens the screen it was last on.
 */
export default async function Root({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const s = await pageSession();
  if (!s) redirect('/login');
  const isAdmin = s.user.role === 'admin';
  const { view } = await searchParams;
  const wanted = view ? screenByKey(view) : undefined;
  if (wanted && canOpen(wanted, s.perms, isAdmin)) redirect(wanted.href);
  return <LastView perms={s.perms} isAdmin={isAdmin} fallback={firstScreen(s.perms, isAdmin).href} />;
}
