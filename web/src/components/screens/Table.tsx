'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { api, errMsg } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useSession } from '@/client/session';
import { useToast } from '@/client/toast';
import { useRefresh } from '@/client/queries';
import { useDebounced } from '@/client/useDebounced';
import { notesOf, size2Of } from '@/domain/sizes';
import type { StorageRecord } from '@/domain/types';
import { StatusBadge } from '../records/status';
import { useOpenRecord } from '../records/RecordProvider';
import { ExportButton } from '../ui/ExportButton';

type Col = { k: string; t: string; mono?: boolean };
const COLS: Col[] = [
  { k: 'location', t: 'Vieta', mono: true }, { k: 'plate', t: 'Auto nr.', mono: true }, { k: 'makeModel', t: 'Nosaukums' },
  { k: 'customerName', t: 'Vārds' }, { k: 'phone', t: 'Telefons', mono: true }, { k: 'size1', t: 'Izmērs', mono: true },
  { k: 'size2', t: '2. izmērs', mono: true }, { k: 'brand', t: 'Ražotājs' }, { k: 'quantity', t: 'Skaits' }, { k: 'diski', t: 'Diski', mono: true },
  { k: 'notes', t: 'Piezīmes' }, { k: 'intakeDate', t: 'Saņemts', mono: true }, { k: 'releaseDate', t: 'Izsniegts', mono: true },
  { k: 'season', t: 'Sezona' }, { k: 'status', t: 'Statuss' },
];
const CAP = 800;

const val = (r: StorageRecord, k: string): string =>
  String((k === 'diski' ? r.rimNote : k === 'size2' ? size2Of(r) : k === 'notes' ? notesOf(r) : (r as unknown as Record<string, unknown>)[k]) ?? '');

/** Newest first when two records tie on the sorted column. */
const recency = (a: StorageRecord, b: StorageRecord) =>
  String(b.intakeDate || '').localeCompare(String(a.intakeDate || '')) || (Number(b.id) || 0) - (Number(a.id) || 0);

/** The full Excel-style list: search, filter by status, sort by any column. */
export function TableScreen() {
  const { isAdmin } = useSession();
  const openRecord = useOpenRecord();
  const [status, setStatus] = useState<'active' | 'released' | 'all'>('active');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250).trim().toLowerCase();
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'intakeDate', dir: 'desc' });
  const data = useQuery({ queryKey: ['storage'], queryFn: () => api<{ records: StorageRecord[] }>('/api/storage') });

  const { shown, total } = useMemo(() => {
    let rows = data.data?.records ?? [];
    if (status !== 'all') rows = rows.filter((r) => r.status === status);
    if (dq) rows = rows.filter((r) => [r.location, r.plate, r.makeModel, r.customerName, r.phone, r.size1, size2Of(r), r.brand, r.quantity, r.rimNote, r.notes, r.intakeDate, r.releaseDate, r.season]
      .some((v) => String(v || '').toLowerCase().includes(dq)));
    const dir = sort.dir === 'desc' ? -1 : 1;
    // A blank value sorts last either way instead of floating to the top.
    rows = [...rows].sort((a, b) => {
      const av = val(a, sort.col), bv = val(b, sort.col);
      if (!av !== !bv) return av ? -1 : 1;
      return av.localeCompare(bv, 'lv', { numeric: true }) * dir || recency(a, b);
    });
    return { shown: rows.slice(0, CAP), total: rows.length };
  }, [data.data, status, dq, sort]);

  const toggleSort = (k: string) => setSort((s) => (s.col === k ? { col: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: k, dir: 'asc' }));

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div><h1>Tabula</h1><div className="sub">Pilns saraksts — meklē, filtrē un kārto (klikšķini uz kolonnas)</div></div>
        <div className="row" style={{ gap: 8 }}>
          <div className="chips">
            {(['active', 'released', 'all'] as const).map((k) => <button key={k} className={`chip${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>{k === 'active' ? 'Glabājas' : k === 'released' ? 'Izsniegti' : 'Visi'}</button>)}
          </div>
          <ExportButton what="storage" params={{ status, q }} />
          <input className="input sm" style={{ width: 240, maxWidth: '100%' }} placeholder="Meklēt…" aria-label="Meklēt tabulā" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          {isAdmin && <ImportButton />}
        </div>
      </div>
      {!data.data ? <div className="card empty left">{data.isError ? 'Neizdevās ielādēt.' : 'Ielādē…'}</div> : (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Rādīti {shown.length} no {total}{total > CAP ? ' — precizē meklēšanu, lai redzētu vairāk' : ''}</div>
          <div className="card table-wrap">
            <table className="data" style={{ minWidth: 1180 }}>
              <thead><tr>{COLS.map((c) => (
                <th key={c.k} className={sort.col === c.k ? 'on' : ''} aria-sort={sort.col === c.k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button onClick={() => toggleSort(c.k)}>{c.t}{sort.col === c.k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button>
                </th>))}</tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => openRecord(r.id)}>
                    {COLS.map((c) => c.k === 'status'
                      ? <td key={c.k}><StatusBadge status={r.status} small /></td>
                      : <td key={c.k} className={c.mono ? 'mono' : undefined} title={val(r, c.k)}>{val(r, c.k) || '—'}</td>)}
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={COLS.length} className="muted" style={{ padding: 20 }}>Nav rezultātu</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

type Preview = { parsed: number; sheets: number; rows: number; skipped: number; sample: Array<Record<string, string | null>> };
const PREVIEW_COLS: Array<[string, string]> = [['location', 'Vieta'], ['plate', 'Nr.'], ['makeModel', 'Auto'], ['customerName', 'Klients'], ['size1', 'Izmērs'], ['size2', '2.izm.'], ['brand', 'Ražotājs'], ['quantity', 'Sk.'], ['season', 'Sezona']];

/**
 * Admin Excel import: a dry run shows what the file holds without touching the
 * database; only the confirmation replaces the data.
 */
function ImportButton() {
  const ref = useRef<HTMLInputElement>(null);
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const [busy, setBusy] = useState('');
  const send = (file: File, dry: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<Preview & { imported?: number }>(`/api/import${dry ? '?dryRun=1' : ''}`, { method: 'POST', body: fd });
  };
  const run = async (file: File) => {
    let prev: Preview;
    try { setBusy('Analizē failu…'); prev = await send(file, true); }
    catch (e) { await dialogs.alert(`Neizdevās nolasīt failu: ${errMsg(e)}`); return; } finally { setBusy(''); }
    const ok = await dialogs.confirm({
      icon: 'warning', title: 'Apstiprināt importu?', wide: true, danger: true, confirmText: `Importēt (${prev.parsed})`,
      body: (
        <div style={{ fontSize: 13 }}>
          <div className="row" style={{ gap: 16, marginBottom: 10 }}><div><b style={{ fontSize: 18 }}>{prev.parsed}</b> ieraksti</div><div className="muted"><b>{prev.sheets}</b> sezonu lapas · {prev.rows} rindas · {prev.skipped} tukšas</div></div>
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table className="data" style={{ fontSize: 12 }}>
              <thead><tr>{PREVIEW_COLS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>{prev.sample.map((r, i) => <tr key={i}>{PREVIEW_COLS.map(([k]) => <td key={k}>{r[k] ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Rāda pirmos {prev.sample.length} ierakstus priekšskatam.</div>
          <div style={{ marginTop: 10, padding: '9px 11px', background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 8, fontWeight: 600 }}>
            ⚠ Šis aizvietos VISUS pašreizējos datus ar šī faila saturu.
            <div style={{ fontWeight: 400, marginTop: 4 }}>Ierakstu numuri tiek pārnumurēti, tāpēc tiks dzēsta arī <b>darbību vēsture, komentāri, bildes</b> un noliktavas uzdevumi, kas piesaistīti ierakstiem.</div>
          </div>
        </div>
      ),
    });
    if (!ok.ok) return;
    try {
      setBusy('Importē…');
      const out = await send(file, false);
      toast(`Importēts: ${out.imported ?? prev.parsed} ieraksti`);
      void refresh();
    } catch (e) { await dialogs.alert(`Imports neizdevās: ${errMsg(e)}`); } finally { setBusy(''); }
  };
  return (
    <>
      <button className="btn" style={{ height: 38 }} disabled={!!busy} title="Augšupielādēt jaunu Excel tabulu (aizvietos visus datus)" onClick={() => ref.current?.click()}>{busy || '⭱ Importēt Excel'}</button>
      <input ref={ref} type="file" hidden accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void run(f); }} />
    </>
  );
}
