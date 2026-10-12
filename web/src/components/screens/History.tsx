'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useDebounced } from '@/client/useDebounced';
import { api } from '@/client/api';
import { actorName, evWhen, MONTHS } from '@/domain/format';
import type { HistoryEntry } from '@/domain/history';
import { ActBadge } from '../ui/Activity';
import { ExportButton } from '../ui/ExportButton';
import { useOpenRecord } from '../records/RecordProvider';

const TYPES: Array<[string, string]> = [['', 'Visas darbības'], ['in,created', 'Pieņemšana'], ['out,released,swapped', 'Izsniegšana'], ['prepared,unprepared', 'Sagatavošana'], ['comment', 'Komentāri'], ['photo', 'Bildes'], ['edited,blocked,unblocked', 'Citas']];
type Page = { total: number; page: number; pages: number; events: HistoryEntry[] };

/**
 * Everything that ever happened, filterable by dates, action and text, grouped
 * by day and paged as far back as the data goes. Every row opens its record.
 */
export function HistoryScreen() {
  const openRecord = useOpenRecord();
  const [f, setF] = useState({ from: '', to: '', types: '', q: '' });
  const q = useDebounced(f.q);
  const filters = { from: f.from, to: f.to, types: f.types, q: q.trim() };
  const params = (page: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: String(page) });
  const h = useInfiniteQuery({
    queryKey: ['history', filters],
    queryFn: ({ pageParam }) => api<Page>(`/api/history?${params(pageParam)}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const list = h.data?.pages.flatMap((p) => p.events) ?? [];
  const total = h.data?.pages[0]?.total ?? 0;
  const groups: Array<{ day: string; rows: HistoryEntry[] }> = [];
  for (const e of list) {
    const d = evWhen(e.d).d;
    if (groups.at(-1)?.day !== d) groups.push({ day: d, rows: [] });
    groups.at(-1)!.rows.push(e);
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const any = f.from || f.to || f.types || f.q;
  const exportParams = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  return (
    <div className="page w-960">
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div><h1>Vēsture</h1><div className="sub">Visas darbības — {total} notikumi</div></div>
        <ExportButton what="history" params={exportParams} />
      </div>
      <div className="card row" style={{ padding: '14px var(--card)', marginBottom: 'var(--gap)' }}>
        <select className="input sm" style={{ width: 'auto' }} aria-label="Darbība" value={f.types} onChange={set('types')}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="row muted" style={{ gap: 6, fontSize: 12 }}>No <input type="date" className="input sm" style={{ width: 'auto' }} value={f.from} onChange={set('from')} /> līdz <input type="date" className="input sm" style={{ width: 'auto' }} value={f.to} onChange={set('to')} /></span>
        <input className="input sm" style={{ flex: 1, minWidth: 150 }} placeholder="Numurs, klients, vieta…" value={f.q} onChange={set('q')} />
        {any && <button className="btn sm" style={{ height: 38 }} onClick={() => setF({ from: '', to: '', types: '', q: '' })}>✕ Notīrīt</button>}
      </div>
      {!list.length ? <div className="card empty">{h.isLoading ? 'Ielādē…' : 'Nekas netika atrasts ar šiem filtriem.'}</div> : groups.map((g) => {
        const [dd, mm, yy] = g.day.split('.');
        return (
          <div key={g.day}>
            <div className="label" style={{ margin: '16px 0 8px', fontSize: 12, fontWeight: 700 }}>{dd}. {MONTHS[Number(mm) - 1] ?? mm} {yy}</div>
            <div className="card clip">
              {g.rows.map((e, i) => {
                const detail = [e.cust, e.tires].filter(Boolean).join(' · ');
                return (
                  <div key={i} className={`hoverrow${e.recordId ? ' clickable' : ''}`} onClick={() => e.recordId && openRecord(e.recordId)}
                    style={{ display: 'grid', gridTemplateColumns: '52px 104px 1fr auto', gap: 10, alignItems: 'center', padding: '11px var(--card)', borderBottom: '1px solid var(--border)' }}>
                    <span className="mono muted-2" style={{ fontSize: 12, fontWeight: 600 }}>{evWhen(e.d).t || '—'}</span>
                    <ActBadge type={e.type} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span className="mono" style={{ fontWeight: 600, fontSize: 13, flex: 'none' }}>{e.plate || '—'}</span>
                        {e.loc && <span className="mono muted" style={{ fontSize: 11, flex: 'none' }}>{e.loc}</span>}
                        {detail && <span className="muted ellipsis" style={{ fontSize: 12 }}>{detail}</span>}
                      </span>
                      {e.comment && <span className="muted-2 ellipsis" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>“{e.comment}”</span>}
                    </span>
                    <span className="mono muted nowrap" style={{ fontSize: 11, fontWeight: 600 }}>{actorName(e.actor)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {!!list.length && (h.hasNextPage
        ? <button className="btn lg block" style={{ marginTop: 14 }} disabled={h.isFetchingNextPage} onClick={() => h.fetchNextPage()}>{h.isFetchingNextPage ? 'Ielādē…' : `Ielādēt vēl (${list.length} no ${total})`}</button>
        : <div className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 14 }}>Parādīti visi {total} ieraksti.</div>)}
    </div>
  );
}
