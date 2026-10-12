'use client';

import { useQuery } from '@tanstack/react-query';
import { api, enc } from '@/client/api';
import { Modal, useDialogs } from '@/client/dialogs';
import { useSession } from '@/client/session';
import { useToast } from '@/client/toast';
import { useRefresh } from '@/client/queries';
import { printNode } from '@/client/print';
import { eur } from '@/domain/format';
import { notesOf, size2Of } from '@/domain/sizes';
import type { StorageRecord } from '@/domain/types';
import { useRecordActions } from './actions';
import { StatusBadge } from './status';
import { RecordPhotos } from './photos';
import { RecordEvents } from './events';
import { EditRecordDialog } from './EditRecordDialog';
import { PrintAct } from './PrintAct';

function Fld({ label, value, mono, wide }: { label: string; value: string | null | undefined; mono?: boolean; wide?: boolean }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <div className="label" style={{ marginBottom: 3 }}>{label}</div>
      <div className={mono ? 'mono' : undefined} style={{ fontWeight: 500, fontSize: 14, wordBreak: 'break-word' }}>{value || '—'}</div>
    </div>
  );
}

/** The full record: data, photos, history and comments, and what can be done with it. */
export function RecordModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, user } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const act = useRecordActions();
  const q = useQuery({ queryKey: ['record', id], queryFn: () => api<StorageRecord>(`/api/storage/${enc(id)}`) });
  const r = q.data;

  const closeAfter = (p: Promise<boolean>) => p.then((done) => { if (done) onClose(); });
  const ref = r ? { id: r.id, plate: r.plate, loc: r.location } : null;
  const edit = async () => {
    if (!r) return;
    const saved = await dialogs.open<StorageRecord>((done) => <EditRecordDialog r={r} done={done} />);
    if (saved) { toast('Saglabāts'); void refresh(); }
  };

  const size2 = r ? size2Of(r) : '';
  return (
    <Modal onClose={onClose} labelledBy="rec-title">
      <div className="modal-head">
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <span id="rec-title" className="mono" style={{ fontWeight: 600, fontSize: 20 }}>{r?.plate || '—'}</span>
          {r && <StatusBadge status={r.status} />}
        </div>
        <button className="btn icon" aria-label="Aizvērt" onClick={onClose}>✕</button>
      </div>
      {q.isError && <div className="empty">Ieraksts nav atrasts.</div>}
      {!r && !q.isError && <div className="empty">Ielādē…</div>}
      {r && ref && (
        <>
          <div className="modal-body modal-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 22 }}>
            <Fld label="Vieta" value={r.location} mono /><Fld label="Sezona" value={r.season} />
            <Fld label="Klients" value={r.customerName} /><Fld label="Telefons" value={r.phone} mono />
            <Fld label="Izmērs" value={r.size1} mono /><Fld label="2. izmērs" value={size2} mono />
            <Fld label="Ražotājs" value={r.brand} /><Fld label="Daudzums" value={r.quantity} />
            <Fld label="Diski" value={r.rimNote || (size2 ? '—' : 'Bez diskiem')} /><Fld label="Protektors" value={r.threadDepth ? `${r.threadDepth} mm` : '—'} mono />
            <Fld label="SMS kods" value={r.smsCode} mono /><Fld label="Cena" value={r.feeEur ? eur(r.feeEur) : '—'} mono />
            <Fld label="Saņemts" value={r.intakeDate} mono /><Fld label="Izsniegts" value={r.releaseDate} mono />
            {notesOf(r) && <Fld label="Piezīmes" value={notesOf(r)} wide />}
          </div>
          <div style={{ padding: '0 24px 18px' }}><RecordPhotos recordId={r.id} canEdit={can('act.media')} onChange={() => void refresh()} /></div>
          <div style={{ padding: '0 24px 18px' }}><RecordEvents recordId={r.id} canComment={can('act.media')} onChange={() => void refresh()} /></div>
          <div style={{ padding: '16px 24px 22px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)' }}>
            {can('act.operate') && (r.status === 'active' ? (
              <>
                <button className="btn lg primary" onClick={() => closeAfter(act.release(ref, { comment: true }))}>Izsniegt riepas</button>
                <button className="btn lg" onClick={() => closeAfter(act.prepare(ref, { comment: true }))}>Sagatavot (maiņai)</button>
              </>
            ) : r.status === 'prepared' ? (
              <>
                <button className="btn lg primary" onClick={() => { onClose(); act.swap(ref); }}>Pieņemt jaunās riepas</button>
                <button className="btn lg danger-text" onClick={() => closeAfter(act.terminate(ref, { comment: true }))}>Slēgt (bez jaunām)</button>
                <button className="btn ghost" onClick={() => closeAfter(act.unprepare(r.id))}>Novietot atpakaļ vietā</button>
              </>
            ) : r.status === 'blocked' ? (
              <button className="btn lg primary" onClick={() => closeAfter(act.unblock(r.id))}>Atbloķēt vietu</button>
            ) : r.status === 'free' ? (
              <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 6 }}>Brīva vieta — riepu nav. Gatava jaunai pieņemšanai.</div>
            ) : (
              <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 6 }}>Izsniegts {r.releaseDate ?? ''} — aktīvu darbību nav.</div>
            ))}
            {can('act.edit') && <button className="btn" onClick={edit}>✎ Rediģēt datus</button>}
            <button className="btn" title="Izdrukāt izsniegšanas aktu ar paraksta vietu" onClick={() => printNode(<PrintAct r={r} staff={user.name || user.username} />)}>⎙ Drukāt izsniegšanas aktu</button>
          </div>
        </>
      )}
    </Modal>
  );
}
