'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, del, enc, errMsg, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useToast } from '@/client/toast';
import { useOpenTasks, useRefresh } from '@/client/queries';
import { enablePush } from '@/client/push';
import { evWhen } from '@/domain/format';
import { TASK_KIND_LABEL } from '@/domain/tasks';
import type { Task } from '@/domain/types';
import { useOpenRecord } from '../records/RecordProvider';
import { ExportButton } from '../ui/ExportButton';

// Notification.permission, read without a hydration mismatch (the server says
// "granted" so the bell only appears once the browser knows otherwise).
const permListeners = new Set<() => void>();
const readPerm = () => (typeof Notification === 'undefined' ? 'granted' : Notification.permission);
const subscribePerm = (cb: () => void) => { permListeners.add(cb); return () => { permListeners.delete(cb); }; };
const useNotificationPermission = () => useSyncExternalStore(subscribePerm, readPerm, () => 'granted');

const KIND_TONE: Record<Task['kind'], string> = { prepare: 'warn', store: 'ok', order: 'accent' };
type Tab = 'open' | 'new' | 'done';
const TABS: Array<[Tab, string]> = [['open', 'Darāmie'], ['new', 'Pasūtīt'], ['done', 'Vēsture']];
// Where the goods must land; travels on the task's location.
const DESTS: Array<[string, string]> = [['', '—'], ['VEIKALS', 'Veikals'], ['MONTĀŽA', 'Montāža'], ['__custom__', 'Cits…']];

function TaskCard({ t, onChanged }: { t: Task; onChanged: () => void }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const openRecord = useOpenRecord();
  const done = t.status === 'done';
  const w = evWhen(done ? (t.doneAt || t.createdAt) : t.createdAt);
  const when = [w.d, w.t].filter(Boolean).join(' ');
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); onChanged(); } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās atjaunināt uzdevumu')); }
  };
  const remove = async () => {
    const r = await dialogs.confirm({ icon: 'warning', title: 'Dzēst uzdevumu?', confirmText: 'Dzēst', danger: true });
    if (r.ok) await run(() => del(`/api/tasks/${enc(t.id)}`));
  };
  return (
    <div className="card" style={{ padding: '16px var(--card)', marginBottom: 10, opacity: done ? 0.62 : 1 }}>
      <div className="twrap" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8, marginBottom: 7 }}>
            <span className={`badge ${KIND_TONE[t.kind]}`}>{TASK_KIND_LABEL[t.kind]}</span>
            {t.location && <span className="badge dark" style={{ fontSize: 12 }}>{t.location}</span>}
          </div>
          <div className={t.kind !== 'order' ? 'mono' : undefined} style={{ fontWeight: 600, fontSize: 17, wordBreak: 'break-word', textDecoration: done ? 'line-through' : undefined }}>
            {t.title}
            {t.recordId && <button className="btn xs" style={{ marginLeft: 9, verticalAlign: 2, fontWeight: 600 }} title="Atvērt ierakstu — dati un bildes" onClick={() => openRecord(t.recordId!)}>Atvērt ↗</button>}
          </div>
          {t.details && <div className="muted-2" style={{ fontSize: 14, marginTop: 4, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{t.details}</div>}
          <div className="muted" style={{ fontSize: 12, marginTop: 7 }}>{done ? `Pabeidza ${t.doneBy || '—'} · ${when || '—'}` : `Pieprasīja ${t.createdBy || 'R1'} · ${when || '—'}`}</div>
        </div>
        <div className="tbtns" style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 'none' }}>
          {done ? (
            <>
              <button className="btn" style={{ height: 42 }} onClick={() => run(() => post(`/api/tasks/${enc(t.id)}/reopen`))}>↺ Atjaunot</button>
              <button className="btn ghost" style={{ height: 36 }} onClick={remove}>Dzēst</button>
            </>
          ) : <button className="btn ok" style={{ height: 52, padding: '0 22px', fontSize: 16, fontWeight: 700, borderRadius: 11 }} onClick={() => run(() => post(`/api/tasks/${enc(t.id)}/done`), 'Gatavs ✓')}>✓ Gatavs</button>}
        </div>
      </div>
    </div>
  );
}

function Compose({ onSent }: { onSent: () => void }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const [dest, setDest] = useState('');
  const [custom, setCustom] = useState('');
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const send = async () => {
    const t = text.trim();
    if (!t) { box.current?.focus(); return; }
    const location = dest === '__custom__' ? custom.trim() : dest;
    try {
      await post('/api/tasks', { text: t, location: location || null });
      setText('');
      toast('Nosūtīts uz noliktavu');
      onSent();
    } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās nosūtīt')); }
  };
  return (
    <div className="card pad">
      <div className="label" style={{ marginBottom: 8 }}>Kur piegādāt?</div>
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <div className="chips">{DESTS.map(([k, l]) => <button key={k} className={`chip${dest === k ? ' on' : ''}`} onClick={() => { setDest(k); box.current?.focus(); }}>{l}</button>)}</div>
        {dest === '__custom__' && <input className="input sm" style={{ height: 36, flex: 1, minWidth: 140 }} placeholder="piem. 2. bokss" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      </div>
      <div className="label" style={{ marginBottom: 8 }}>Ko vajag no noliktavas?</div>
      <div className="tcompose" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <textarea ref={box} rows={3} className="input" style={{ flex: 1, minWidth: 0, borderRadius: 10 }} placeholder={'piem. 4× Nokian 205/55/16 no A ceha\nBMW X5 klientam, ar diskiem'}
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="btn lg primary" onClick={send}>Nosūtīt</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 9, lineHeight: 1.6 }}>Pirmā rinda ir virsraksts, pārējais — apraksts.<br />Enter nosūta · Shift+Enter jauna rinda. Noliktavas darbinieks saņem paziņojumu uzreiz, un uzdevums parādās sadaļā <b>Darāmie</b>.</div>
    </div>
  );
}

/**
 * The warehouse worker's one screen: only what still has to be fetched or
 * shelved. Ticking a job done takes it out of the list.
 */
export function WarehouseScreen() {
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const [tab, setTab] = useState<Tab>('open');
  const open = useOpenTasks();
  const doneQ = useQuery({ queryKey: ['tasks', 'done'], queryFn: () => api<{ tasks: Task[]; open: number }>('/api/tasks?status=done'), enabled: tab === 'done' });
  const perm = useNotificationPermission();
  const n = open.data?.open ?? 0;
  const list = tab === 'done' ? doneQ.data?.tasks : open.data?.tasks;
  const loading = tab === 'done' ? doneQ.isLoading : open.isLoading;
  const sub = { open: `${n} ${n === 1 ? 'uzdevums' : 'uzdevumi'} — kas vēl nav atnests`, new: 'Pieprasi riepas vai citu preci no noliktavas', done: 'Padarītie darbi — arhīvs' }[tab];

  const bell = async () => {
    const r = await enablePush();
    if (r === 'unsupported') await dialogs.alert('Šī pārlūkprogramma neatbalsta paziņojumus');
    else if (r === 'blocked') await dialogs.alert('Paziņojumi ir bloķēti. Atļauj tos pārlūka iestatījumos šai lapai.');
    else toast('Paziņojumi ieslēgti');
    permListeners.forEach((cb) => cb());
  };

  return (
    <div className="page w-840">
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Noliktava</h1>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>
      <div className="subtabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`subtab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {label}{k === 'open' && n > 0 && <span className="pill-count" style={{ marginLeft: 7, verticalAlign: 1 }}>{n}</span>}
          </button>
        ))}
        <span className="row" style={{ marginLeft: 'auto', alignSelf: 'center', gap: 8 }}>
          {tab !== 'new' && <ExportButton what="tasks" params={{ status: tab === 'done' ? 'done' : 'open' }} small />}
          {perm !== 'granted' && <button className="btn sm dark" title="Ieslēgt paziņojumus uz šo ierīci" onClick={bell}>🔔 Paziņojumi</button>}
        </span>
      </div>
      {tab === 'new' ? <Compose onSent={() => { setTab('open'); void refresh(); }} />
        : loading ? <div className="card empty left">Ielādē…</div>
        : !list?.length ? (
          <div className="card empty">{tab === 'done' ? 'Vēl nekas nav pabeigts.' : <>Viss padarīts — nekas nav jāatnes. ✓<br /><span style={{ fontSize: 13 }}>Jauni uzdevumi parādās, kad kāds nospiež “Sagatavot” vai pasūta no noliktavas.</span></>}</div>
        ) : list.map((t) => <TaskCard key={t.id} t={t} onChanged={() => void refresh()} />)}
    </div>
  );
}
