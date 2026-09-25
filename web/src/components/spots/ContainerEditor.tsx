'use client';

import { useEffect, useRef, useState } from 'react';
import {
  adoptShape, allCells, applySize, assignCodes, cellString, drawnCount, moveRow, namesOf, noCells, pack, paintCell, shift, total,
  ZONE_NAME_RE, zoneOf, type GridState,
} from '@/domain/gridEditor';
import type { ContainerView } from '@/domain/spots';
import { FormDialog } from '../ui/FormDialog';

const ZONE_HUES = [285, 200, 60, 330, 155, 25];
export interface EditorResult { prefix: string; rows: number; cols: number; cells: string; names: string; zones: string; label: string | null }

/**
 * Draw a rack: set the size, then click or drag over cells to switch places on
 * and off, slide the drawing, move whole rows, merge cells into zones. Numbers
 * travel with their cells; places holding tires can't be switched off.
 */
export function ContainerEditor({ title, initial, prefix: fixedPrefix, label: initialLabel, others, save, done }: {
  title: string; initial: GridState; prefix?: string; label?: string | null; others: ContainerView[];
  /** Persists the drawing; a thrown error keeps the editor open with the message. */
  save: (r: EditorResult) => Promise<void>;
  done: (v: EditorResult | undefined) => void;
}) {
  const [g, setG] = useState(initial);
  const [rowsIn, setRowsIn] = useState(String(initial.rows));
  const [colsIn, setColsIn] = useState(String(initial.cols));
  const [prefix, setPrefix] = useState(fixedPrefix ?? '');
  const [label, setLabel] = useState(initialLabel ?? '');
  const [zoneSel, setZoneSel] = useState(-1);
  const [zoneName, setZoneName] = useState('');
  const [zoneCap, setZoneCap] = useState('6');
  const [copyFrom, setCopyFrom] = useState(others[0]?.letter ?? '');
  const [msg, setMsg] = useState('');
  const paint = useRef<boolean | null>(null);

  useEffect(() => {
    const stop = () => { paint.current = null; };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const pre = (fixedPrefix ?? prefix).trim().toUpperCase().replace(/\s+/g, '');
  const codes = assignCodes(g, pre);
  const commit = (s: GridState) => { setG(s); setRowsIn(String(s.rows)); setColsIn(String(s.cols)); setMsg(''); };
  const resize = (which: 'rows' | 'cols', r: string, c: string) => {
    if (which === 'rows') setRowsIn(r); else setColsIn(c);
    if (!r || !c) return;
    const res = applySize(g, Number(r), Number(c), which);
    if ('error' in res) setMsg(res.error); else commit(res.state);
  };
  const act = (i: number) => {
    if (zoneSel >= 0) { setG((s) => paintCell(s, i, true, zoneSel)); return; }
    setG((s) => paintCell(s, i, paint.current ?? !s.cells[i], -1));
  };
  const addZone = () => {
    const name = zoneName.trim().toUpperCase().replace(/\s+/g, '');
    const cap = parseInt(zoneCap, 10);
    if (!ZONE_NAME_RE.test(name)) { setMsg('Zonas nosaukums: 1–8 burti/cipari'); return; }
    if (g.zones.some((z) => z.name === name)) { setMsg('Šāda zona jau ir'); return; }
    if (!(cap >= 1 && cap <= 99)) { setMsg('Maks. komplekti: 1–99'); return; }
    setG((s) => ({ ...s, zones: [...s.zones, { name, cap, cells: [] }] }));
    setZoneSel(g.zones.length); setZoneName(''); setMsg('');
  };
  const copy = () => {
    const src = others.find((x) => x.letter === copyFrom);
    if (!src) return;
    const r = adoptShape(g, { rows: src.rows, cols: src.cols, drawn: src.drawn });
    if (typeof r !== 'string') { commit(r); return; }
    if (r.startsWith('room:')) { const [n, m] = r.slice(5).split('/'); setMsg(`${copyFrom} formā ir ${m} rūtiņas, bet šeit ir ${n} vietas — tad kāda no tām pazustu`); }
    else setMsg(r === 'big' ? 'Pārāk liels konteiners (maks. 600 rūtiņas)' : 'Neizdevās pārņemt formu');
  };

  const zc = g.zones.reduce((a, z) => a + z.cells.length, 0);
  const held = g.cells.reduce((a, on, i) => a + (on && g.occ[i] ? 1 : 0), 0);
  const small = (btn: string, onClick: () => void, t: string, extra?: React.CSSProperties) =>
    <button type="button" title={t} className="btn xs" style={{ minWidth: 26, padding: '0 7px', ...extra }} onClick={onClick}>{btn}</button>;

  return (
    <FormDialog title={title} size="wide" submitText={fixedPrefix ? 'Saglabāt' : 'Izveidot'} onCancel={() => done(undefined)} onSubmit={async () => {
      if (!fixedPrefix && !/^[A-ZĀČĒĢĪĶĻŅŠŪŽ]{1,4}$/.test(pre)) return 'Prefikss: 1–4 burti (piem. D)';
      if (!drawnCount(g)) return 'Jāatzīmē vismaz viena vieta';
      const r = { prefix: pre, rows: g.rows, cols: g.cols, cells: cellString(g), names: JSON.stringify(namesOf(g, pre)),
        zones: JSON.stringify(g.zones.filter((z) => z.cells.length)), label: label.trim() || null };
      await save(r);
      done(r);
    }}>
      {fixedPrefix === undefined
        ? <div className="field"><label htmlFor="cg-prefix">Prefikss (burts)</label><input id="cg-prefix" className="mono" placeholder="D" maxLength={4} style={{ textTransform: 'uppercase' }} value={prefix} onChange={(e) => setPrefix(e.target.value)} /></div>
        : <div className="muted-2" style={{ fontSize: 13 }}>Konteiners <b className="mono">{fixedPrefix}</b></div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="cg-rows">Rindas</label><input id="cg-rows" className="mono" type="number" min={1} max={99} value={rowsIn} onChange={(e) => resize('rows', e.target.value, colsIn)} /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="cg-cols">Kolonnas</label><input id="cg-cols" className="mono" type="number" min={1} max={99} value={colsIn} onChange={(e) => resize('cols', rowsIn, e.target.value)} /></div>
      </div>
      {!!others.length && (
        <div className="field">
          <label htmlFor="cg-copy">Tāda pati forma kā citam konteineram</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select id="cg-copy" className="mono" style={{ height: 38 }} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              {others.map((x) => <option key={x.letter} value={x.letter}>{x.letter}{x.label ? ` · ${x.label}` : ''} ({x.rows}×{x.cols})</option>)}
            </select>
            <button type="button" className="btn" style={{ height: 38 }} onClick={copy}>Pārņemt formu</button>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Pārņem izmēru un zīmējumu. Šī konteinera numuri paliek savās rūtiņās — mainās tikai forma.</div>
        </div>
      )}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
          <span className="label">Uzzīmē formu</span>
          <span className="row" style={{ gap: 6 }}>
            <span className="row" style={{ gap: 2, marginRight: 4 }}>
              {([['↑', -1, 0, 'Pārvietot augšup'], ['←', 0, -1, 'Pārvietot pa kreisi'], ['→', 0, 1, 'Pārvietot pa labi'], ['↓', 1, 0, 'Pārvietot lejup']] as const).map(([gl, dr, dc, t]) =>
                <span key={gl}>{small(gl, () => { const r = shift(g, dr, dc); if (r) commit(r); else setMsg('Forma atduras pret malu — vispirms pievieno rindu vai kolonnu'); }, t)}</span>)}
            </span>
            {small('Pārkārtot', () => commit(pack(g)), 'Sakārtot vietas pēc kārtas, bez caurumiem')}
            {small('Visas', () => commit(allCells(g)), 'Ieslēgt visas rūtiņas')}
            {small('Neviena', () => commit(noCells(g)), 'Izslēgt visas brīvās rūtiņas')}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Klikšķini vai velc pāri rūtiņām, lai ieslēgtu/izslēgtu vietas; ar bultiņām pārbīdi visu formu, bet ar ↑↓ pie rindas malas pārvieto veselu rindu. <b>Numuri ceļo līdzi savai rūtiņai un neviena vieta nepazūd</b>. Pelēkās rūtiņas ir aizņemtas — tās nevar izslēgt.</div>
        <div style={{ display: 'grid', gap: 3, gridTemplateColumns: `36px repeat(${g.cols}, minmax(0, 44px))`, justifyContent: 'start', maxHeight: 290, overflow: 'auto', padding: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, touchAction: 'none', userSelect: 'none' }}>
          {Array.from({ length: g.rows }, (_, r) => [
            <div key={`h${r}`} title={`Rinda ${r + 1}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              {([['↑', -1, r === 0], ['↓', 1, r === g.rows - 1]] as const).map(([gl, dir, off]) => (
                <button key={gl} type="button" disabled={off} title={dir < 0 ? 'Pārvietot rindu augšup' : 'Pārvietot rindu lejup'}
                  style={{ width: 15, height: 15, padding: 0, fontSize: 9, lineHeight: 1, borderRadius: 4, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--ink-3)', opacity: off ? 0.3 : 1 }}
                  onClick={() => { const res = moveRow(g, r, dir); if (typeof res !== 'string') commit(res); else if (res.startsWith('zone:')) setMsg(`Zona ${res.slice(5)} stiepjas pāri vairākām rindām — vispirms noņem to`); }}>{gl}</button>
              ))}
            </div>,
            ...Array.from({ length: g.cols }, (_, c) => {
              const i = r * g.cols + c;
              const on = g.cells[i];
              const zi = zoneOf(g, i);
              const code = codes[i] || '';
              const short = pre && code.startsWith(pre) && /^\d+$/.test(code.slice(pre.length)) ? code.slice(pre.length) : code;
              const h = ZONE_HUES[zi % ZONE_HUES.length];
              const style: React.CSSProperties = !on ? { background: 'transparent', border: '1px dashed var(--border-2)', color: 'transparent' }
                : zi >= 0 ? { background: `oklch(0.93 0.05 ${h})`, border: `1px solid oklch(0.7 0.12 ${h})`, color: `oklch(0.42 0.14 ${h})`, fontWeight: 700 }
                : g.occ[i] ? { background: 'var(--surface-2)', border: '1px solid var(--ink-3)', color: 'var(--ink-2)', fontWeight: 700 }
                : { background: 'var(--ok-soft)', border: '1px solid var(--ok-line)', color: 'var(--ok)' };
              return (
                <button key={i} type="button" title={!on ? 'Tukšums' : zi >= 0 ? `Zona ${g.zones[zi].name}` : `${code}${g.occ[i] ? ' · aizņemta' : ''}`}
                  style={{ aspectRatio: '1', minWidth: 0, borderRadius: 4, fontSize: g.cols > 26 ? 8 : 10, lineHeight: 1, padding: 0, overflow: 'hidden', ...style }}
                  onPointerDown={(e) => { e.preventDefault(); if (zoneSel < 0) paint.current = !g.cells[i]; act(i); }}
                  onPointerEnter={() => { if (paint.current !== null && zoneSel < 0) act(i); }}>
                  {!on ? '' : zi >= 0 ? g.zones[zi].name[0] : short}
                </button>
              );
            }),
          ])}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 7 }}>{drawnCount(g) - zc} vietas + {g.zones.length} zonas ({zc} rūtiņas) no {total(g)} rūtiņām{held ? ` · ${held} aizņemtas` : ''}</div>
      </div>
      <div>
        <span className="label" style={{ display: 'block', marginBottom: 6 }}>Zonas — lielākas vietas</span>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Zona apvieno vairākas rūtiņas vienā vietā ar savu nosaukumu un maksimālo komplektu skaitu. Pievieno zonu, tad klikšķini uz rūtiņām, lai to iezīmētu; vēlreiz klikšķis uz zonas beidz iezīmēšanu.</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input className="input mono sm" placeholder="GRĪDA1" maxLength={8} style={{ flex: 1.4, textTransform: 'uppercase' }} aria-label="Zonas nosaukums" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
          <input className="input mono sm" type="number" min={1} max={99} title="Maks. komplekti" aria-label="Maks. komplekti" style={{ flex: 0.7 }} value={zoneCap} onChange={(e) => setZoneCap(e.target.value)} />
          <button type="button" className="btn" style={{ height: 38 }} onClick={addZone}>＋ Zona</button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {!g.zones.length && <span className="muted" style={{ fontSize: 12 }}>Nav zonu.</span>}
          {g.zones.map((z, i) => {
            const h = ZONE_HUES[i % ZONE_HUES.length];
            return (
              <span key={z.name} className="clickable" onClick={() => setZoneSel(zoneSel === i ? -1 : i)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: `oklch(0.93 0.05 ${h})`, color: `oklch(0.42 0.14 ${h})`, border: `2px solid ${zoneSel === i ? `oklch(0.55 0.15 ${h})` : 'transparent'}` }}>
                {z.name} · {z.cells.length} rūt. · maks. {z.cap}
                <button type="button" title="Dzēst zonu" style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0 }}
                  onClick={(e) => { e.stopPropagation(); setG((s) => ({ ...s, zones: s.zones.filter((_, k) => k !== i) })); setZoneSel(-1); }}>✕</button>
              </span>
            );
          })}
        </div>
      </div>
      <div className="field"><label htmlFor="cg-label">Nosaukums (neobligāts)</label><input id="cg-label" placeholder="piem. Ziemas plaukts" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      {msg && <div className="dialog-error" role="alert">{msg}</div>}
    </FormDialog>
  );
}
