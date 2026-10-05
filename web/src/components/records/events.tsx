'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, del, enc, errMsg, patch, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { actorName } from '@/domain/format';
import type { RecordEvent } from '@/domain/types';

const EV_LABEL: Record<string, string> = {
  created: 'Pieņemts', prepared: 'Sagatavots (izņemts maiņai)', unprepared: 'Novietots atpakaļ vietā', released: 'Izsniegts',
  swapped: 'Aizvietots ar jaunām', blocked: 'Bloķēts', unblocked: 'Atbloķēts', edited: 'Rediģēti dati', comment: 'Komentārs', photo: 'Pievienota bilde',
};
const EV_COLOR: Record<string, string> = {
  created: 'var(--ok)', prepared: 'var(--warn)', unprepared: 'var(--ink-3)', released: 'var(--ink-3)', swapped: 'var(--accent)',
  blocked: 'var(--danger)', unblocked: 'var(--ok)', edited: 'var(--accent)', comment: 'oklch(0.6 0.13 285)', photo: 'oklch(0.6 0.13 200)',
};
const when = (s: string | null) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

/** A record's history and comments. Only comments can be edited — the rest is the audit trail. */
export function RecordEvents({ recordId, canComment, onChange }: { recordId: string; canComment: boolean; onChange: () => void }) {
  const dialogs = useDialogs();
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['events', recordId], queryFn: () => api<{ events: RecordEvent[] }>(`/api/storage/${enc(recordId)}/events`) });
  const reload = () => { void q.refetch(); onChange(); };

  const add = async () => {
    const c = text.trim();
    if (!c) return;
    try { await post(`/api/storage/${enc(recordId)}/events`, { comment: c }); setText(''); reload(); }
    catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās pievienot')); }
  };
  const edit = async (ev: RecordEvent) => {
    const r = await dialogs.confirm({ title: 'Labot komentāru', icon: 'info', confirmText: 'Saglabāt', input: { initial: ev.comment ?? '', multiline: true } });
    if (!r.ok) return;
    try { await patch(`/api/events/${enc(ev.id)}`, { comment: r.value }); reload(); } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās saglabāt')); }
  };
  const remove = async (ev: RecordEvent) => {
    const r = await dialogs.confirm({ icon: 'warning', title: 'Dzēst komentāru?', confirmText: 'Dzēst', danger: true });
    if (!r.ok) return;
    try { await del(`/api/events/${enc(ev.id)}`); reload(); } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās dzēst')); }
  };

  const events = q.data?.events ?? [];
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>Vēsture un komentāri</div>
      {q.isLoading && !events.length && <div className="muted small">Ielādē vēsturi…</div>}
      {events.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flex: 'none', background: EV_COLOR[e.action] ?? 'var(--ink-3)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{EV_LABEL[e.action] ?? e.action}</span>
              <span className="muted nowrap" style={{ fontSize: 11 }}>{when(e.createdAt)}{e.actor && <> · <b style={{ letterSpacing: '.02em' }}>{actorName(e.actor)}</b></>}</span>
            </div>
            {e.comment && <div className="muted-2" style={{ fontSize: 13, marginTop: 2, wordBreak: 'break-word' }}>{e.comment}</div>}
            {e.action === 'comment' && canComment && (
              <div className="row" style={{ gap: 12, marginTop: 3 }}>
                <button className="btn link" style={{ fontSize: 11 }} onClick={() => edit(e)}>Labot</button>
                <button className="btn link" style={{ fontSize: 11, color: 'var(--danger)' }} onClick={() => remove(e)}>Dzēst</button>
              </div>
            )}
          </div>
        </div>
      ))}
      {!events.length && !q.isLoading && <div className="muted small">Nav darbību vēstures.</div>}
      {canComment && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input className="input sm" style={{ flex: 1, minWidth: 0 }} placeholder="Pievienot komentāru…" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
          <button className="btn primary" style={{ height: 38 }} onClick={add}>Pievienot</button>
        </div>
      )}
    </div>
  );
}
