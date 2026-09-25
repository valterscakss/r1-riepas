'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, enc, errMsg, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useSession } from '@/client/session';
import { usePricing, useRefresh, useStats } from '@/client/queries';
import { useDebounced } from '@/client/useDebounced';
import { firstScreen } from '@/client/nav';
import { formBrand } from '@/domain/brands';
import { eur, seasonOf } from '@/domain/format';
import { DEFAULT_PRICING, rimFromNote, rimMult, tierFor, widthOf, type RimKind } from '@/domain/pricing';
import { maskSize } from '@/domain/sizes';
import { normCode, type StorageRecord } from '@/domain/types';
import { BrandInput } from '../intake/BrandInput';
import { SpotPicker } from '../intake/SpotPicker';
import { SmsDone } from '../intake/SmsDone';
import { Suggest, suggestKeys } from '../intake/Suggest';

type Lookup = { found: boolean; history: number; suggestion: { customerName: string | null; isCompany: boolean; phone: string | null; size1: string | null; brand: string | null; quantity: string | null; size2: string | null; rimNote: string | null } | null };
type PlateHit = { plate: string; cust: string | null; active: boolean };
type CompanyHit = { name: string; phone: string | null; vehicles: number; count: number };

const EMPTY = { plate: '', looked: false, isNew: false, isCompany: false, cust: '', phone: '', t1size: '', t1brand: '', t1qty: '4', t2size: '', t2brand: '', rim: 'none' as RimKind, thread: '', history: 0 };
type Form = typeof EMPTY;
const QTYS = ['1', '2', '3', '4', '2+2'];

const Row = ({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) =>
  <div className="kv"><span>{label}</span><span id={id} style={{ fontWeight: 500, textAlign: 'right' }}>{children}</span></div>;

/**
 * Take a set in. Only the plate — and a name for a new customer — is required;
 * size and tread can come later. `plate`/`spot` prefill it; `swap` completes a
 * seasonal swap into the place the prepared set is holding.
 */
export function IntakeScreen({ initial }: { initial: { plate?: string; spot?: string; swap?: string } }) {
  const { can, perms, isAdmin } = useSession();
  const router = useRouter();
  const dialogs = useDialogs();
  const refresh = useRefresh();
  const stats = useStats();
  const pricing = usePricing(can('act.operate'));
  const [f, setF] = useState<Form>({ ...EMPTY, plate: initial.plate ?? '' });
  const [spot, setSpot] = useState<string | null>(initial.spot ?? null);
  const [swapId, setSwapId] = useState<string | null>(initial.swap ?? null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  // ---- plate: typeahead + lookup ----
  const [plateOpen, setPlateOpen] = useState(false);
  const [plateHi, setPlateHi] = useState(-1);
  const plateQ = useDebounced(normCode(f.plate), 140);
  const plates = useQuery({ queryKey: ['plate-suggest', plateQ], queryFn: () => api<{ suggestions: PlateHit[] }>(`/api/plate-suggest?q=${enc(plateQ)}`), enabled: plateOpen && plateQ.length >= 2 });
  const plateItems = plateOpen && plateQ.length >= 2 ? plates.data?.suggestions ?? [] : [];

  const lookup = async (raw = f.plate) => {
    const plate = normCode(raw);
    setPlateOpen(false);
    if (!plate) return;
    try {
      const d = await api<Lookup>(`/api/lookup?plate=${enc(plate)}`);
      const s = d.suggestion;
      setF((cur) => d.found && s ? {
        ...cur, plate, looked: true, isNew: false, isCompany: !!s.isCompany, cust: s.customerName ?? '', phone: s.phone ?? '', history: d.history,
        t1size: s.size1 || cur.t1size, t1brand: s.brand || cur.t1brand,
        t1qty: s.quantity === '2+2' ? '2+2' : /^\d$/.test(s.quantity ?? '') ? s.quantity! : cur.t1qty,
        t2size: s.size2 || '', rim: s.rimNote ? rimFromNote(s.rimNote) : cur.rim,
      } : { ...cur, plate, looked: true, isNew: true, isCompany: false, cust: '', phone: '', history: 0 });
    } catch {
      setF((cur) => ({ ...cur, plate, looked: true, isNew: true, cust: '', history: 0 }));
    }
  };
  // A plate handed over from elsewhere (swap, re-intake after release) is looked up at once.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !initial.plate) return;
    auto.current = true;
    void lookup(initial.plate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the prefilled plate
  }, []);

  // ---- company typeahead: pick an existing company instead of retyping it ----
  const [coOpen, setCoOpen] = useState(false);
  const [coHi, setCoHi] = useState(-1);
  const coQ = useDebounced(f.cust.trim(), 160);
  const companies = useQuery({ queryKey: ['company-suggest', coQ], queryFn: () => api<{ suggestions: CompanyHit[] }>(`/api/company-suggest?q=${enc(coQ)}`), enabled: coOpen && f.isCompany && coQ.length >= 2 });
  const coItems = coOpen && f.isCompany && coQ.length >= 2 ? companies.data?.suggestions ?? [] : [];
  const pickCompany = (i: number) => {
    const c = coItems[i];
    if (!c) return;
    setF((s) => ({ ...s, cust: c.name, phone: s.phone || c.phone || '' }));
    setCoOpen(false);
  };

  // ---- price, mirrored from the server's rules ----
  const cfg = pricing.data?.pricing ?? DEFAULT_PRICING;
  const w = Math.max(widthOf(f.t1size), f.t1qty === '2+2' ? widthOf(f.t2size) : 0);
  const tier = w ? tierFor(cfg, w) : null;
  const mult = rimMult(cfg, f.rim);
  const total = (tier?.price ?? 0) * mult;
  const b1 = formBrand(f.t1brand) || '—';
  const tiresLine = f.t1qty === '2+2'
    ? (f.t1size ? `2× ${b1} ${f.t1size}${f.t2size ? ` + 2× ${formBrand(f.t2brand) || b1} ${f.t2size}` : ''}` : '—')
    : (f.t1size ? `${f.t1qty}× ${b1} ${f.t1size}` : '—');
  const missing = [!f.looked && 'meklē numuru', f.looked && f.isNew && !f.cust.trim() && 'klienta vārds'].filter(Boolean) as string[];
  const place = spot ?? stats.data?.assignNext ?? '—';

  const reset = () => { setF(EMPTY); setSpot(null); setSwapId(null); router.replace('/jauna-glabasana'); };

  const confirm = async () => {
    if (missing.length || busy) return;
    const is22 = f.t1qty === '2+2';
    const fb1 = formBrand(f.t1brand), fb2 = formBrand(f.t2brand);
    setBusy(true);
    try {
      const rec = await post<StorageRecord>('/api/intake', {
        plate: f.plate, customerName: f.cust.trim() || null, isCompany: f.isCompany, phone: f.phone.trim() || null,
        size1: maskSize(f.t1size) || f.t1size || null,
        brand: is22 && fb2 && fb2 !== fb1 ? [fb1, fb2].filter(Boolean).join(' + ') : (fb1 || null),
        size2: is22 ? (maskSize(f.t2size) || f.t2size || null) : null,
        quantity: f.t1qty, rim: f.rim, threadDepth: f.thread, location: spot, releaseId: swapId,
      });
      void refresh();
      reset();
      setBusy(false);
      const r = await dialogs.open<'finish'>((done) => <SmsDone r={rec} done={done} />);
      if (r === 'finish') router.push(can('screen.home') ? '/sakums' : firstScreen(perms, isAdmin).href);
    } catch (e) {
      await dialogs.alert(errMsg(e, 'Neizdevās saglabāt'));
    } finally { setBusy(false); }
  };

  const pickSpot = async () => {
    const r = await dialogs.open<{ spot: string | null }>((done) => <SpotPicker stats={stats.data} current={spot} done={done} />);
    if (r) setSpot(r.spot);
  };

  const now = new Date();
  const season = seasonOf(now).replace('PAVASARIS', 'Pavasaris').replace('RUDENS', 'Rudens').split(' ').reverse().join(' ');
  return (
    <div className="page w-1180">
      <div className="page-head">
        <div>
          <h1>{swapId ? 'Sezonas maiņa' : 'Jauna glabāšana'}</h1>
          <div className="sub">{swapId ? <>Ievadi jaunās riepas — tās nonāks rezervētajā vietā <b className="mono">{spot || '—'}</b></> : `${season} · vieta tiek piešķirta automātiski`}</div>
        </div>
      </div>
      <div className="rrow" style={{ display: 'flex', gap: 'var(--gap)', alignItems: 'flex-start' }}>
        <div className="stack" style={{ flex: 1 }}>
          <div className="card pad">
            <div className="label" style={{ marginBottom: 6 }}>1 · Numura zīme</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                <input className="input big" style={{ fontSize: 22, letterSpacing: '0.06em' }} placeholder="AB1234" autoComplete="off" aria-label="Numura zīme" autoFocus={!initial.plate}
                  value={f.plate} onChange={(e) => { set('plate', e.target.value); setPlateOpen(true); setPlateHi(-1); }}
                  onBlur={() => setTimeout(() => setPlateOpen(false), 160)}
                  onKeyDown={(e) => {
                    if (suggestKeys(e, plateItems.length, plateHi, setPlateHi, (i) => { set('plate', plateItems[i].plate); void lookup(plateItems[i].plate); }, () => setPlateOpen(false))) return;
                    if (e.key === 'Enter') { e.preventDefault(); void lookup(); }
                  }} />
                <Suggest items={plateItems} hi={plateHi} onPick={(i) => { set('plate', plateItems[i].plate); void lookup(plateItems[i].plate); }}
                  render={(s) => <><span className="mono" style={{ fontWeight: 600, fontSize: 15 }}>{s.plate}</span><span className="muted ellipsis" style={{ fontSize: 12, maxWidth: '60%' }}>{s.cust || '—'}{s.active ? '' : ' · arhīvs'}</span></>} />
              </div>
              <button className="btn xl primary" onClick={() => lookup()}>⌕ Meklēt</button>
            </div>
            {f.looked && (f.isNew ? (
              <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: 'var(--warn-soft)', border: '1px solid var(--warn-line)' }}>
                <div className="row" style={{ marginBottom: 10 }}><span className="badge" style={{ background: 'var(--warn)', color: '#fff', fontSize: 10, letterSpacing: '.05em' }}>JAUNS</span><span style={{ fontWeight: 600 }}>Jauns klients — ievadi datus</span></div>
                <div className="field" style={{ marginBottom: 10 }}><label>Klienta veids</label>
                  <div className="seg" style={{ maxWidth: 320 }}>
                    <button className={!f.isCompany ? 'on' : ''} onClick={() => set('isCompany', false)}>Privātpersona</button>
                    <button className={f.isCompany ? 'on' : ''} onClick={() => set('isCompany', true)}>Uzņēmums</button>
                  </div>
                </div>
                <div className="rf2" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
                  <div className="field"><label htmlFor="in-cust">{f.isCompany ? 'Uzņēmuma nosaukums *' : 'Vārds, uzvārds *'}</label>
                    <div style={{ position: 'relative' }}>
                      <input id="in-cust" autoComplete="off" placeholder={f.isCompany ? 'SIA Serviss — sāc rakstīt' : 'Anna Ozola'} value={f.cust}
                        onChange={(e) => { set('cust', e.target.value); setCoOpen(true); setCoHi(-1); }} onBlur={() => setTimeout(() => setCoOpen(false), 160)}
                        onKeyDown={(e) => { suggestKeys(e, coItems.length, coHi, setCoHi, pickCompany, () => setCoOpen(false)); }} />
                      <Suggest items={coItems} hi={coHi} onPick={pickCompany}
                        render={(c) => <><span className="ellipsis" style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span><span className="muted nowrap" style={{ fontSize: 11 }}>{c.vehicles} auto · {c.count}×</span></>} />
                    </div>
                  </div>
                  <div className="field"><label htmlFor="in-phone">Telefons</label><input id="in-phone" className="mono" placeholder="29123456" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
                </div>
                {f.isCompany && <div className="muted" style={{ fontSize: 11, marginTop: 7 }}>Sāc rakstīt — ja uzņēmums jau ir sistēmā, izvēlies to no saraksta, lai visi auto paliek zem viena klienta.</div>}
              </div>
            ) : (
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 10, background: 'var(--ok-soft)', border: '1px solid var(--ok-line)' }}>
                <div className="row">
                  <span className="badge" style={{ background: 'var(--ok)', color: '#fff', fontSize: 10, letterSpacing: '.05em' }}>ATRASTS</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{f.cust || '—'}{f.isCompany && <span className="badge accent sm" style={{ marginLeft: 6, verticalAlign: 1 }}>UZŅĒMUMS</span>}</div>
                    <div className="mono muted" style={{ fontSize: 12 }}>{f.phone || '—'}</div>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>Iepriekšējie dati aizpildīti ✓ ({f.history} ieraksti)</span>
              </div>
            ))}
          </div>
          <div className="card pad">
            <div className="label" style={{ marginBottom: 14 }}>2 · Riepu dati</div>
            <div className="rf3" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.8fr', gap: 12, marginBottom: 14 }}>
              <div className="field"><label htmlFor="in-size">Izmērs (neobligāts)</label><input id="in-size" className="mono" inputMode="numeric" placeholder="235/50/19" value={f.t1size} onChange={(e) => set('t1size', maskSize(e.target.value))} /></div>
              <div className="field"><label htmlFor="in-brand">Ražotājs</label><BrandInput id="in-brand" placeholder="Michelin" value={f.t1brand} onChange={(v) => set('t1brand', v)} /></div>
              <div className="field"><label htmlFor="in-qty">Daudzums</label><select id="in-qty" value={f.t1qty} onChange={(e) => set('t1qty', e.target.value)}>{QTYS.map((q) => <option key={q} value={q}>{q}</option>)}</select></div>
            </div>
            {f.t1qty === '2+2' && (
              <div className="rf3" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.8fr', gap: 12, marginBottom: 14, padding: 12, background: 'var(--accent-soft)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div className="field"><label htmlFor="in-size2">Izmērs (2. pāris)</label><input id="in-size2" className="mono" inputMode="numeric" placeholder="275/45/20" value={f.t2size} onChange={(e) => set('t2size', maskSize(e.target.value))} /></div>
                <div className="field"><label htmlFor="in-brand2">Ražotājs (2. pāris)</label><BrandInput id="in-brand2" placeholder="Michelin" value={f.t2brand} onChange={(v) => set('t2brand', v)} /></div>
                <div className="field"><label>&nbsp;</label><div className="muted" style={{ height: 'var(--h)', display: 'flex', alignItems: 'center', fontSize: 12 }}>2 priekšā + 2 aizmugurē</div></div>
              </div>
            )}
            <div className="rf2" style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr', gap: 12 }}>
              <div className="field"><label>Diski</label>
                <div className="seg">{([['none', 'Bez'], ['aluminum', 'Alumīnija'], ['steel', 'Tērauda']] as const).map(([k, l]) => <button key={k} className={f.rim === k ? 'on' : ''} onClick={() => set('rim', k)}>{l}</button>)}</div>
              </div>
              <div className="field"><label htmlFor="in-thread">Protektora dziļums (neobligāts)</label>
                <div style={{ position: 'relative' }}>
                  <input id="in-thread" className="mono" type="number" step="0.1" placeholder="7.5" style={{ paddingRight: 42 }} value={f.thread} onChange={(e) => set('thread', e.target.value)} />
                  <span className="muted" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13 }}>mm</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="rside" style={{ width: 352, flex: 'none' }}>
          <div className="card clip" style={{ position: 'sticky', top: 76 }}>
            <div className="card-head"><span style={{ fontWeight: 600, fontSize: 14 }}>Kopsavilkums</span><span className="muted" style={{ fontSize: 11 }}>3 · Apstiprināt</span></div>
            <div style={{ padding: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 11 }}>
              <Row label="Klients">{f.looked ? (f.cust.trim() || (f.isNew ? 'Jauns klients' : '—')) : '—'}</Row>
              <Row label="Numurs"><span className="mono" style={{ fontWeight: 600 }}>{f.plate ? f.plate.toUpperCase() : '—'}</span></Row>
              <Row label="Riepas">{tiresLine}</Row>
              <Row label="Diski">{f.rim === 'aluminum' ? 'Alumīnija diski' : f.rim === 'steel' ? 'Tērauda diski' : 'Bez diskiem'}</Row>
              <Row label="Protektors"><span className="mono" style={{ fontWeight: 600 }}>{f.thread ? `${f.thread} mm` : '—'}</span></Row>
              <div className="hr" />
              <div className="kv" style={{ alignItems: 'center' }}><span>Piešķirtā vieta</span>
                <button className="mono" title="Izvēlēties vietu manuāli" onClick={pickSpot} style={{ fontWeight: 600, background: 'var(--ok-soft)', color: 'var(--ok)', border: '1px solid var(--ok-line)', borderRadius: 6, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{place}<span style={{ fontSize: 10, opacity: .75 }}>✎</span></button>
              </div>
              <div className="tile" style={{ padding: 12, marginTop: 4 }}>
                <div className="kv muted" style={{ fontSize: 12 }}><span>Pamatcena <span style={{ opacity: .7 }}>({tier ? `${tier.from}–${tier.to}` : '—'})</span></span><span className="mono">{w ? eur(tier?.price ?? 0) : '—'}</span></div>
                <div className="kv muted" style={{ fontSize: 12, marginTop: 5 }}><span>Disku koef.</span><span className="mono">× {mult.toFixed(1)}</span></div>
                <div className="kv" style={{ alignItems: 'baseline', marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)' }}><span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15 }}>Kopā / sezonā</span><span className="mono" style={{ fontWeight: 600, fontSize: 22 }}>{w ? eur(total) : '—'}</span></div>
              </div>
              <button className="btn lg primary" style={{ marginTop: 4 }} disabled={!!missing.length || busy} onClick={confirm}>{busy ? 'Saglabā…' : 'Apstiprināt pieņemšanu'}</button>
              <div style={{ fontSize: 12, color: 'var(--warn)', textAlign: 'center', minHeight: 16 }}>{missing.length ? `Trūkst: ${missing.join(', ')}` : ''}</div>
              <button className="btn ghost" onClick={reset}>Atcelt</button>
              <div className="muted" style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.5 }}>Pēc apstiprināšanas klients saņems unikālo SMS kodu.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
