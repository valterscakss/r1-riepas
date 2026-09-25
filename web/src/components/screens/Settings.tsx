'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errMsg, post, put } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useToast } from '@/client/toast';
import { usePricing, useRefresh } from '@/client/queries';
import type { PushCfg } from '@/client/push';
import { eur } from '@/domain/format';
import { maskSize } from '@/domain/sizes';
import { DEFAULT_PRICING, rimMult, tierFor, type PricingConfig } from '@/domain/pricing';

type Recalc = { changed: number; unchanged: number; skipped: number; total: number; sample: Array<{ plate: string | null; size: string | null; from: string | null; to: string }> };
const clone = (c: PricingConfig): PricingConfig => JSON.parse(JSON.stringify(c));

function PriceTest({ cfg }: { cfg: PricingConfig }) {
  const [size, setSize] = useState('');
  const w = parseInt(size.replace(/\D/g, '').slice(0, 3)) || 0;
  const t = w ? tierFor(cfg, w) : null;
  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 12 }}>Pārbaudi cenu</h2>
      <div className="field" style={{ marginBottom: 14 }}><label htmlFor="price-test">Riepas izmērs</label>
        <input id="price-test" className="mono" inputMode="numeric" placeholder="225/45/17" value={size} onChange={(e) => setSize(maskSize(e.target.value))} /></div>
      {!w ? <div className="muted" style={{ fontSize: 13 }}>Ievadi izmēru, lai redzētu, kurā diapazonā tas iekrīt un cik maksās.</div>
        : !t ? <div style={{ color: 'var(--danger)', fontSize: 13 }}>Neviens diapazons neatbilst platumam {w}.</div>
        : <>
          <div className="muted-2" style={{ fontSize: 13, marginBottom: 8 }}>Platums <b className="mono">{w}</b> → diapazons <b className="mono">{t.from}–{t.to}</b> · pamatcena <b className="mono">{eur(t.price)}</b></div>
          {([['Bez diskiem', 'none'], ['Tērauda diski', 'steel'], ['Alumīnija diski', 'aluminum']] as const).map(([label, rim]) => (
            <div key={rim} className="kv" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}><span>{label}</span><span className="mono" style={{ fontWeight: 600 }}>{eur(t.price * rimMult(cfg, rim))}</span></div>
          ))}
        </>}
    </div>
  );
}

/**
 * Prices are width ranges: "216–245 → 20 €". The widest tire picks the range,
 * then the rim multiplier applies. "Pārrēķināt" reprices sets in storage.
 */
export function SettingsScreen() {
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const saved = usePricing();
  // The draft starts as a copy of what is saved; "Atcelt izmaiņas" puts that back.
  const [draft, setDraft] = useState<PricingConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const push = useQuery({ queryKey: ['push-key'], queryFn: () => api<PushCfg>('/api/push/key') });
  const d = draft ?? (saved.data ? saved.data.pricing : null);
  const edit = (fn: (c: PricingConfig) => void) => setDraft(() => { const c = clone(d ?? DEFAULT_PRICING); fn(c); return c; });
  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  const save = async () => {
    if (!d) return;
    setSaving(true);
    try { const r = await put<{ pricing: PricingConfig }>('/api/pricing', d); setDraft(clone(r.pricing)); toast('Cenas saglabātas'); void refresh(); }
    catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās saglabāt cenas')); } finally { setSaving(false); }
  };
  const recalc = async () => {
    try {
      const p = await post<Recalc>('/api/pricing/recalculate?dryRun=1');
      if (!p.changed) { await dialogs.confirm({ icon: 'success', title: 'Nekas nemainās', body: `Visām ${p.total} glabātajām riepām cena jau atbilst noteikumiem.`, hideCancel: true }); return; }
      const ok = await dialogs.confirm({
        icon: 'warning', title: 'Pārrēķināt cenas?', wide: true, confirmText: `Pārrēķināt (${p.changed})`,
        body: (
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 10 }}><b style={{ fontSize: 18 }}>{p.changed}</b> ierakstiem mainīsies cena · {p.unchanged} paliek · {p.skipped} bez izmēra</div>
            <table className="data" style={{ fontSize: 12 }}><thead><tr><th>Nr.</th><th>Izmērs</th><th>Bija</th><th>Būs</th></tr></thead>
              <tbody>{p.sample.map((s, i) => <tr key={i}><td>{s.plate || '—'}</td><td className="mono">{s.size || '—'}</td><td className="mono">{s.from ? eur(s.from) : '—'}</td><td className="mono"><b>{eur(s.to)}</b></td></tr>)}</tbody></table>
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Rāda pirmos {p.sample.length} no {p.changed}.</div>
          </div>
        ),
      });
      if (!ok.ok) return;
      const r = await post<Recalc>('/api/pricing/recalculate');
      toast(`Pārrēķināts: ${r.changed} ieraksti`);
      void refresh();
    } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās pārrēķināt')); }
  };
  const testPush = async () => {
    try { const r = await post<{ sent: number; failed: number; devices: number }>('/api/push/test'); toast(r.failed ? `Nosūtīts ${r.sent} no ${r.devices} ierīcēm` : `Nosūtīts uz ${r.sent} ${r.sent === 1 ? 'ierīci' : 'ierīcēm'}`); void push.refetch(); }
    catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās nosūtīt')); }
  };

  if (!d) return <div className="page"><div className="card empty left">Ielādē…</div></div>;
  const pc = push.data;
  return (
    <div className="page w-900" style={{ maxWidth: 920 }}>
      <div className="page-head"><div><h1>Iestatījumi</h1><div className="sub">Glabāšanas cenas pēc riepas platuma</div></div></div>
      <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <div className="stack">
          <div className="card pad">
            <h2 style={{ marginBottom: 4 }}>Cena pēc platuma</h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>Platums ir izmēra pirmais skaitlis — <b className="mono">225</b>/45/17. Komplektam ar diviem izmēriem noteicošais ir platākais.</div>
            {d.tiers.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.1fr 40px', gap: 10, alignItems: 'end', marginBottom: 10 }}>
                <div className="field"><label>Platums no</label><input className="mono" type="number" min={0} max={999} value={t.from} onChange={(e) => edit((c) => { c.tiers[i].from = num(e.target.value); })} /></div>
                <div className="field"><label>līdz</label><input className="mono" type="number" min={0} max={999} value={t.to} onChange={(e) => edit((c) => { c.tiers[i].to = num(e.target.value); })} /></div>
                <div className="field"><label>Cena €/sezonā</label><input className="mono" type="number" min={0} step={0.5} value={t.price} onChange={(e) => edit((c) => { c.tiers[i].price = num(e.target.value); })} /></div>
                <button className="btn danger-text" style={{ height: 'var(--h)', padding: 0 }} title="Dzēst diapazonu" onClick={() => edit((c) => { c.tiers.splice(i, 1); })}>✕</button>
              </div>
            ))}
            <button className="btn" onClick={() => edit((c) => { const last = c.tiers.at(-1); c.tiers.push({ from: last ? Math.min(999, last.to + 1) : 0, to: 999, price: last ? last.price : 15 }); })}>＋ Pievienot diapazonu</button>
          </div>
          <div className="card pad">
            <h2 style={{ marginBottom: 4 }}>Disku koeficients</h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>Reizinātājs pamatcenai, ja riepas glabājas uz diskiem.</div>
            <div className="rf3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {([['none', 'Bez diskiem'], ['steel', 'Tērauda'], ['aluminum', 'Alumīnija']] as const).map(([k, l]) => (
                <div key={k} className="field"><label>{l}</label><input className="mono" type="number" min={0} step={0.05} value={d.rims[k]} onChange={(e) => edit((c) => { const v = num(e.target.value); c.rims[k] = v > 0 ? v : 1; })} /></div>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn lg primary" disabled={saving} onClick={save}>{saving ? 'Saglabā…' : 'Saglabāt cenas'}</button>
            <button className="btn lg" onClick={() => { setDraft(null); toast('Izmaiņas atceltas', 'info'); }}>Atcelt izmaiņas</button>
          </div>
        </div>
        <div className="stack">
          <PriceTest cfg={d} />
          <div className="card pad">
            <h2 style={{ marginBottom: 4 }}>Paziņojumi</h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
              {!pc ? 'Pārbauda…' : !pc.enabled
                ? <><b style={{ color: 'var(--warn)' }}>Nav konfigurēti.</b> Serverim trūkst VAPID atslēgu — lietotne joprojām pārbauda uzdevumus ik pēc 20 s, bet aizvērta lietotne paziņojumus nesaņems.</>
                : <><b style={{ color: 'var(--ok)' }}>Ieslēgti.</b> Pieteiktas ierīces: <b className="mono">{pc.devices}</b>. {pc.devices ? 'Katra saņems paziņojumu, tiklīdz kāds kaut ko pasūta.' : <>Vēl neviena — atver <b>Noliktava</b> uz telefona un nospied <b>🔔 Paziņojumi</b>.</>}</>}
            </div>
            <button className="btn block" style={{ height: 44 }} onClick={testPush}>🔔 Nosūtīt testa paziņojumu</button>
          </div>
          <div className="card pad">
            <h2 style={{ marginBottom: 4 }}>Pārrēķināt</h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>Pārrēķina cenu <b>riepām, kas šobrīd glabājas</b>, pēc saglabātajiem noteikumiem. Jau izsniegtie pasūtījumi netiek mainīti — tur paliek summa, ko klients samaksāja.</div>
            <button className="btn dark block" style={{ height: 44 }} onClick={recalc}>↻ Pārrēķināt glabātajām</button>
          </div>
        </div>
      </div>
    </div>
  );
}
