'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/client/api';
import { useSession } from '@/client/session';
import { useOpenTasks, useStats } from '@/client/queries';
import { DAYS, eur, MONTHS } from '@/domain/format';
import type { ContainerView } from '@/domain/spots';
import { ActivityRow, type FeedItem } from '../ui/Activity';

function ContainerBar({ c }: { c: ContainerView }) {
  const pct = c.total ? Math.round((c.occ / c.total) * 100) : 0;
  const color = pct >= 90 ? 'var(--danger)' : pct >= 75 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
        <span style={{ fontWeight: 600 }}>Konteiners {c.letter}</span><span className="mono muted">{c.occ}/{c.total}</span>
      </div>
      <div className="bar" style={{ height: 7 }}><div style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

function Stat({ label, value, color, href }: { label: string; value: React.ReactNode; color?: string; href?: string }) {
  const body = <><div className="label">{label}</div><div className="value" style={{ color }}>{value}</div></>;
  return href
    ? <Link href={href} className="card pad stat" style={{ color: 'inherit' }}>{body}</Link>
    : <div className="card pad stat">{body}</div>;
}

export function HomeScreen() {
  const { can, isAdmin } = useSession();
  const stats = useStats();
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api<{ events: FeedItem[] }>('/api/activity') });
  const tasks = useOpenTasks();
  const st = stats.data;
  const now = new Date();
  const month = now.getMonth() + 1;
  const dateStr = `${DAYS[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const season = `${month >= 3 && month < 9 ? 'Pavasaris' : 'Rudens'} ${now.getFullYear()}`;
  const quick: Array<[string, string, boolean, boolean]> = [
    ['/jauna-glabasana', '↓  Jauna glabāšana', can('screen.intake'), true],
    ['/izsniegt', '↑  Izsniegt glabāšanu (kods/numurs)', can('screen.release'), true],
    ['/izsniegt', '◔  Sagatavot riepas (maiņai)', can('screen.release'), false],
    ['/noliktava', '▦  Pasūtīt no noliktavas', can('screen.warehouse'), false],
    ['/klienti', '◉  Klienti', can('screen.customers'), false],
  ];
  return (
    <div className="page w-1240">
      <div className="page-head">
        <div><h1 style={{ fontSize: 26 }}>Pārskats</h1><div className="sub">{dateStr} · {season}</div></div>
        <div className="row">
          {can('screen.release') && <Link href="/izsniegt" className="btn lg">◔ Sagatavot riepas</Link>}
          {can('screen.intake') && <Link href="/jauna-glabasana" className="btn lg primary">＋ Jauna glabāšana</Link>}
        </div>
      </div>
      <div className="stats">
        <Stat label="Aizņemtas vietas" value={<>{st?.occ ?? '—'}<span style={{ fontSize: 16, color: 'var(--ink-3)' }}>/{st?.total ?? '—'}</span></>} />
        <Stat label="Brīvas vietas" value={st?.free ?? '—'} color="var(--ok)" />
        {!!st?.reserved && can('screen.pending') && <Stat label="Sagatavotas (rezervētas)" value={st.reserved} color="var(--warn)" href="/sagatavotie" />}
        {!!tasks.data?.open && can('screen.warehouse') && <Stat label="Noliktavā darāmie" value={tasks.data.open} color="var(--danger)" href="/noliktava" />}
        <Stat label="Šodien pieņemtas" value={st?.todayIntakes ?? '—'} />
        <Stat label="SMS kodi izsniegti" value={st?.smsIssued ?? '—'} />
        {isAdmin && st?.revenueActive != null && <Stat label="Ieņēmumi (aktīvie)" value={eur(st.revenueActive)} />}
      </div>
      <div className="grid-2">
        <div className="card clip">
          <div className="card-head" style={{ padding: '16px var(--card)' }}>
            <h2>Nesenās darbības</h2>
            {can('screen.history') && <Link href="/vesture" className="btn link">Skatīt visu →</Link>}
          </div>
          <div>{activity.data?.events.length ? activity.data.events.map((a, i) => <ActivityRow key={i} a={a} />) : <div className="empty left">{activity.isLoading ? 'Ielādē…' : 'Nav darbību'}</div>}</div>
        </div>
        <div className="stack">
          <div className="card pad">
            <h2 style={{ marginBottom: 14 }}>Ātrās darbības</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {quick.filter(([, , ok]) => ok).map(([href, label, , main]) => (
                <Link key={label} href={href} className={`btn${main ? ' soft' : ''}`} style={{ height: 42, justifyContent: 'flex-start', fontWeight: main ? 600 : 500 }}>{label}</Link>
              ))}
              {!quick.some(([, , ok]) => ok) && <div className="muted" style={{ fontSize: 13 }}>Nav pieejamu darbību.</div>}
            </div>
          </div>
          <div className="card pad">
            <h2 style={{ marginBottom: 14 }}>Konteineru noslodze</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{st?.containers.map((c) => <ContainerBar key={c.letter} c={c} />)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
