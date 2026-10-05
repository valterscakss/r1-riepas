'use client';

import { useState } from 'react';
import { Modal } from '@/client/dialogs';

export interface SeasonPreview {
  name: string; rows: number; places: number; active: number; free: number; held: number; released: number;
  racks: { deleted: string[]; trimmed: Array<{ prefix: string; off: number; left: number }>; kept: number; protected: number };
}
export interface ImportPreview {
  parsed: number; sheets: number; rows: number; skipped: number;
  sample: Array<Record<string, string | null>>;
  seasons: SeasonPreview[];
  placeSeason: string | null;
}

const PREVIEW_COLS: Array<[string, string]> = [['location', 'Vieta'], ['plate', 'Nr.'], ['makeModel', 'Auto'], ['customerName', 'Klients'], ['size1', 'Izmērs'], ['size2', '2.izm.'], ['brand', 'Ražotājs'], ['quantity', 'Sk.'], ['season', 'Sezona']];

/** The remembered choice if the file still has that sheet; else the newest year (the later sheet wins a tie). */
export function defaultSeason(p: ImportPreview): string {
  if (p.placeSeason && p.seasons.some((s) => s.name === p.placeSeason)) return p.placeSeason;
  let best = '', bestYear = -1;
  for (const s of p.seasons) {
    const y = Number(s.name.match(/\d{4}/)?.[0] ?? 0);
    if (y >= bestYear) { best = s.name; bestYear = y; }
  }
  return best;
}

const effect = (s: SeasonPreview) => {
  const bits: string[] = [];
  if (s.racks.deleted.length) bits.push(`dzēsīs konteinerus: ${s.racks.deleted.join(', ')}`);
  if (s.racks.trimmed.length) bits.push(`izslēgs vietas: ${s.racks.trimmed.map((t) => `${t.prefix} (−${t.off})`).join(', ')}`);
  if (s.racks.protected) bits.push(`${s.racks.protected} vietas ar riepām netiks aiztiktas`);
  return bits.length ? bits.join(' · ') : 'zīmētie konteineri nemainās';
};

/**
 * Confirm an Excel import. Every sheet is imported; the chosen one decides which
 * places exist (the sheet that describes the warehouse as it stands today).
 */
export function ImportDialog({ prev, branchName, done }: { prev: ImportPreview; branchName: string | null; done: (v: { season: string } | undefined) => void }) {
  const [season, setSeason] = useState(() => defaultSeason(prev));
  const cancel = () => done(undefined);
  return (
    <Modal onClose={cancel} className="wide">
      <div className="modal-head"><h2>Apstiprināt importu?</h2><button type="button" className="btn icon" aria-label="Aizvērt" onClick={cancel}>✕</button></div>
      <div className="modal-body" style={{ fontSize: 13 }}>
        <div className="row" style={{ gap: 16, marginBottom: 10 }}><div><b style={{ fontSize: 18 }}>{prev.parsed}</b> ieraksti</div><div className="muted"><b>{prev.sheets}</b> sezonu lapas · {prev.rows} rindas · {prev.skipped} tukšas</div></div>
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="data" style={{ fontSize: 12 }}>
            <thead><tr>{PREVIEW_COLS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>{prev.sample.map((r, i) => <tr key={i}>{PREVIEW_COLS.map(([k]) => <td key={k}>{r[k] ?? ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Rāda pirmos {prev.sample.length} ierakstus priekšskatam.</div>

        <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>Kura lapa apraksta noliktavu šobrīd?</legend>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Visas lapas tiek importētas (auto vēsture saglabājas), bet vietu karti nosaka tikai izvēlētā lapa — parasti jaunākā, kur BRĪVS apzīmē tukšu vietu.</div>
          {prev.seasons.map((s) => (
            <label key={s.name} className="tile" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px', marginBottom: 6, cursor: 'pointer', border: season === s.name ? '1px solid var(--accent)' : undefined }}>
              <input type="radio" name="placeSeason" checked={season === s.name} onChange={() => setSeason(s.name)} style={{ marginTop: 3 }} />
              <span style={{ flex: 1 }}>
                <b>{s.name}</b> <span className="muted">· {s.places} vietas · {s.active} ar riepām · {s.free} brīvas · {s.held} aizņemtas</span>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>{effect(s)}</span>
              </span>
            </label>
          ))}
          <label className="tile" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 11px', cursor: 'pointer', border: season === '' ? '1px solid var(--accent)' : undefined }}>
            <input type="radio" name="placeSeason" checked={season === ''} onChange={() => setSeason('')} />
            <span><b>Neizvēlēties</b> <span className="muted">· vietas rodas no visām lapām, konteineri nemainās</span></span>
          </label>
        </fieldset>

        <div style={{ marginTop: 12, padding: '9px 11px', background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 8, fontWeight: 600 }}>
          ⚠ Šis aizvietos {branchName ? <>filiāles <b>{branchName}</b></> : 'šīs filiāles'} datus ar šī faila saturu.
          <div style={{ fontWeight: 400, marginTop: 4 }}>Ierakstu numuri tiek pārnumurēti, tāpēc tiks dzēsta arī <b>darbību vēsture, komentāri, bildes</b> un noliktavas uzdevumi, kas piesaistīti šīs filiāles ierakstiem. Citas filiāles dati netiek skarti.</div>
        </div>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn lg" onClick={cancel}>Atcelt</button>
        <button type="button" className="btn lg danger" onClick={() => done({ season })}>Importēt ({prev.parsed})</button>
      </div>
    </Modal>
  );
}
