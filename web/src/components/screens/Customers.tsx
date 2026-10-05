'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errMsg, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useSession } from '@/client/session';
import { useToast } from '@/client/toast';
import { useRefresh } from '@/client/queries';
import { useDebounced } from '@/client/useDebounced';
import { initialsOf } from '@/domain/format';
import type { CustomerCard } from '@/domain/records';
import { useOpenRecord } from '../records/RecordProvider';
import { useRecordActions } from '../records/actions';
import { ExportButton } from '../ui/ExportButton';

const HCOLS = '0.9fr 0.7fr 1.5fr 0.5fr 0.8fr 0.8fr 0.9fr 0.9fr 0.7fr 0.9fr';

export function CustomersScreen() {
  const { can } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const openRecord = useOpenRecord();
  const act = useRecordActions();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [selName, setSel] = useState<string | null>(null);
  const dq = useDebounced(q).trim();
  const data = useQuery({ queryKey: ['customers', dq, type], queryFn: () => api<{ customers: CustomerCard[] }>(`/api/customers?${new URLSearchParams({ q: dq, type })}`) });
  const list = data.data?.customers ?? [];
  const selKey = (c: CustomerCard) => `${c.name}|${c.plate}`;
  const sel = list.find((c) => selKey(c) === selName) ?? list[0];

  // A customer with hundreds of visits can't be corrected record by record.
  const flip = async (c: CustomerCard) => {
    const toCo = !c.isCompany;
    const r = await dialogs.confirm({
      title: toCo ? 'Pārvērst par uzņēmumu?' : 'Pārvērst par privātpersonu?', confirmText: 'Mainīt',
      body: <><b>{c.name}</b> — mainīs klienta veidu <b>visiem</b> šī klienta ierakstiem (arī vēsturē).</>,
    });
    if (!r.ok) return;
    try { const d = await post<{ changed: number }>('/api/customers/type', { name: c.name, isCompany: toCo }); toast(`Mainīti ${d.changed} ieraksti`); void refresh(); }
    catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās mainīt')); }
  };

  return (
    <div className="page w-1240">
      <div className="page-head">
        <div><h1>Klienti</h1><div className="sub">{list.length} rādīti</div></div>
        <div className="chips">
          {[['', 'Visi'], ['company', 'Uzņēmumi'], ['private', 'Privātie']].map(([k, l]) => <button key={k} className={`chip${type === k ? ' on' : ''}`} onClick={() => { setType(k); setSel(null); }}>{l}</button>)}
        </div>
        <ExportButton what="customers" params={{ q: dq, type }} />
        <input className="input sm" style={{ height: 40, width: 300, maxWidth: '100%' }} placeholder="Meklēt pēc numura, vārda, telefona…" aria-label="Meklēt klientus" value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} />
      </div>
      <div className="grid-side">
        <div className="card cust-list" style={{ overflow: 'hidden', maxHeight: '70vh', overflowY: 'auto' }}>
          {!list.length && <div className="empty left">{data.isLoading ? 'Ielādē…' : 'Nav rezultātu'}</div>}
          {list.map((c) => (
            <button key={selKey(c)} className={`list-row${sel && selKey(sel) === selKey(c) ? ' on' : ''}`} onClick={() => setSel(selKey(c))}>
              <span className="row" style={{ gap: 11, minWidth: 0, flexWrap: 'nowrap' }}>
                <span className="initials">{initialsOf(c.name)}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="ellipsis" style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                  <span className="mono muted" style={{ display: 'block', fontSize: 11 }}>{c.plates.length > 1 ? `${c.plates.length} auto: ${c.plates.slice(0, 2).join(', ')}${c.plates.length > 2 ? '…' : ''}` : c.plate}</span>
                </span>
              </span>
              <span className={`badge sm ${c.active > 0 ? 'ok' : 'plain'}`}>{c.active} aktīvs</span>
            </button>
          ))}
        </div>
        {sel ? (
          <div className="stack">
            <div className="card pad">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 14 }}>
                  <span style={{ width: 52, height: 52, borderRadius: 13, background: 'var(--accent-soft)', color: 'var(--accent-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 18 }}>{initialsOf(sel.name)}</span>
                  <div>
                    <h2 style={{ fontSize: 19 }}>{sel.name}</h2>
                    <div className="row" style={{ gap: 8, marginTop: 5 }}>
                      <span className="badge plain">{sel.isCompany ? 'Uzņēmums' : 'Privātpersona'}</span>
                      <button className="btn xs" title="Mainīt klienta veidu visiem šī klienta ierakstiem" onClick={() => flip(sel)}>→ {sel.isCompany ? 'Privātpersona' : 'Uzņēmums'}</button>
                      <span className="muted" style={{ fontSize: 12 }}>Klients kopš {sel.since}</span>
                    </div>
                  </div>
                </div>
                <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{sel.phone || '—'}</div>
              </div>
              <div className="rf3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 18 }}>
                <div className="tile"><div className="label">Auto</div><div className="v" style={{ fontWeight: 600, fontSize: 13 }}>{sel.vehicle || '—'}</div></div>
                <div className="tile"><div className="label">{sel.plates.length > 1 ? `Numuri (${sel.plates.length})` : 'Numurs'}</div><div className="v mono" style={{ fontWeight: 600, fontSize: 12 }}>{sel.plates.length ? `${sel.plates.slice(0, 4).join(' · ')}${sel.plates.length > 4 ? ` +${sel.plates.length - 4}` : ''}` : sel.plate}</div></div>
                <div className="tile"><div className="label">Glabāšanas reizes</div><div className="v mono" style={{ fontWeight: 600 }}>{sel.total}</div></div>
              </div>
            </div>
            <div className="card clip">
              <div className="card-head"><h2 style={{ fontSize: 14 }}>Glabāšanas vēsture</h2></div>
              <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 900 }}>
                <div className="grid-table-head" style={{ gridTemplateColumns: HCOLS }}><span>Sezona</span><span>Numurs</span><span>Riepas</span><span>Vieta</span><span>Protektors</span><span>Cena</span><span>Saņemts</span><span>Izsniegts</span><span>SMS</span><span>Statuss</span></div>
                {sel.history.map((h) => (
                  <div key={h.id} className="grid-table-row hoverrow clickable" title="Atvērt un rediģēt" style={{ gridTemplateColumns: HCOLS }} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) openRecord(h.id); }}>
                    <span style={{ fontWeight: 500 }}>{h.season || '—'}</span><span className="mono" style={{ fontSize: 12 }}>{h.plate || '—'}</span>
                    <span className="muted-2">{h.tires}{h.tires2 && <span className="muted" style={{ display: 'block', fontSize: 12 }}>+ {h.tires2}</span>}{h.rims && <span className="muted" style={{ display: 'block', fontSize: 11 }}>{h.rims}</span>}{h.notes && <span className="muted" style={{ display: 'block', fontSize: 11, fontStyle: 'italic' }}>{h.notes}</span>}</span>
                    <span className="mono">{h.loc}</span><span className="mono" style={{ fontSize: 12 }}>{h.thread}</span><span className="mono">{h.fee}</span>
                    <span className="mono" style={{ fontSize: 12 }}>{h.intakeDate || '—'}</span><span className="mono" style={{ fontSize: 12 }}>{h.releaseDate || '—'}</span>
                    <span className="mono muted" style={{ fontSize: 11 }}>{h.sms || '—'}</span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className={`badge ${h.status === 'active' ? 'ok' : 'plain'}`}>{h.status === 'active' ? 'Glabājas' : 'Izsniegts'}</span>
                      {h.status === 'active' && can('act.operate') && <button className="btn xs" onClick={() => act.release({ id: h.id, plate: h.plate, loc: h.loc }, { reintake: true })}>Izsniegt</button>}
                    </span>
                  </div>
                ))}
              </div></div>
            </div>
          </div>
        ) : <div />}
      </div>
    </div>
  );
}
