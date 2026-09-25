'use client';

import { Modal } from '@/client/dialogs';
import type { StatsView } from '@/domain/spots';

/** Choose a free place by hand, or go back to automatic assignment (null). */
export function SpotPicker({ stats, current, done }: { stats: StatsView | undefined; current: string | null; done: (v: { spot: string | null } | undefined) => void }) {
  const groups = (stats?.containers ?? []).map((c) => ({ c, free: c.spots.filter((s) => !s.occ) })).filter((g) => g.free.length);
  return (
    <Modal onClose={() => done(undefined)} className="wide">
      <div className="modal-head">
        <div><h2>Izvēlies vietu</h2><div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Klikšķini uz brīvas vietas, lai to piešķirtu</div></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => done({ spot: null })}>Automātiski</button>
          <button className="btn icon" aria-label="Aizvērt" onClick={() => done(undefined)}>✕</button>
        </div>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {!groups.length && <div className="muted" style={{ fontSize: 14 }}>Nav brīvu vietu.</div>}
        {groups.map(({ c, free }) => (
          <div key={c.letter}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Konteiners {c.letter} <span className="muted" style={{ fontWeight: 400 }}>· {free.length} brīvs</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(62px, 1fr))', gap: 6 }}>
              {free.map((s) => (
                <button key={s.code} className={`spot free${current === s.code ? ' sel' : ''}`} style={{ height: 40 }} onClick={() => done({ spot: s.code })}>
                  <span className="code" style={{ fontSize: 12 }}>{s.code}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
