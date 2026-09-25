import { canonBrand } from './brands';
import { feeText, threadText } from './format';
import { noteSizeStrict } from './sizes';
import { normCode, type StorageRecord } from './types';

/** Which fields a manual edit may change, and how history labels them. */
export const EDIT_LABELS = {
  season: 'Sezona', location: 'Vieta', plate: 'Numurs', makeModel: 'Auto', customerName: 'Klients',
  phone: 'Telefons', size1: 'Izmērs', brand: 'Ražotājs', quantity: 'Daudzums', size2: '2. izmērs',
  rimNote: 'Diski', notes: 'Piezīmes', intakeDate: 'Saņemts', releaseDate: 'Izsniegts',
  threadDepth: 'Protektors', smsCode: 'SMS kods', feeEur: 'Cena', isCompany: 'Uzņēmums',
} as const;
export type EditableField = keyof typeof EDIT_LABELS;
export const EDITABLE = Object.keys(EDIT_LABELS) as EditableField[];

/** Only allowlisted keys, trimmed; blank → null; plate and place normalised. */
export function readEditPatch(body: Record<string, unknown>): Partial<Record<EditableField, unknown>> {
  const patch: Partial<Record<EditableField, unknown>> = {};
  for (const k of EDITABLE) {
    if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
    let v = body[k];
    if (typeof v === 'string') { v = v.trim(); if (v === '') v = null; }
    if ((k === 'plate' || k === 'location') && typeof v === 'string') v = normCode(v);
    if (k === 'isCompany') v = !!v;
    patch[k] = v;
  }
  return patch;
}

/** Human-readable diff for the history: "Telefons: a → b; Vieta: — → A1 · comment". */
export function editSummary(before: StorageRecord | null, after: StorageRecord, keys: string[], comment: unknown): string {
  const shw = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
  const diffs: string[] = [];
  if (before) {
    const b = before as unknown as Record<string, unknown>;
    const a = after as unknown as Record<string, unknown>;
    for (const k of keys) {
      const o = shw(b[k]), n = shw(a[k]);
      if (o !== n) diffs.push(`${EDIT_LABELS[k as EditableField] ?? k}: ${o} → ${n}`);
    }
  }
  const extra = typeof comment === 'string' && comment.trim() ? comment.trim() : '';
  return [diffs.join('; '), extra].filter(Boolean).join(' · ') || 'Rediģēti dati';
}

/** An optional free-text comment for the history, capped. */
export const commentOf = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null;

export const isActiveish = (r: StorageRecord) => r.status === 'active' || r.status === 'prepared';

/** Most recently stored first; for two on the same day, the one entered later. */
export const newestFirst = (a: StorageRecord, b: StorageRecord) =>
  String(b.intakeDate ?? '').localeCompare(String(a.intakeDate ?? '')) || (Number(b.id) || 0) - (Number(a.id) || 0);

/** Active first, then newest intake — how a vehicle's or customer's history reads. */
export const activeThenNewest = (a: StorageRecord, b: StorageRecord) =>
  (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (b.intakeDate ?? '').localeCompare(a.intakeDate ?? '');

/** "4× Nokian 205/55/16" */
export const tiresLine = (r: Pick<StorageRecord, 'quantity' | 'brand' | 'size1'>): string =>
  [r.quantity ? `${r.quantity}×` : '', canonBrand(r.brand) ?? '', r.size1 ?? ''].filter(Boolean).join(' ');

/**
 * One storage row → a display-ready history item (customers, vehicle panel).
 * Staggered sets (2+2, 3+1…) are split so both pairs are visible.
 */
export function histItem(r: StorageRecord) {
  const size2 = r.size2 ?? (!r.size2 && r.notes ? noteSizeStrict(r.notes) : null);
  const stag = !!(r.quantity && r.quantity.includes('+') && size2);
  const parts = stag ? r.quantity!.split('+') : [];
  return {
    season: r.season, plate: r.plate ?? '—',
    tires: stag
      ? [`${parts[0]}×`, r.brand, r.size1].filter(Boolean).join(' ')
      : ([r.quantity ? `${r.quantity}×` : '', r.brand, r.size1].filter(Boolean).join(' ') + (r.size2 ? ` + ${r.size2}` : '') || '—'),
    tires2: stag ? `${parts[1] || '2'}× ${size2}` : null,
    loc: r.location ?? '—', thread: threadText(r.threadDepth), fee: feeText(r.feeEur),
    status: r.status, id: r.id,
    intakeDate: r.intakeDate, releaseDate: r.releaseDate,
    sms: r.smsCode, rims: r.rimNote, notes: r.notes, makeModel: r.makeModel,
    size1: r.size1, size2, quantity: r.quantity, brand: canonBrand(r.brand),
  };
}
export type HistItem = ReturnType<typeof histItem>;

/** Compact card shape used by Izsniegšana and Sagatavotie. */
export function setCard(r: StorageRecord) {
  return {
    id: r.id, plate: r.plate, cust: r.customerName, phone: r.phone, loc: r.location,
    size: r.size1, size2: r.size2, brand: r.brand, quantity: r.quantity, sms: r.smsCode,
    thread: threadText(r.threadDepth), fee: feeText(r.feeEur),
    intakeDate: r.intakeDate, season: r.season, preparedDate: r.preparedDate,
  };
}
export type SetCard = ReturnType<typeof setCard>;

/** Release lookup: exact SMS code / plate / place first, else a partial plate or code match. */
export function releaseMatches(active: StorageRecord[], rawQ: string): StorageRecord[] {
  const q = normCode(rawQ);
  if (!q) return [];
  const exact = active.filter((r) => normCode(r.smsCode) === q || normCode(r.plate) === q || normCode(r.location) === q).sort(newestFirst);
  return exact.length ? exact : active.filter((r) => normCode(r.plate).includes(q) || normCode(r.smsCode).includes(q)).sort(newestFirst).slice(0, 20);
}

/** Intake prefill from the plate's latest record. */
export function plateLookup(records: StorageRecord[], plate: string) {
  const hits = records.filter((r) => normCode(r.plate) === plate)
    .sort((a, b) => (b.intakeDate ?? '').localeCompare(a.intakeDate ?? ''));
  if (hits.length === 0) return { plate, found: false as const, history: 0, suggestion: null };
  const s = hits[0];
  return {
    plate, found: true as const, history: hits.length, lastSeason: s.season, lastIntake: s.intakeDate,
    suggestion: {
      makeModel: s.makeModel, customerName: s.customerName, isCompany: s.isCompany,
      phone: s.phone, size1: s.size1, brand: s.brand, quantity: s.quantity,
      size2: s.size2 ?? noteSizeStrict(s.notes), rimNote: s.rimNote,
    },
  };
}

/** Live plate suggestions: prefix matches, then sets in storage, then recency. */
export function plateSuggestions(records: StorageRecord[], rawQ: string) {
  const q = normCode(rawQ);
  if (q.length < 2) return [];
  const seen = new Map<string, { plate: string; cust: string | null; active: boolean; date: string | null }>();
  for (const r of records) {
    const p = normCode(r.plate);
    if (!p || !p.includes(q)) continue;
    const e = seen.get(p);
    if (!e) seen.set(p, { plate: r.plate!, cust: r.customerName, active: isActiveish(r), date: r.intakeDate });
    else {
      if (isActiveish(r)) e.active = true;
      if (!e.cust && r.customerName) e.cust = r.customerName;
      if ((r.intakeDate ?? '') > (e.date ?? '')) e.date = r.intakeDate;
    }
  }
  return [...seen.values()]
    .sort((a, b) => {
      const ap = a.plate.toUpperCase().startsWith(q) ? 0 : 1, bp = b.plate.toUpperCase().startsWith(q) ? 0 : 1;
      return ap - bp || (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.date ?? '').localeCompare(a.date ?? '') || a.plate.localeCompare(b.plate);
    })
    .slice(0, 8);
}

/** Company typeahead: distinct company names on file, so a returning company is picked, not retyped. */
export function companySuggestions(records: StorageRecord[], rawQ: string) {
  const q = String(rawQ ?? '').trim().toUpperCase();
  const seen = new Map<string, { name: string; plates: Set<string>; phone: string | null; last: string; count: number }>();
  for (const r of records) {
    if (!r.isCompany || !r.customerName) continue;
    const key = r.customerName.trim().toUpperCase();
    if (!key || (q && !key.includes(q))) continue;
    let e = seen.get(key);
    if (!e) { e = { name: r.customerName.trim(), plates: new Set(), phone: r.phone, last: '', count: 0 }; seen.set(key, e); }
    e.count++;
    if (r.plate) e.plates.add(r.plate);
    if (!e.phone && r.phone) e.phone = r.phone;
    if ((r.intakeDate ?? '') > e.last) e.last = r.intakeDate ?? '';
  }
  return [...seen.values()]
    .sort((a, b) => {
      const ap = a.name.toUpperCase().startsWith(q) ? 0 : 1, bp = b.name.toUpperCase().startsWith(q) ? 0 : 1;
      return ap - bp || b.count - a.count || a.name.localeCompare(b.name, 'lv');
    })
    .slice(0, 8)
    .map((e) => ({ name: e.name, phone: e.phone, vehicles: e.plates.size, count: e.count, last: e.last || null }));
}

/**
 * Customers grouped for the Klienti screen: a company is one card for all its
 * vehicles; a person with a REAL phone is one card across plates; otherwise
 * name+plate. Placeholder phones (the anonymised dummy, low-entropy filler) must
 * not group, or every anonymised record collapses into one giant "customer".
 */
export function groupCustomers(records: StorageRecord[], dummyPhone = '01010101010') {
  const DUMMY = dummyPhone.replace(/\D/g, '');
  const realPhone = (p: string | null) => {
    const d = (p ?? '').replace(/\D/g, '');
    return d.length >= 7 && d !== DUMMY && new Set(d).size >= 3;
  };
  const groups = new Map<string, { name: string; plates: Set<string>; phone: string | null; isCompany: boolean; makeModel: string | null; recs: StorageRecord[] }>();
  for (const r of records) {
    if (!r.plate && !r.customerName) continue;
    const key = r.isCompany && r.customerName ? `co:${r.customerName.toUpperCase().trim()}`
      : realPhone(r.phone) ? `ph:${r.phone}`
        : `np:${r.customerName ?? ''}|${r.plate ?? ''}`;
    if (!groups.has(key)) groups.set(key, { name: r.customerName ?? r.plate ?? '—', plates: new Set(), phone: r.phone, isCompany: r.isCompany, makeModel: r.makeModel, recs: [] });
    const g = groups.get(key)!;
    g.recs.push(r);
    if (r.plate) g.plates.add(r.plate);
    if (r.isCompany) g.isCompany = true;
    if (!g.phone && r.phone) g.phone = r.phone;
    if (!g.makeModel && r.makeModel) g.makeModel = r.makeModel;
  }
  return [...groups.values()]
    .map((g) => ({
      name: g.name, plate: [...g.plates][0] ?? '—', plates: [...g.plates], phone: g.phone, isCompany: g.isCompany, vehicle: g.makeModel,
      active: g.recs.filter((r) => r.status === 'active').length,
      since: g.recs.map((r) => r.intakeDate).filter(Boolean).sort()[0]?.slice(0, 4) ?? '—',
      total: g.recs.length,
      latest: g.recs.map((r) => r.intakeDate ?? '').sort().reverse()[0] ?? '',
      history: [...g.recs].sort(activeThenNewest).slice(0, 30).map(histItem),
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest))
    .slice(0, 30);
}
export type CustomerCard = ReturnType<typeof groupCustomers>[number];
