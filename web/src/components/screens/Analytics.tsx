'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/client/api';
import type { Analytics } from '@/domain/analytics';
import { ExportButton } from '../ui/ExportButton';

function BarCard({ title, items, color }: { title: string; items: Array<{ label: string; count: number }>; color: string }) {
  const max = items.reduce((m, x) => Math.max(m, x.count), 0) || 1;
  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 14 }}>{title}</h2>
      {!items.length && <div className="muted" style={{ fontSize: 13 }}>Nav datu</div>}
      {items.map((x) => (
        <div key={x.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
          <div className="muted-2 ellipsis" style={{ width: 118, flex: 'none', fontSize: 12.5 }} title={x.label}>{x.label}</div>
          <div style={{ flex: 1, height: 20, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(3, Math.round((x.count / max) * 100))}%`, background: color, borderRadius: 6 }} />
          </div>
          <div className="mono" style={{ width: 52, flex: 'none', textAlign: 'right', fontSize: 12.5, fontWeight: 600 }}>{x.count}</div>
        </div>
      ))}
    </div>
  );
}

const Stat = ({ label, value, color }: { label: string; value: number; color?: string }) =>
  <div className="card pad stat"><div className="label">{label}</div><div className="value" style={{ fontSize: 28, color }}>{value}</div></div>;

export function AnalyticsScreen() {
  const [f, setF] = useState({ season: '', status: '', customer: '', rims: '' });
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const q = useQuery({
    queryKey: ['analytics', f], placeholderData: keepPreviousData,
    queryFn: () => api<Analytics>(`/api/analytics?${new URLSearchParams(params)}`),
  });
  const a = q.data;
  const sel = (k: keyof typeof f, opts: Array<[string, string]>, label: string) => (
    <select className="input sm" aria-label={label} style={{ width: 'auto', fontWeight: 500 }} value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div className="page w-1240">
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div><h1>Analītika</h1><div className="sub">{f.season ? <>Avots: <b>{f.season}</b></> : 'Auto markas, izmēri, ražotāji un sezonu sadalījums'}</div></div>
        {a && <ExportButton what="analytics" params={params} />}
      </div>
      {a && (
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          {sel('season', [['', 'Visas sezonas'], ...a.seasonOptions.map((s): [string, string] => [s, s])], 'Sezona')}
          {sel('status', [['', 'Visi statusi'], ['active', 'Glabājas'], ['released', 'Izsniegti'], ['prepared', 'Rezervēti']], 'Statuss')}
          {sel('customer', [['', 'Visi klienti'], ['company', 'Uzņēmumi'], ['private', 'Privātpersonas']], 'Klienti')}
          {sel('rims', [['', 'Diski: visi'], ['with', 'Ar diskiem'], ['without', 'Bez diskiem']], 'Diski')}
          {Object.keys(params).length > 0 && <button className="btn sm" style={{ height: 38 }} onClick={() => setF({ season: '', status: '', customer: '', rims: '' })}>✕ Notīrīt</button>}
        </div>
      )}
      {q.isLoading ? <div className="card empty left">Ielādē…</div> : !a ? <div className="card empty left" style={{ color: 'var(--danger)' }}>Neizdevās ielādēt datus.</div> : (
        <div style={{ opacity: q.isFetching ? 0.6 : 1, transition: 'opacity .15s' }}>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Stat label="Ieraksti kopā" value={a.total} />
            <Stat label="Glabājas" value={a.active} color="var(--ok)" />
            <Stat label="Izsniegti" value={a.released} color="var(--ink-3)" />
            <Stat label="Rezervēti" value={a.prepared} color="var(--warn)" />
            <Stat label="Ar 2. izmēru" value={a.withSecondSize} color="var(--accent)" />
          </div>
          <div className="grid-halves">
            <BarCard title="Populārākās auto markas" items={a.makes} color="var(--accent)" />
            <BarCard title="Populārākie izmēri" items={a.sizes} color="oklch(0.62 0.13 200)" />
            <BarCard title="Populārākie modeļi" items={a.models} color="oklch(0.60 0.15 280)" />
            <BarCard title="Populārākie ražotāji" items={a.brands} color="oklch(0.62 0.15 155)" />
            <BarCard title="Daudzuma veidi" items={a.quantities} color="oklch(0.65 0.14 60)" />
            <BarCard title="Sezonas" items={a.seasons} color="oklch(0.58 0.12 330)" />
          </div>
        </div>
      )}
    </div>
  );
}
