import { actorName, evWhen } from '@/domain/format';

/** Label and colours per history action, shared by Sākums, Vēsture and the record card. */
export const ACT_FEED: Record<string, [string, string, string]> = {
  in: ['Pieņemšana', 'var(--ok-soft)', 'var(--ok)'],
  created: ['Pieņemšana', 'var(--ok-soft)', 'var(--ok)'],
  out: ['Izsniegšana', 'var(--accent-soft)', 'var(--accent-2)'],
  released: ['Izsniegšana', 'var(--accent-soft)', 'var(--accent-2)'],
  prepared: ['Sagatavots', 'var(--warn-soft)', 'var(--warn)'],
  unprepared: ['Atpakaļ vietā', 'var(--surface-2)', 'var(--ink-2)'],
  swapped: ['Maiņa', 'var(--accent-soft)', 'var(--accent-2)'],
  blocked: ['Bloķēts', 'var(--danger-soft)', 'var(--danger)'],
  unblocked: ['Atbloķēts', 'var(--ok-soft)', 'var(--ok)'],
  edited: ['Rediģēts', 'var(--surface-2)', 'var(--ink-2)'],
  comment: ['Komentārs', 'var(--violet-soft)', 'var(--violet)'],
  photo: ['Bilde', 'var(--teal-soft)', 'var(--teal)'],
};

export function ActBadge({ type }: { type: string }) {
  const [label, bg, fg] = ACT_FEED[type] ?? ['Darbība', 'var(--surface-2)', 'var(--ink-2)'];
  return <span className="badge" style={{ background: bg, color: fg }}>{label}</span>;
}

export interface FeedItem { type: string; plate: string | null; loc: string | null; d: string; comment?: string | null; actor?: string | null }

/** One line of the dashboard's recent-activity card. */
export function ActivityRow({ a }: { a: FeedItem }) {
  const w = evWhen(a.d);
  const isLoc = ['in', 'out', 'created', 'released', 'swapped'].includes(a.type);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 104px 1fr auto', gap: 10, alignItems: 'center', padding: '12px var(--card)', borderBottom: '1px solid var(--border)' }}>
      <span className="mono muted" style={{ fontSize: 11, lineHeight: 1.4 }}>{w.d}{w.t && <><br /><span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{w.t}</span></>}</span>
      <ActBadge type={a.type} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span className="mono" style={{ fontWeight: 600, fontSize: 13, flex: 'none' }}>{a.plate || '—'}</span>
        {a.comment ? <span className="muted-2 ellipsis" style={{ fontSize: 12 }}>“{a.comment}”</span>
          : isLoc && a.loc ? <span className="muted" style={{ fontSize: 12 }}>→ {a.loc}</span> : null}
      </span>
      <span className="mono muted nowrap" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.02em' }}>{actorName(a.actor)}</span>
    </div>
  );
}
