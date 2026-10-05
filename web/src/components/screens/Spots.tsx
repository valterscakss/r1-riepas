'use client';

import { useState } from 'react';
import { del, enc, errMsg, patch, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useSession } from '@/client/session';
import { useToast } from '@/client/toast';
import { useRefresh, useStats } from '@/client/queries';
import { blank, type GridState } from '@/domain/gridEditor';
import type { ContainerView, SpotView } from '@/domain/spots';
import { ContainerEditor, type EditorResult } from '../spots/ContainerEditor';
import { SpotPanel } from '../spots/SpotPanel';
import { ExportButton } from '../ui/ExportButton';

function spotClass(s: SpotView): string {
  if (s.zone) return (s.count ?? 0) >= (s.cap ?? 0) ? 'taken' : 'zone';
  if (!s.occ) return 'free';
  return s.blocked ? 'blocked' : s.reserved ? 'reserved' : s.hasRims ? 'rims' : 'taken';
}

function SpotButton({ s, sel, onClick }: { s: SpotView; sel: boolean; onClick: () => void }) {
  if (s.zone) {
    return (
      <button className={`spot ${spotClass(s)}${sel ? ' sel' : ''}`} title={`Zona ${s.code} · ${s.count}/${s.cap}`} style={{ gridColumn: `span ${Math.max(1, s.hspan || 1)}` }} onClick={onClick}>
        <span className="code">{s.code}</span><span className="sub">{s.count}/{s.cap}</span>
      </button>
    );
  }
  const title = !s.occ ? 'Brīvs' : s.blocked ? 'Bloķēts' : `${s.plate} · ${s.cust || ''}${s.reserved ? ' · rezervēts' : ''}${s.hasRims ? ' · ar diskiem' : ''}`;
  return (
    <button className={`spot ${spotClass(s)}${sel ? ' sel' : ''}`} title={title} onClick={onClick}>
      {s.hasRims && !s.blocked && <span title="Ar diskiem" style={{ position: 'absolute', top: 3, right: 4, fontSize: 9, lineHeight: 1, color: 'oklch(0.55 0.16 285)' }}>◉</span>}
      <span className="code">{s.code}</span>
      <span className="sub">{s.occ ? (s.blocked ? 'bloķēts' : s.plate || '') : 'brīvs'}</span>
    </button>
  );
}

/** A zone button spans its horizontal run; fill cells below/around it render as tinted continuations. */
function Cells({ c, sel, onPick }: { c: ContainerView; sel: string | null; onPick: (s: SpotView) => void }) {
  const out: React.ReactNode[] = [];
  let skip = 0;
  c.cells.forEach((cell, i) => {
    if (skip > 0) { skip--; return; }
    if (!cell) { out.push(<div key={i} />); return; }
    if ('zoneFill' in cell) { out.push(<div key={i} className="spot-fill" title="Zonas turpinājums" />); return; }
    const s = cell as SpotView;
    if (s.zone) skip = Math.max(0, (s.hspan || 1) - 1);
    out.push(<SpotButton key={i} s={s} sel={sel === s.code} onClick={() => onPick(s)} />);
  });
  return <>{out}</>;
}

/** Seed the editor from a container: each cell with the code it carries today and whether it holds tires. */
function editorState(c: ContainerView): GridState {
  const rows = c.rows || Math.ceil((c.total || 1) / (c.cols || 4)), cols = c.cols || 4;
  const s = blank(rows, cols);
  const cells = c.drawn ? s.cells.map((_, i) => c.drawn![i] !== '0') : s.cells;
  const at = (i: number) => { const x = c.cells[i]; return x && !('zoneFill' in x) && !(x as SpotView).zone ? x as SpotView : null; };
  return { ...s, cells, codes: cells.map((_, i) => at(i)?.code ?? null), occ: cells.map((_, i) => !!at(i)?.occ), zones: c.zones.map((z) => ({ ...z, cells: [...z.cells] })) };
}

export function SpotsScreen() {
  const { isAdmin } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const stats = useStats();
  const [sel, setSel] = useState<SpotView | null>(null);
  const st = stats.data;
  const containers = st?.containers ?? [];
  const drawnOthers = (letter?: string) => containers.filter((x) => x.defId && x.letter !== letter && x.rows);

  const add = async () => {
    const r = await dialogs.open<EditorResult>((done) => <ContainerEditor title="Pievienot konteineru" initial={blank(4, 20)} others={drawnOthers()}
      save={async (x) => { await post('/api/containers', x); }} done={done} />);
    if (!r) return;
    toast(`Konteiners ${r.prefix} izveidots`);
    void refresh();
  };
  const edit = async (c: ContainerView) => {
    const r = await dialogs.open<EditorResult>((done) => <ContainerEditor title="Rediģēt konteineru" initial={editorState(c)} prefix={c.letter} label={c.label} others={drawnOthers(c.letter)}
      save={async (x) => { await patch(`/api/containers/${enc(c.defId!)}`, { rows: x.rows, cols: x.cols, cells: x.cells, names: x.names, zones: x.zones, label: x.label }); }} done={done} />);
    if (!r) return;
    toast(`Konteiners ${c.letter} atjaunināts`);
    void refresh();
  };
  const renumber = async (c: ContainerView) => {
    const r = await dialogs.confirm({
      title: 'Pārnumurēt vietas?', confirmText: 'Pārnumurēt',
      body: <>Konteinera <b className="mono">{c.letter}</b> vietas tiks pārnumurētas secīgi (<span className="mono">{c.letter}1, {c.letter}2, …</span>) pa rindām, aizpildot caurumus numerācijā.<br /><br />Ieraksti pārvietojas līdzi savai vietai — riepas fiziski paliek turpat, mainās tikai vietas numurs. Pielāgotie nosaukumi tiks aizstāti ar numuriem.</>,
    });
    if (!r.ok) return;
    try { const d = await post<{ changed: number }>(`/api/containers/${enc(c.defId!)}/renumber`); toast(d.changed ? `Pārnumurētas ${d.changed} vietas` : 'Numerācija jau bija secīga'); void refresh(); }
    catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās pārnumurēt')); }
  };
  const remove = async (c: ContainerView) => {
    const r = await dialogs.confirm({ icon: 'warning', title: 'Dzēst konteineru?', confirmText: 'Dzēst', danger: true, body: <>Konteiners <b className="mono">{c.letter}</b> tiks izņemts. Ieraksti, kas jau atrodas šajās vietās, <b>netiks dzēsti</b> — tikai tukšās vietas vairs nerādīsies.</> });
    if (!r.ok) return;
    try { await del(`/api/containers/${enc(c.defId!)}`); toast('Konteiners dzēsts'); void refresh(); }
    catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās dzēst')); }
  };

  const tool = (label: string, title: string, onClick: () => void) => <button className="btn xs" style={{ width: 24, padding: 0 }} title={title} aria-label={title} onClick={onClick}>{label}</button>;
  return (
    <div className="page w-1240">
      <div className="page-head">
        <div><h1>Novietnes</h1><div className="sub">{st ? `${st.occ} / ${st.total} aizņemtas · ${st.capPct}% noslodze` : 'Ielādē…'}</div></div>
        <div className="row"><ExportButton what="spots" />{isAdmin && <button className="btn primary" onClick={add}>＋ Pievienot konteineru</button>}</div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--ok-soft)', borderColor: 'var(--ok-line)' }} />Brīvs</span>
        <span><i style={{ background: 'var(--surface-2)', borderColor: 'var(--border-2)' }} />Aizņemta</span>
        <span><i style={{ background: 'var(--violet-soft)', borderColor: 'var(--violet-line)' }} />Ar diskiem</span>
        <span><i style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-line)' }} />Rezervēts</span>
        <span><i style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-line)' }} />Bloķēts</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--gap)' }}>
        {containers.map((c) => (
          <div key={c.letter} className="card pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <h2 className="ellipsis">Konteiners {c.letter}{c.label && <> · <span className="muted" style={{ fontWeight: 400 }}>{c.label}</span></>}</h2>
              <span className="row" style={{ gap: 8, flex: 'none' }}>
                <span className="mono muted" style={{ fontSize: 12 }}>{c.occ}/{c.total}</span>
                {isAdmin && c.defId && <>{tool('✎', 'Rediģēt formu', () => edit(c))}{tool('№', 'Pārnumurēt vietas secīgi', () => renumber(c))}{tool('✕', 'Dzēst konteineru', () => remove(c))}</>}
              </span>
            </div>
            <div className="spot-grid" style={{ gridTemplateColumns: `repeat(${c.cols || 4}, 1fr)` }}><Cells c={c} sel={sel?.code ?? null} onPick={setSel} /></div>
          </div>
        ))}
      </div>
      {sel && <SpotPanel s={sel} onClose={() => setSel(null)} />}
    </div>
  );
}
