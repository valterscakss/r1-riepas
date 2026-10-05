'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, enc, errMsg, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useSession } from '@/client/session';
import { useToast } from '@/client/toast';
import { useRefresh } from '@/client/queries';
import type { SpotView } from '@/domain/spots';
import type { HistItem } from '@/domain/records';
import { intakeHref, useRecordActions } from '../records/actions';
import { useOpenRecord } from '../records/RecordProvider';

const Label = ({ children }: { children: React.ReactNode }) => <div className="label" style={{ marginBottom: 4 }}>{children}</div>;

/** One place: who is in it and its past seasons, or what can be done with it when free. */
export function SpotPanel({ s, onClose }: { s: SpotView; onClose: () => void }) {
  const { can, isAdmin } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const router = useRouter();
  const openRecord = useOpenRecord();
  const act = useRecordActions();
  const op = can('act.operate'); // without it the panel is a read-only look at the place
  const vehicle = useQuery({
    queryKey: ['vehicle', s.plate], enabled: !!(s.occ && s.plate && !s.zone),
    queryFn: () => api<{ history: HistItem[] }>(`/api/vehicle?plate=${enc(s.plate!)}`),
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const ref = { id: s.id ?? '', plate: s.plate, loc: s.code };
  const after = (p: Promise<boolean>) => p.then((ok) => { if (ok) onClose(); });
  const assign = () => router.push(intakeHref({ spot: s.code }));
  const block = async () => {
    const r = await dialogs.confirm({ title: 'Bloķēt vietu?', confirmText: 'Bloķēt', body: <>Vieta <b className="mono">{s.code}</b> tiks atzīmēta kā aizņemta (bez riepām) un netiks piešķirta jaunām pieņemšanām.</> });
    if (!r.ok) return;
    try { await post(`/api/spots/${enc(s.code)}/block`); toast(`Vieta ${s.code} bloķēta`); void refresh(); onClose(); }
    catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās bloķēt')); }
  };
  const rename = async () => {
    const r = await dialogs.confirm({
      title: 'Pārdēvēt vietu', icon: 'info', confirmText: 'Pārdēvēt', input: { initial: s.code },
      body: <div style={{ textAlign: 'left', fontSize: 13 }}>Jaunais nosaukums vietai <b className="mono">{s.code}</b> — līdz 10 burtiem/cipariem, piem. <b className="mono">B7</b> vai <b className="mono">PLAUKTS-1</b>.<br /><span className="muted" style={{ fontSize: 12 }}>Visi ieraksti šajā vietā pāries uz jauno nosaukumu.</span></div>,
    });
    if (!r.ok || !r.value.trim()) return;
    try {
      const d = await post<{ name: string; changed: number }>(`/api/spots/${enc(s.code)}/rename`, { name: r.value });
      toast(`${s.code} → ${d.name}${d.changed ? ` · ${d.changed} ieraksti pārcelti` : ''}`);
      void refresh(); onClose();
    } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās pārdēvēt')); }
  };

  const status = s.blocked ? ['Bloķēts', 'danger'] : s.occ ? (s.reserved ? ['Rezervēts · gaida maiņu', 'warn'] : ['Aizņemta', 'plain']) : ['Brīvs', 'ok'];
  const history = vehicle.data?.history ?? [];
  return (
    <>
      <div className="panel-shade" onClick={onClose} />
      <aside className="panel" aria-label={`Vieta ${s.code}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 8 }}>
          <span className="row" style={{ gap: 8 }}>
            <span className="mono" style={{ fontWeight: 600, fontSize: 24 }}>{s.code}</span>
            {!s.zone && isAdmin && <button className="btn xs" title="Pārdēvēt vietu" onClick={rename}>✎ Pārdēvēt</button>}
          </span>
          <button className="btn icon" aria-label="Aizvērt" onClick={onClose}>✕</button>
        </div>

        {s.zone ? (
          <>
            <span className="badge violet" style={{ fontSize: 11, letterSpacing: '.05em', padding: '4px 10px' }}>Zona · {s.count}/{s.cap} aizņemts</span>
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="bar" style={{ height: 9 }}><div style={{ width: `${Math.min(100, Math.round(((s.count ?? 0) / (s.cap || 1)) * 100))}%`, background: 'oklch(0.6 0.13 285)' }} /></div>
              {s.recs?.length ? (
                <div><Label>Šeit glabājas</Label>
                  {s.recs.map((r) => (
                    <div key={r.id} className="hoverrow clickable" onClick={() => openRecord(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 4px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{r.plate || '—'}</span>
                      <span className="muted ellipsis">{[r.cust, r.brand, r.size].filter(Boolean).join(' · ') || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="muted" style={{ fontSize: 13 }}>Zona ir tukša.</div>}
              {(s.count ?? 0) < (s.cap ?? 0)
                ? op && <button className="btn lg primary" onClick={assign}>Piešķirt šo zonu ({(s.cap ?? 0) - (s.count ?? 0)} brīvas)</button>
                : <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Zona ir pilna.</div>}
            </div>
          </>
        ) : (
          <>
            <span className={`badge ${status[1]}`} style={{ fontSize: 11, letterSpacing: '.05em', padding: '4px 10px' }}>{status[0]}</span>
            {s.blocked ? (
              <div style={{ marginTop: 22 }}>
                <p className="muted-2" style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 18px' }}>Šī vieta ir manuāli bloķēta un nav pieejama pieņemšanai.</p>
                {op && <button className="btn lg primary block" onClick={() => after(act.unblock(s.id!))}>Atbloķēt vietu</button>}
              </div>
            ) : s.occ ? (
              <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div><Label>Klients</Label><div style={{ fontWeight: 600, fontSize: 16 }}>{s.cust || '—'}</div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div><Label>Numurs</Label><div className="mono" style={{ fontWeight: 600 }}>{s.plate || '—'}</div></div>
                  <div><Label>Izmērs</Label><div className="mono">{s.size || '—'}</div></div>
                  <div><Label>Ražotājs</Label><div style={{ fontWeight: 500 }}>{s.brand || '—'}</div></div>
                  <div><Label>SMS kods</Label><div className="mono" style={{ fontWeight: 600 }}>{s.sms || '—'}</div></div>
                </div>
                {op && (s.reserved ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <button className="btn lg primary" onClick={() => { onClose(); act.swap(ref); }}>Pieņemt jaunās riepas</button>
                    <button className="btn lg danger-text" onClick={() => after(act.terminate(ref))}>Slēgt (bez jaunām)</button>
                    <button className="btn ghost" onClick={() => after(act.unprepare(s.id!))}>Novietot atpakaļ vietā</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <button className="btn lg primary" onClick={() => after(act.release(ref, { reintake: true }))}>Izsniegt riepas</button>
                    <button className="btn lg" onClick={() => after(act.prepare(ref))}>Sagatavot (mainīs riepas)</button>
                  </div>
                ))}
                {vehicle.isLoading && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Ielādē vēsturi…</div>}
                {!!history.length && (
                  <div style={{ marginTop: 10 }}>
                    <div className="label" style={{ marginBottom: 6 }}>Vēsture · {history.length} {history.length === 1 ? 'ieraksts' : 'ieraksti'}</div>
                    <div style={{ maxHeight: '38vh', overflow: 'auto' }}>
                      {history.map((x) => (
                        <div key={x.id} className="clickable" title="Atvērt ierakstu" onClick={() => openRecord(x.id)} style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{x.season || '—'}</span>
                            <span className={`badge sm ${x.status === 'active' ? 'ok' : 'plain'}`}>{x.status === 'active' ? 'Glabājas' : 'Izsniegts'}</span>
                          </div>
                          <div className="muted-2" style={{ fontSize: 12, marginTop: 4 }}>{x.tires || '—'}{x.tires2 && <span className="muted" style={{ display: 'block' }}>+ {x.tires2}</span>}</div>
                          <div className="mono muted row" style={{ gap: 12, fontSize: 11, marginTop: 4 }}><span>Vieta {x.loc || '—'}</span><span>{x.thread}</span><span>{x.fee}</span></div>
                          {(x.intakeDate || x.releaseDate) && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{x.intakeDate ? `Pieņemts ${x.intakeDate}` : ''}{x.releaseDate ? ` · Izsniegts ${x.releaseDate}` : ''}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 22 }}>
                <p className="muted-2" style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 18px' }}>Šī vieta ir brīva un gatava jaunai pieņemšanai.</p>
                {op && <>
                  <button className="btn lg primary block" onClick={assign}>Piešķirt šo vietu</button>
                  <button className="btn lg block" style={{ marginTop: 8 }} title="Rezervēt vietu bez riepām" onClick={block}>Bloķēt vietu</button>
                </>}
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
