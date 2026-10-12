'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, enc } from '@/client/api';
import { useSession } from '@/client/session';
import { useDebounced } from '@/client/useDebounced';
import { printNode } from '@/client/print';
import { normCode, type StorageRecord } from '@/domain/types';
import type { SetCard } from '@/domain/records';
import { useRecordActions } from '../records/actions';
import { useOpenRecord } from '../records/RecordProvider';
import { PrintAct } from '../records/PrintAct';

const Tile = ({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) =>
  <div className="tile"><div className="label">{label}</div><div className="v mono" style={{ fontWeight: strong ? 600 : 500 }}>{children}</div></div>;

/** Find a stored set by SMS code, plate or place, print the handover act, hand it over. */
export function ReleaseScreen() {
  const { can, user } = useSession();
  const act = useRecordActions();
  const openRecord = useOpenRecord();
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const debounced = useDebounced(input);
  // Enter searches at once; typing searches after a short pause.
  const q = normCode(submitted === input ? submitted : debounced);
  const res = useQuery({ queryKey: ['release-lookup', q], queryFn: () => api<{ results: SetCard[] }>(`/api/release-lookup?q=${enc(q)}`), enabled: !!q });
  const list = res.data?.results ?? [];

  const print = async (id: string) => {
    const r = await api<StorageRecord>(`/api/storage/${enc(id)}`);
    printNode(<PrintAct r={r} staff={user.name || user.username} />);
  };

  return (
    <div className="page w-1000">
      <div className="page-head"><div><h1>Izsniegt glabāšanu</h1><div className="sub">Ievadi SMS kodu vai numura zīmi, lai atrastu glabātās riepas</div></div></div>
      <form className="card pad" style={{ marginBottom: 'var(--gap)', display: 'flex', gap: 10 }} onSubmit={(e) => { e.preventDefault(); setSubmitted(input); }}>
        <input className="input big" style={{ flex: 1, minWidth: 0, fontSize: 18 }} placeholder="SMS kods vai numura zīme…" autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus
          aria-label="SMS kods vai numura zīme" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="btn xl primary">⌕ Meklēt</button>
      </form>
      {!q ? <div className="card empty">Ievadi SMS kodu vai numura zīmi augšā.</div>
        : res.isLoading ? <div className="card empty left">Meklē…</div>
        : !list.length ? <div className="card empty">Nekas netika atrasts pēc <b className="mono">{q}</b>.<br /><span style={{ fontSize: 13 }}>Pārbaudi kodu vai numuru — iespējams, riepas jau ir izsniegtas.</span></div>
        : list.map((x) => {
          const ref = { id: x.id, plate: x.plate, loc: x.loc };
          return (
            // The whole card opens the record; the buttons on it do their own job.
            <div key={x.id} className="card pad clickable" style={{ marginBottom: 12 }} title="Atvērt ierakstu" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) openRecord(x.id); }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 14, flexWrap: 'nowrap', minWidth: 0 }}>
                  <span className="mono" style={{ minWidth: 48, height: 48, padding: '0 8px', borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, flex: 'none' }}>{x.loc || '—'}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 9 }}><span className="mono" style={{ fontWeight: 600, fontSize: 17 }}>{x.plate || '—'}</span><span className="badge ok">Glabājas</span></div>
                    <div className="muted-2" style={{ fontSize: 13, marginTop: 3 }}>{x.cust || '—'}{x.phone && <> · <span className="mono">{x.phone}</span></>}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" style={{ height: 44 }} title="Izdrukāt izsniegšanas aktu ar paraksta vietu" onClick={() => print(x.id)}>⎙ Drukāt</button>
                  {can('act.operate') && <>
                    <button className="btn" style={{ height: 44 }} title="Izņemt riepas, vietu paturēt rezervētu maiņai" onClick={() => act.prepare(ref)}>Sagatavot</button>
                    <button className="btn primary" style={{ height: 44, padding: '0 20px' }} onClick={() => act.release(ref, { reintake: true })}>Izsniegt riepas</button>
                  </>}
                </div>
              </div>
              <div className="tiles" style={{ marginTop: 16 }}>
                <Tile label="SMS kods" strong>{x.sms || '—'}</Tile>
                <Tile label="Izmērs">{x.size || '—'}{x.size2 ? ` + ${x.size2}` : ''}</Tile>
                <Tile label="Ražotājs">{x.brand || '—'}</Tile>
                <Tile label="Protektors">{x.thread}</Tile>
                <Tile label="Cena" strong>{x.fee}</Tile>
                <Tile label="Pieņemts">{x.intakeDate || '—'}</Tile>
              </div>
            </div>
          );
        })}
    </div>
  );
}
