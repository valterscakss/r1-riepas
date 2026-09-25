'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canOpen, LAST_VIEW_KEY, SCREENS, screenByKey, screenByPath } from '@/client/nav';
import { useSession } from '@/client/session';
import { useOpenTasks, usePending, useStats } from '@/client/queries';
import { useDialogs } from '@/client/dialogs';
import { initialsOf } from '@/domain/format';
import { ROLE_LABEL } from '@/domain/perms';
import { TASK_KIND_LABEL } from '@/domain/tasks';
import { ChangePasswordDialog } from './users/ChangePasswordDialog';
import { post } from '@/client/api';
import { subscribePush, pushState } from '@/client/push';
import { RecordProvider } from './records/RecordProvider';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, perms, isAdmin, can } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const dialogs = useDialogs();
  const [navOpen, setNavOpen] = useState(false);
  const showCapacity = can('screen.home') || can('screen.spots');
  const stats = useStats(showCapacity || can('screen.intake'));
  const tasks = useOpenTasks();
  const pending = usePending(can('screen.pending'));
  const current = screenByPath(pathname);

  // Remember the screen (never an admin one) so the next visit reopens it.
  useEffect(() => {
    if (current && !current.admin) { try { localStorage.setItem(LAST_VIEW_KEY, current.key); } catch { /* storage blocked */ } }
  }, [current]);

  useNewTaskAlerts(tasks.data?.tasks);
  useServiceWorker((view) => { const s = screenByKey(view); if (s) router.push(s.href); });

  const logout = async () => {
    const r = await dialogs.confirm({ title: 'Iziet?', body: 'Tiksi izrakstīts no sistēmas.', confirmText: 'Iziet', cancelText: 'Palikt' });
    if (!r.ok) return;
    await post('/api/logout').catch(() => undefined);
    // A full load on purpose: it drops every cached query of the old session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login');
  };

  const cap = stats.data;
  const capColor = !cap ? 'var(--accent)' : cap.capPct >= 90 ? 'var(--danger)' : cap.capPct >= 75 ? 'var(--warn)' : 'var(--accent)';
  const badge = (key: string) => {
    if (key === 'warehouse' && tasks.data?.open) return <span className="count" style={{ background: 'var(--danger)' }}>{tasks.data.open}</span>;
    if (key === 'pending' && pending.data?.count) return <span className="count" style={{ background: 'var(--warn)' }}>{pending.data.count}</span>;
    return null;
  };

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <aside className="side">
        <div className="brand">
          <div className="logo">R1</div>
          <div><div style={{ fontWeight: 600, fontSize: 15 }}>R1 Tires</div><div className="muted" style={{ fontSize: 11 }}>Riepu noliktava</div></div>
        </div>
        <nav className="nav" aria-label="Sadaļas">
          {SCREENS.filter((s) => canOpen(s, perms, isAdmin)).map((s, i, list) => (
            <div key={s.key} style={{ display: 'contents' }}>
              {s.key === 'intake' && list[i - 1] && <div className="nav-sep" />}
              <Link href={s.href} onClick={() => setNavOpen(false)} className={`navbtn${s.main ? ' main' : ''}${current?.key === s.key ? ' on' : ''}`} aria-current={current?.key === s.key ? 'page' : undefined}>
                <span>{s.icon}&nbsp; {s.label}</span>{badge(s.key)}
              </Link>
            </div>
          ))}
        </nav>
        {showCapacity && (
          <div className="capacity">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span className="label">Noslodze</span><span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{cap ? `${cap.capPct}%` : '—%'}</span>
            </div>
            <div className="bar"><div style={{ width: `${cap?.capPct ?? 0}%`, background: capColor }} /></div>
            <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 6 }}>
              <span>{cap ? `${cap.occ} aizņemtas` : '—'}</span><span>{cap ? `${cap.free} brīvas` : '—'}</span>
            </div>
          </div>
        )}
      </aside>
      <div className="content">
        <header className="topbar">
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <button className="hamburger" aria-label="Izvēlne" onClick={() => setNavOpen((v) => !v)}>☰</button>
            <div className="greet muted" style={{ fontSize: 13, fontWeight: 500 }}>Sveiks, {user.name.split(' ')[0]}!</div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
            <button className="btn sm" onClick={() => dialogs.open((done) => <ChangePasswordDialog done={done} />)}>Mainīt paroli</button>
            <button className="btn sm" onClick={logout}>Iziet</button>
            <div className="who" style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>{ROLE_LABEL[user.role]}</div>
            </div>
            <div className="avatar">{initialsOf(user.name)}</div>
          </div>
        </header>
        <main style={{ flex: 1 }}><RecordProvider>{children}</RecordProvider></main>
      </div>
      <div className="backdrop" onClick={() => setNavOpen(false)} />
    </div>
  );
}

/**
 * With real push off (or not granted on this device), raise a local
 * notification for new jobs while the app is in the background.
 */
function useNewTaskAlerts(list: Array<{ id: string; kind: 'prepare' | 'store' | 'order'; title: string; details: string | null; location: string | null }> | undefined) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!list) return;
    const ids = new Set(list.map((t) => t.id));
    const prev = seen.current;
    seen.current = ids;
    if (!prev || pushState.on || typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    list.filter((t) => !prev.has(t.id)).slice(0, 3).forEach((t) => {
      try {
        new Notification(`R1 · ${t.kind === 'order' ? 'Jauns pasūtījums' : TASK_KIND_LABEL[t.kind]}`, {
          body: [t.location ? `Vieta ${t.location}` : '', t.title, t.details].filter(Boolean).join(' · ').slice(0, 160),
          icon: '/icon-192.png', tag: `r1-task-${t.id}`,
        });
      } catch { /* some browsers only allow notifications from the service worker */ }
    });
  }, [list]);
}

/** Installable PWA + Web Push; a notification click focuses this window on the right screen. */
function useServiceWorker(openView: (view: string) => void) {
  const cb = useRef(openView);
  useEffect(() => { cb.current = openView; }, [openView]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw register failed', e));
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== 'r1-open' || !d.url) return;
      try {
        const u = new URL(d.url, location.origin);
        const view = u.searchParams.get('view') ?? screenByPath(u.pathname)?.key;
        if (view) cb.current(view);
      } catch { /* malformed url */ }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    void subscribePush(); // silently re-attaches a device that already granted permission
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);
}
