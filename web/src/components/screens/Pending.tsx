'use client';

import { useSession } from '@/client/session';
import { usePending } from '@/client/queries';
import { useRecordActions } from '../records/actions';
import { tiresOf } from '../records/tires';
import { ExportButton } from '../ui/ExportButton';

/** Sets taken out for a seasonal swap: the place is held until the new tires arrive. */
export function PendingScreen() {
  const { can } = useSession();
  const q = usePending();
  const act = useRecordActions();
  const list = q.data?.pending ?? [];
  return (
    <div className="page w-1000">
      <div className="page-head">
        <div><h1>Sagatavotie</h1><div className="sub">Riepas izņemtas, vieta rezervēta — gaida sezonas maiņu</div></div>
        {!!list.length && <ExportButton what="pending" />}
      </div>
      {q.isLoading ? <div className="card empty left">Ielādē…</div> : !list.length ? (
        <div className="card empty">Nav sagatavotu riepu.<br /><span style={{ fontSize: 13 }}>Sadaļā <b>Izsniegt glabāšanu</b> vai <b>Novietnes</b> nospied “Sagatavot”, lai izņemtu riepas un rezervētu vietu.</span></div>
      ) : list.map((x) => {
        const ref = { id: x.id, plate: x.plate, loc: x.loc };
        return (
          <div key={x.id} className="card pad" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 14, flexWrap: 'nowrap', minWidth: 0 }}>
                <span className="mono" style={{ minWidth: 48, height: 48, padding: '0 8px', borderRadius: 12, background: 'var(--warn-soft)', color: 'var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, flex: 'none' }}>{x.loc || '—'}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 9 }}><span className="mono" style={{ fontWeight: 600, fontSize: 17 }}>{x.plate || '—'}</span><span className="badge warn">Rezervēts · gaida maiņu</span></div>
                  <div className="muted-2" style={{ fontSize: 13, marginTop: 3 }}>{x.cust || '—'}{x.phone && <> · <span className="mono">{x.phone}</span></>}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Izņemtas: {tiresOf(x)}{x.preparedDate ? ` · sagatavots ${x.preparedDate}` : ''}</div>
                </div>
              </div>
              {can('act.operate') && (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn primary" style={{ height: 42 }} onClick={() => act.swap(ref)}>Pieņemt jaunās riepas</button>
                  <button className="btn" style={{ height: 42 }} title="Novietot atpakaļ vietā" onClick={() => act.unprepare(x.id)}>Atpakaļ vietā</button>
                  <button className="btn danger-text" style={{ height: 42 }} onClick={() => act.terminate(ref)}>Slēgt (bez jaunām)</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
