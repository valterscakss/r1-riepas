import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IntakeInput, StorageRecord, Store, PricingConfig, PricingTier } from './types.js';
import { DEFAULT_PRICING } from './types.js';
import { getStore } from './store.js';
import { parseWorkbook } from './importExcel.js';
import {
  COOKIE, signToken, verifyPassword, hashPassword, currentUser, requireAuth, requireAdmin, toSession,
  AUTH_DISABLED, DEMO_USER,
} from './auth.js';
import { pushToAll, pushEnabled, vapidPublicKey } from './push.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const asyncH = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: { message: String(err?.message ?? err) } });
    });

const cookieOpts = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 12 * 60 * 60 * 1000,
};

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // --- Auth ---
  app.post('/api/login', asyncH(async (req, res) => {
    const store = await getStore();
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ error: { message: 'Username and password required' } });
    // Case-insensitive username (guards against mobile auto-capitalization).
    const user = await store.getUserByUsername(String(username).trim().toLowerCase());
    if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
      return res.status(401).json({ error: { message: 'Invalid username or password' } });
    }
    const session = toSession(user);
    const token = signToken(session);
    res.cookie(COOKIE, token, cookieOpts);
    // Also return the token so the SPA can store it and send it as a Bearer
    // header — this keeps login working even when the browser blocks cookies.
    res.json({ user: session, token });
  }));

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (AUTH_DISABLED()) return res.json({ user: DEMO_USER });
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: { message: 'Not authenticated' } });
    res.json({ user: u });
  });

  app.get('/api/health', asyncH(async (_req, res) => {
    const store = await getStore();
    res.json({ ok: true, store: store.kind() });
  }));

  // --- Data (auth required) ---
  app.get('/api/storage', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const status = req.query.status === 'released' ? 'released' : req.query.status === 'active' ? 'active' : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const records = await store.list({ status, q });
    res.json({ count: records.length, records });
  }));

  app.get('/api/storage/:id', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rec);
  }));

  // Manual edit of a record's data fields (Tabula). Only allowlisted keys are applied.
  app.patch('/api/storage/:id', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const EDITABLE = ['season', 'location', 'plate', 'makeModel', 'customerName', 'phone',
      'size1', 'brand', 'quantity', 'size2', 'rimNote', 'notes', 'intakeDate', 'releaseDate',
      'threadDepth', 'smsCode', 'feeEur', 'isCompany'] as const;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        let v = body[k];
        if (typeof v === 'string') { v = v.trim(); if (v === '') v = null; }
        if (k === 'plate' && typeof v === 'string') v = v.toUpperCase().replace(/\s+/g, '');
        if (k === 'location' && typeof v === 'string') v = v.toUpperCase().replace(/\s+/g, '');
        patch[k] = v;
      }
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: { message: 'No editable fields provided' } });
    const before = await store.get(req.params.id);
    const rec = await store.updateRecord(req.params.id, patch);
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    // Build a human-readable diff (old → new) so the history shows exactly what changed.
    const EDIT_LABELS: Record<string, string> = {
      season: 'Sezona', location: 'Vieta', plate: 'Numurs', makeModel: 'Auto', customerName: 'Klients',
      phone: 'Telefons', size1: 'Izmērs', brand: 'Ražotājs', quantity: 'Daudzums', size2: '2. izmērs',
      rimNote: 'Diski', notes: 'Piezīmes', intakeDate: 'Saņemts', releaseDate: 'Izsniegts',
      threadDepth: 'Protektors', smsCode: 'SMS kods', feeEur: 'Cena', isCompany: 'Uzņēmums',
    };
    const shw = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
    const diffs: string[] = [];
    if (before) {
      const bRec = before as unknown as Record<string, unknown>;
      const nRec = rec as unknown as Record<string, unknown>;
      for (const k of Object.keys(patch)) {
        const o = shw(bRec[k]);
        const n = shw(nRec[k]);
        if (o !== n) diffs.push(`${EDIT_LABELS[k] ?? k}: ${o} → ${n}`);
      }
    }
    const extra = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : '';
    const summary = [diffs.join('; '), extra].filter(Boolean).join(' · ') || 'Rediģēti dati';
    await logEvent(store, rec.id, 'edited', summary, req);
    res.json({ ok: true, record: rec });
  }));

  app.get('/api/lookup', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const raw = typeof req.query.plate === 'string' ? req.query.plate : '';
    const plate = raw.toUpperCase().replace(/\s+/g, '');
    if (!plate) return res.status(400).json({ error: { message: 'plate is required' } });
    const all = await store.list({ q: plate });
    const hits = all
      .filter((r) => (r.plate ?? '').toUpperCase().replace(/\s+/g, '') === plate)
      .sort((a, b) => (b.intakeDate ?? '').localeCompare(a.intakeDate ?? ''));
    if (hits.length === 0) return res.json({ plate, found: false, history: 0, suggestion: null });
    const s = hits[0];
    // Legacy staggered rows sometimes keep the 2nd size in notes — surface it.
    const size2 = s.size2 ?? (s.notes?.match(/\b(\d{3}\/\d{1,2}\/\d{2})\b/)?.[1] ?? null);
    res.json({
      plate, found: true, history: hits.length, lastSeason: s.season, lastIntake: s.intakeDate,
      suggestion: {
        makeModel: s.makeModel, customerName: s.customerName, isCompany: s.isCompany,
        phone: s.phone, size1: s.size1, brand: s.brand, quantity: s.quantity,
        size2, rimNote: s.rimNote,
      },
    });
  }));

  // Live plate suggestions for the intake typeahead dropdown.
  app.get('/api/plate-suggest', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const q = String(req.query.q ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (q.length < 2) return res.json({ suggestions: [] });
    const all = await store.list({ q });
    const seen = new Map<string, { plate: string; cust: string | null; active: boolean; date: string | null }>();
    for (const r of all) {
      const p = (r.plate ?? '').toUpperCase().replace(/\s+/g, '');
      if (!p || !p.includes(q)) continue;
      const e = seen.get(p);
      if (!e) seen.set(p, { plate: r.plate!, cust: r.customerName, active: r.status === 'active' || r.status === 'prepared', date: r.intakeDate });
      else {
        if (r.status === 'active' || r.status === 'prepared') e.active = true;
        if (!e.cust && r.customerName) e.cust = r.customerName;
        if ((r.intakeDate ?? '') > (e.date ?? '')) e.date = r.intakeDate;
      }
    }
    const suggestions = [...seen.values()]
      .sort((a, b) => {
        const ap = a.plate.toUpperCase().startsWith(q) ? 0 : 1, bp = b.plate.toUpperCase().startsWith(q) ? 0 : 1;
        return ap - bp || (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.date ?? '').localeCompare(a.date ?? '') || a.plate.localeCompare(b.plate);
      })
      .slice(0, 8);
    res.json({ suggestions });
  }));

  // ---- Domain helpers (per design: pricing, spot assignment, SMS codes) ----
  const SPOT_RE = /^([A-ZĀ-Ž]{1,4})(\d{1,3})$/;
  async function spotUniverse() {
    const store = await getStore();
    const all = await store.list();
    const defs = await store.listContainers();
    const seen = new Map<string, { code: string; c: string; n: number }>();
    const occupied = new Map<string, (typeof all)[number]>();
    for (const r of all) {
      const code = (r.location ?? '').toUpperCase();
      const m = code.match(SPOT_RE);
      if (!m) continue;
      if (!seen.has(code)) seen.set(code, { code, c: m[1], n: Number(m[2]) });
      // Stored ('active'), staged-for-swap ('prepared') and manually 'blocked' spots all hold the spot.
      if ((r.status === 'active' || r.status === 'prepared' || r.status === 'blocked') && !occupied.has(code)) occupied.set(code, r);
    }
    // Add every place from user-defined containers, so empty containers appear too.
    for (const d of defs) {
      const cap = Math.max(0, (d.rows || 1) * (d.cols || 1));
      for (let n = 1; n <= cap; n++) {
        const code = `${d.prefix}${n}`;
        if (!seen.has(code)) seen.set(code, { code, c: d.prefix, n });
      }
    }
    const spots = [...seen.values()].sort((a, b) => a.c.localeCompare(b.c) || a.n - b.n);
    return { spots, occupied, all, defs };
  }
  // --- Pricing (editable in Iestatījumi; falls back to the built-in tiers) ---
  // A tier matches the tire's WIDTH, inclusive at both ends; the widest tire in a
  // staggered set decides. Validation lives here so a bad payload can never make
  // the intake screen price things at zero.
  const cleanPricing = (raw: unknown): PricingConfig => {
    const r = (raw ?? {}) as Partial<PricingConfig>;
    const num = (v: unknown, min: number, max: number, dflt: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
    };
    const tiers = (Array.isArray(r.tiers) ? r.tiers : [])
      .map((t) => ({
        from: Math.trunc(num((t as PricingTier)?.from, 0, 999, 0)),
        to: Math.trunc(num((t as PricingTier)?.to, 0, 999, 999)),
        price: Math.round(num((t as PricingTier)?.price, 0, 100000, 0) * 100) / 100,
      }))
      .filter((t) => t.to >= t.from)
      .sort((a, b) => a.from - b.from);
    const rims = (r.rims ?? {}) as PricingConfig['rims'];
    return {
      tiers: tiers.length ? tiers : DEFAULT_PRICING.tiers,
      rims: {
        none: num(rims.none, 0, 100, DEFAULT_PRICING.rims.none),
        steel: num(rims.steel, 0, 100, DEFAULT_PRICING.rims.steel),
        aluminum: num(rims.aluminum, 0, 100, DEFAULT_PRICING.rims.aluminum),
      },
    };
  };
  const loadPricing = async (): Promise<PricingConfig> => {
    try {
      const store = await getStore();
      const raw = await store.getSetting('pricing');
      return raw ? cleanPricing(raw) : DEFAULT_PRICING;
    } catch { return DEFAULT_PRICING; }
  };
  const widthOf = (size: string | null) => parseInt((size ?? '').slice(0, 3)) || 0;
  const priceWith = (cfg: PricingConfig, size: string | null, rim: string | null, size2?: string | null) => {
    const width = Math.max(widthOf(size), widthOf(size2 ?? null));
    if (!width) return { width: 0, base: 0, mult: 1, total: 0, tier: null as PricingTier | null };
    // First matching range wins; anything above every range falls to the last tier.
    const tier = cfg.tiers.find((t) => width >= t.from && width <= t.to) ?? cfg.tiers[cfg.tiers.length - 1] ?? null;
    const base = tier?.price ?? 0;
    const mult = rim === 'aluminum' ? cfg.rims.aluminum : rim === 'steel' ? cfg.rims.steel : cfg.rims.none;
    return { width, base, mult, total: Math.round(base * mult * 100) / 100, tier };
  };
  const seasonNow = () => {
    const d = new Date();
    return `${d.getFullYear()} ${d.getMonth() + 1 >= 3 && d.getMonth() + 1 < 9 ? 'PAVASARIS' : 'RUDENS'}`;
  };
  // One storage row → a display-ready history item (shared by /customers and /vehicle).
  // Staggered sets (2+2, 3+1…) are split so both pairs are visible; the old Excel
  // sometimes kept the 2nd size in notes, so fall back to it.
  const histItem = (r: StorageRecord) => {
    const noteSize = !r.size2 && r.notes ? (r.notes.match(/\b(\d{3}\/\d{1,2}\/\d{2})\b/)?.[1] ?? null) : null;
    const size2 = r.size2 ?? noteSize;
    const stag = !!(r.quantity && r.quantity.includes('+') && size2);
    const parts = stag ? r.quantity!.split('+') : [];
    return {
      season: r.season, plate: r.plate ?? '—',
      tires: stag
        ? [`${parts[0]}×`, r.brand, r.size1].filter(Boolean).join(' ')
        : ([r.quantity ? `${r.quantity}×` : '', r.brand, r.size1].filter(Boolean).join(' ') + (r.size2 ? ` + ${r.size2}` : '') || '—'),
      tires2: stag ? `${parts[1] || '2'}× ${size2}` : null,
      loc: r.location ?? '—', thread: r.threadDepth ? `${r.threadDepth} mm` : '—',
      fee: r.feeEur ? `€${Number(r.feeEur).toFixed(2).replace('.', ',')}` : '—',
      status: r.status, id: r.id,
      intakeDate: r.intakeDate, releaseDate: r.releaseDate,
    };
  };

  // Who performed an action (for the record history), and a fire-and-forget logger.
  const actorOf = (req: express.Request): string | null =>
    (req as express.Request & { user?: { username?: string } }).user?.username ?? null;
  const logEvent = async (store: Store, recordId: string, action: string, comment: unknown, req: express.Request) => {
    const c = typeof comment === 'string' && comment.trim() ? comment.trim().slice(0, 500) : null;
    try { await store.addEvent({ recordId, action, comment: c, actor: actorOf(req) }); } catch { /* history is non-critical */ }
  };

  // Stats for dashboard + spots grid (design: containers, capacity, activity).
  app.get('/api/stats', requireAuth, asyncH(async (_req, res) => {
    const { spots, occupied, all, defs } = await spotUniverse();
    const defByPrefix = new Map(defs.map((d) => [d.prefix, d]));
    const byC = new Map<string, { letter: string; spots: unknown[]; occ: number }>();
    for (const s of spots) {
      if (!byC.has(s.c)) byC.set(s.c, { letter: s.c, spots: [], occ: 0 });
      const g = byC.get(s.c)!;
      const r = occupied.get(s.code);
      if (r) g.occ++;
      g.spots.push(r
        ? { code: s.code, occ: true, reserved: r.status === 'prepared', blocked: r.status === 'blocked', hasRims: !!r.rimNote, id: r.id, plate: r.plate, cust: r.customerName, brand: r.brand, size: r.size1, sms: r.smsCode, thread: r.threadDepth }
        : { code: s.code, occ: false });
    }
    const containers = [...byC.values()]
      .map((g) => {
        const d = defByPrefix.get(g.letter);
        return { ...g, total: g.spots.length, cols: d?.cols ?? 4, label: d?.label ?? null, defId: d?.id ?? null };
      })
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const occ = [...occupied.keys()].length;
    const reserved = [...occupied.values()].filter((r) => r.status === 'prepared').length;
    const today = new Date().toISOString().slice(0, 10);
    const firstFree = spots.find((s) => !occupied.has(s.code));
    const revenue = all.filter((r) => r.status === 'active' && r.feeEur).reduce((a, r) => a + (parseFloat(r.feeEur!) || 0), 0);
    res.json({
      occ, total: spots.length, free: spots.length - occ, reserved,
      capPct: spots.length ? Math.round((occ / spots.length) * 100) : 0,
      todayIntakes: all.filter((r) => r.intakeDate === today).length,
      smsIssued: all.filter((r) => r.smsCode).length,
      revenueActive: Math.round(revenue * 100) / 100,
      assignNext: firstFree?.code ?? null,
      containers,
    });
  }));

  // Canonical tire-brand names — collapses the shop's shorthand into full brand
  // names so analytics don't split one brand across spellings (e.g. GY = Goodyear,
  // Conti = Continental). Unknown brands keep their original text.
  const BRAND_ALIASES: Record<string, string> = {
    GY: 'Goodyear', GOODYEAR: 'Goodyear', 'GOOD YEAR': 'Goodyear',
    CONTI: 'Continental', CONTINENTAL: 'Continental',
    BS: 'Bridgestone', BRIDGESTONE: 'Bridgestone', BRIDG: 'Bridgestone',
    MICH: 'Michelin', MICHELIN: 'Michelin',
    PIRELLI: 'Pirelli', NOKIAN: 'Nokian', HANKOOK: 'Hankook',
    YOKOHAMA: 'Yokohama', DUNLOP: 'Dunlop', SAVA: 'Sava',
    KUMHO: 'Kumho', NEXEN: 'Nexen', SAILUN: 'Sailun', TOYO: 'Toyo',
    MARSHAL: 'Marshal', MARSHALL: 'Marshal',
  };
  const canonBrand = (b: string | null | undefined): string | null => {
    const t = (b ?? '').trim();
    if (!t) return null;
    return BRAND_ALIASES[t.toUpperCase()] ?? t;
  };

  // Analytics: aggregate car makes/models, tire sizes, brands, seasons, quantity
  // types (excludes 'blocked' placeholder spots). Optional ?season= filters to one
  // source sheet. The 2nd size is pulled from size2 or a size in the notes column.
  app.get('/api/analytics', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    // Placeholder rows (manually blocked spots, "BRĪVS" free markers) hold no tires
    // and would only skew the counts.
    const everything = (await store.list()).filter((r) => r.status !== 'blocked' && r.status !== 'free');
    // Distinct source seasons (from the full set, so the dropdown is stable when
    // filtered). Year-prefixed seasons come first, newest first; oddly-named sheets last.
    const seasonOptions = [...new Set(everything.map((r) => (r.season ?? '').trim()).filter(Boolean))]
      .sort((a, b) => {
        const ya = /^\d{4}/.test(a), yb = /^\d{4}/.test(b);
        if (ya && yb) return b.localeCompare(a, 'lv');
        if (ya !== yb) return ya ? -1 : 1;
        return a.localeCompare(b, 'lv');
      });
    const selectedSeason = typeof req.query.season === 'string' ? req.query.season.trim() : '';
    const fStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const fCustomer = typeof req.query.customer === 'string' ? req.query.customer.trim() : '';
    const fRims = typeof req.query.rims === 'string' ? req.query.rims.trim() : '';
    let all = everything;
    if (selectedSeason) all = all.filter((r) => (r.season ?? '').trim() === selectedSeason);
    if (fStatus === 'active' || fStatus === 'released' || fStatus === 'prepared') all = all.filter((r) => r.status === fStatus);
    if (fCustomer === 'company') all = all.filter((r) => r.isCompany);
    else if (fCustomer === 'private') all = all.filter((r) => !r.isCompany);
    if (fRims === 'with') all = all.filter((r) => !!r.rimNote);
    else if (fRims === 'without') all = all.filter((r) => !r.rimNote);
    const NOTE_SIZE = /\b(\d{3})\/(\d{1,2})[/R]?(\d{2})\b/i;
    const normSz = (s: string | null): string | null => {
      if (!s) return null;
      const m = s.replace(/\s/g, '').match(/^(\d{3})\/(\d{1,2})[/R]?(\d{2})$/i);
      return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
    };
    const second = (r: { size2: string | null; notes: string | null }): string | null => {
      if (r.size2) return normSz(r.size2);
      const nm = (r.notes || '').match(NOTE_SIZE);
      return nm ? `${nm[1]}/${nm[2]}/${nm[3]}` : null;
    };
    const tally = (map: Map<string, number>, key: string | null | undefined) => {
      const k = (key ?? '').trim();
      if (!k) return;
      map.set(k, (map.get(k) ?? 0) + 1);
    };
    const top = (map: Map<string, number>, n = 15) =>
      [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, n).map(([label, count]) => ({ label, count }));

    const makes = new Map<string, number>();      // first word of makeModel
    const models = new Map<string, number>();      // full make+model
    const sizes = new Map<string, number>();       // size1 + 2nd sizes
    const brands = new Map<string, number>();
    const seasons = new Map<string, number>();
    const quantities = new Map<string, number>();
    let withSecond = 0;

    for (const r of all) {
      if (r.makeModel) {
        tally(models, r.makeModel);
        tally(makes, r.makeModel.trim().split(/\s+/)[0].toUpperCase());
      }
      const s1 = normSz(r.size1);
      if (s1) tally(sizes, s1);
      const s2 = second(r);
      if (s2) { tally(sizes, s2); withSecond++; }
      tally(brands, canonBrand(r.brand));
      tally(seasons, r.season);
      if (r.quantity) tally(quantities, r.quantity.trim());
    }
    res.json({
      total: all.length,
      active: all.filter((r) => r.status === 'active').length,
      prepared: all.filter((r) => r.status === 'prepared').length,
      released: all.filter((r) => r.status === 'released').length,
      withSecondSize: withSecond,
      seasonOptions, selectedSeason,
      filters: { status: fStatus, customer: fCustomer, rims: fRims },
      makes: top(makes), models: top(models), sizes: top(sizes),
      brands: top(brands), seasons: top(seasons, 30), quantities: top(quantities),
    });
  }));

  // Recent activity feed (intakes + releases by date).
  app.get('/api/activity', requireAuth, asyncH(async (_req, res) => {
    const store = await getStore();
    const all = await store.list();
    const byId = new Map(all.map((r) => [String(r.id), r]));
    type Feed = { type: string; plate: string | null; loc: string | null; d: string; comment?: string | null; actor?: string | null };
    const ev: Feed[] = [];
    // Rich, timestamped events (comments + every action) — newest first.
    const events = await store.recentEvents(40);
    const hasCreated = new Set<string>();
    const hasReleased = new Set<string>();
    for (const e of events) {
      const r = byId.get(String(e.recordId));
      if (e.action === 'created') hasCreated.add(String(e.recordId));
      if (e.action === 'released' || e.action === 'swapped') hasReleased.add(String(e.recordId));
      ev.push({ type: e.action, plate: r?.plate ?? null, loc: r?.location ?? null, d: e.createdAt ?? '', comment: e.comment, actor: e.actor });
    }
    // Date-derived intake/release for coverage of records with no logged event yet.
    // Skip FUTURE dates (data-entry typos like a 2026-12 release when it's July) so
    // "recent actions" reflects things that actually happened, not future placeholders.
    const today = new Date().toISOString().slice(0, 10);
    for (const r of all) {
      if (r.intakeDate && r.intakeDate <= today && !hasCreated.has(String(r.id))) ev.push({ type: 'in', plate: r.plate, loc: r.location, d: r.intakeDate });
      if (r.releaseDate && r.releaseDate <= today && !hasReleased.has(String(r.id))) ev.push({ type: 'out', plate: r.plate, loc: r.location, d: r.releaseDate });
    }
    // Unified chronological sort by a real timestamp (ms). Date-only values are read
    // as UTC midnight; full ISO timestamps keep their time — so ordering is consistent.
    const tms = (d: string) => { const t = Date.parse(/[TZ]/.test(d) ? d : `${d}T00:00:00Z`); return Number.isNaN(t) ? 0 : t; };
    ev.sort((a, b) => tms(b.d || '') - tms(a.d || ''));
    res.json({ events: ev.slice(0, 12) });
  }));

  // Customers view: grouped by name+plate with storage history.
  app.get('/api/customers', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase() : '';
    const all = await store.list(q ? { q } : undefined);
    // Grouping: a company = one card for ALL its vehicles; an individual with a
    // real phone = one card across plates; otherwise fall back to name+plate.
    // A phone only groups if it's a genuine number — NOT the anonymized placeholder
    // (e.g. 01010101010) or any low-entropy filler. Placeholders have very few
    // distinct digits; without this guard every anonymized record collapses into
    // one giant "customer".
    const DUMMY_PHONE = (process.env.DUMMY_PHONE || '01010101010').replace(/\D/g, '');
    const realPhone = (p: string | null) => {
      const d = (p ?? '').replace(/\D/g, '');
      return d.length >= 7 && d !== DUMMY_PHONE && new Set(d).size >= 3;
    };
    const groups = new Map<string, { name: string; plates: Set<string>; phone: string | null; isCompany: boolean; makeModel: string | null; recs: typeof all }>();
    for (const r of all) {
      if (!r.plate && !r.customerName) continue;
      const key = r.isCompany && r.customerName ? `co:${r.customerName.toUpperCase().trim()}`
        : realPhone(r.phone) ? `ph:${r.phone}`
        : `np:${r.customerName ?? ''}|${r.plate ?? ''}`;
      if (!groups.has(key)) groups.set(key, { name: r.customerName ?? r.plate ?? '—', plates: new Set(), phone: r.phone, isCompany: r.isCompany, makeModel: r.makeModel, recs: [] as typeof all });
      const g = groups.get(key)!;
      g.recs.push(r);
      if (r.plate) g.plates.add(r.plate);
      if (r.isCompany) g.isCompany = true;
      if (!g.phone && r.phone) g.phone = r.phone;
      if (!g.makeModel && r.makeModel) g.makeModel = r.makeModel;
    }
    const list = [...groups.values()]
      .map((g) => ({
        name: g.name, plate: [...g.plates][0] ?? '—', plates: [...g.plates], phone: g.phone, isCompany: g.isCompany, vehicle: g.makeModel,
        active: g.recs.filter((r) => r.status === 'active').length,
        since: g.recs.map((r) => r.intakeDate).filter(Boolean).sort()[0]?.slice(0, 4) ?? '—',
        total: g.recs.length,
        latest: g.recs.map((r) => r.intakeDate ?? '').sort().reverse()[0] ?? '',
        history: g.recs
          .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (b.intakeDate ?? '').localeCompare(a.intakeDate ?? ''))
          .slice(0, 30)
          .map(histItem),
      }))
      .sort((a, b) => b.latest.localeCompare(a.latest))
      .slice(0, 30);
    res.json({ customers: list });
  }));

  // Full storage history for a single vehicle (all seasons), for the spot panel.
  app.get('/api/vehicle', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const plate = String(req.query.plate ?? '').toUpperCase().replace(/\s+/g, '');
    if (!plate) return res.status(400).json({ error: { message: 'plate is required' } });
    const recs = (await store.list({ q: plate }))
      .filter((r) => (r.plate ?? '').toUpperCase().replace(/\s+/g, '') === plate)
      .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (b.intakeDate ?? '').localeCompare(a.intakeDate ?? ''));
    if (recs.length === 0) return res.json({ plate, found: false, count: 0, customer: null, history: [] });
    const cur = recs.find((r) => r.status === 'active') ?? recs[0];
    res.json({
      plate, found: true, count: recs.length,
      customer: { name: cur.customerName, phone: cur.phone, isCompany: cur.isCompany, makeModel: cur.makeModel },
      history: recs.map(histItem),
    });
  }));

  // Release lookup: find ACTIVE stored sets by SMS code, plate, or location.
  app.get('/api/release-lookup', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const q = String(req.query.q ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (!q) return res.json({ q: '', results: [] });
    const active = await store.list({ status: 'active' });
    const norm = (s: string | null) => String(s ?? '').toUpperCase().replace(/\s+/g, '');
    const exact = active.filter((r) => norm(r.smsCode) === q || norm(r.plate) === q || norm(r.location) === q);
    const chosen = exact.length
      ? exact
      : active.filter((r) => norm(r.plate).includes(q) || norm(r.smsCode).includes(q)).slice(0, 20);
    const results = chosen.map((r) => ({
      id: r.id, plate: r.plate, cust: r.customerName, phone: r.phone, loc: r.location,
      size: r.size1, size2: r.size2, brand: r.brand, quantity: r.quantity, sms: r.smsCode,
      thread: r.threadDepth ? `${r.threadDepth} mm` : '—',
      fee: r.feeEur ? `€${Number(r.feeEur).toFixed(2).replace('.', ',')}` : '—',
      intakeDate: r.intakeDate, season: r.season,
    }));
    res.json({ q, results });
  }));

  app.post('/api/intake', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const b = req.body ?? {};
    if (!b.plate) {
      return res.status(400).json({ error: { message: 'Numura zīme ir obligāta' } });
    }
    const plate = String(b.plate).toUpperCase().replace(/\s+/g, '');
    // Auto-assign the first free spot unless one was provided (design FR-2.2.5).
    let location = b.location ? String(b.location).toUpperCase().replace(/\s+/g, '') : null;
    const { spots, occupied, all } = await spotUniverse();
    if (!location) {
      const firstFree = spots.find((s) => !occupied.has(s.code));
      location = firstFree?.code ?? null;
    }
    // Pricing: width tier × rim multiplier, both editable in Iestatījumi.
    const rim = b.rim === 'aluminum' || b.rim === 'steel' ? b.rim : 'none';
    const { total } = priceWith(await loadPricing(), b.size1 ?? null, rim, b.size2 ?? null);
    // Unique SMS code: R1T + plate, padded; add suffix on collision.
    const existing = new Set(all.map((r) => r.smsCode).filter(Boolean));
    let smsCode = ('R1T' + plate.replace(/[^A-Z0-9]/g, '')).slice(0, 8).padEnd(8, 'X');
    let n = 2;
    while (existing.has(smsCode)) smsCode = (smsCode.slice(0, 7) + n++).slice(0, 8);
    const rimLabel = rim === 'aluminum' ? 'Alumīnija diski' : rim === 'steel' ? 'Tērauda diski' : null;
    const input: IntakeInput = {
      season: b.season ?? seasonNow(),
      location,
      plate,
      makeModel: b.makeModel ?? null,
      customerName: b.customerName ?? null,
      isCompany: Boolean(b.isCompany),
      phone: b.phone ?? null,
      size1: b.size1 ?? null,
      brand: b.brand ?? null,
      quantity: b.quantity ?? null,
      size2: b.size2 ?? null,
      rimNote: b.rimNote ?? rimLabel,
      notes: b.notes ?? null,
      intakeDate: b.intakeDate ?? undefined,
      threadDepth: b.threadDepth ? String(b.threadDepth) : null,
      smsCode,
      feeEur: total ? String(total) : null,
    };
    // Swap completion: close the prepared set that reserved this spot, then store
    // the new season's tires in the same place.
    if (b.releaseId) {
      try {
        await store.release(String(b.releaseId), {});
        await logEvent(store, String(b.releaseId), 'swapped', 'Aizvietots ar jaunām riepām', req);
        await store.closeTasksForRecord(String(b.releaseId), actorOf(req));
      } catch { /* already closed */ }
    }
    const rec = await store.create(input);
    await logEvent(store, rec.id, 'created', b.notes, req);
    res.status(201).json(rec);
  }));

  app.post('/api/storage/:id/release', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.release(req.params.id, { releaseDate: req.body?.releaseDate });
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    await logEvent(store, rec.id, 'released', req.body?.comment, req);
    // The set has left the building — any warehouse job for it is settled.
    try { await store.closeTasksForRecord(String(rec.id), actorOf(req)); } catch { /* non-critical */ }
    res.json(rec);
  }));

  // Stage a set for a seasonal swap: tires out, spot stays reserved ('prepared').
  app.post('/api/storage/:id/prepare', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.prepare(req.params.id, {});
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    await logEvent(store, rec.id, 'prepared', req.body?.comment, req);
    // Hand the physical work to the warehouse queue.
    let task = null;
    try {
      const comment = typeof req.body?.comment === 'string' && req.body.comment.trim() ? req.body.comment.trim() : null;
      task = await store.createTask({
        kind: 'prepare', recordId: String(rec.id), title: taskTitleFor(rec),
        details: [taskDetailsFor(rec), comment].filter(Boolean).join(' · ') || null,
        location: rec.location, plate: rec.plate, createdBy: actorOf(req),
      });
      announceTask(task);
    } catch (e) { console.error('[tasks] could not queue prepare job:', e); }
    res.json({ ...rec, task });
  }));
  // Undo a prepare — put the set back in its spot ('active').
  app.post('/api/storage/:id/unprepare', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.prepare(req.params.id, { active: true });
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    await logEvent(store, rec.id, 'unprepared', req.body?.comment, req);
    // The job is off the table — take it out of the warehouse list too.
    try { await store.closeTasksForRecord(String(rec.id), actorOf(req)); } catch { /* non-critical */ }
    res.json(rec);
  }));

  // Manually block/reserve an empty spot (no tires) so it's unavailable.
  app.post('/api/spots/:code/block', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const code = String(req.params.code).toUpperCase().replace(/\s+/g, '');
    if (!SPOT_RE.test(code)) return res.status(400).json({ error: { message: 'Nederīga vietas norāde' } });
    const { spots, occupied } = await spotUniverse();
    if (!spots.some((s) => s.code === code)) return res.status(404).json({ error: { message: 'Nezināma vieta' } });
    if (occupied.has(code)) return res.status(409).json({ error: { message: 'Vieta jau ir aizņemta' } });
    const rec = await store.blockSpot(code);
    await logEvent(store, rec.id, 'blocked', req.body?.comment, req);
    res.status(201).json(rec);
  }));
  // Unblock: remove the placeholder that was holding the spot.
  app.post('/api/storage/:id/unblock', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    if (rec.status !== 'blocked') return res.status(400).json({ error: { message: 'Šī vieta nav bloķēta' } });
    await store.deleteRecord(req.params.id);
    res.json({ ok: true });
  }));

  // --- Record history / comments (audit trail per record) ---
  app.get('/api/storage/:id/events', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    res.json({ events: await store.listEvents(req.params.id) });
  }));
  app.post('/api/storage/:id/events', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!comment) return res.status(400).json({ error: { message: 'Komentārs ir tukšs' } });
    const ev = await store.addEvent({ recordId: req.params.id, action: 'comment', comment: comment.slice(0, 500), actor: actorOf(req) });
    res.status(201).json({ ok: true, event: ev });
  }));
  app.patch('/api/events/:id', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 500) : '';
    const ev = await store.updateEvent(req.params.id, comment || null);
    if (!ev) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ ok: true, event: ev });
  }));
  app.delete('/api/events/:id', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const ok = await store.deleteEvent(req.params.id);
    if (!ok) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ ok: true });
  }));

  // --- Warehouse tasks (Noliktava) -------------------------------------------
  // One queue the warehouse worker looks at. Two things land in it: 'prepare'
  // jobs created automatically when staff stage a set for a swap, and free-text
  // 'order' requests typed into the warehouse chat box. Ticking a task done takes
  // it out of the list, so the open list is always "what still has to be fetched".
  const taskTitleFor = (r: StorageRecord) => (r.plate ?? r.location ?? 'Riepas').trim();
  const taskDetailsFor = (r: StorageRecord) => {
    const size2 = r.size2 ?? (r.notes?.match(/\b(\d{3}\/\d{1,2}\/\d{2})\b/)?.[1] ?? null);
    const tires = [r.quantity ? `${r.quantity}×` : '', canonBrand(r.brand) ?? '', r.size1 ?? '']
      .filter(Boolean).join(' ') + (size2 ? ` + ${size2}` : '');
    return [tires.trim() || null, r.customerName, r.rimNote].filter(Boolean).join(' · ') || null;
  };
  /** Announce a new job to every subscribed device. Fire-and-forget. */
  const announceTask = (t: { title: string; details: string | null; location: string | null; kind: string }) => {
    const what = t.kind === 'prepare' ? 'Sagatavot riepas' : 'Jauns pasūtījums';
    const body = [t.location ? `Vieta ${t.location}` : null, t.title, t.details].filter(Boolean).join(' · ');
    getStore()
      .then((s) => pushToAll(s, { title: `R1 · ${what}`, body: body.slice(0, 160), url: '/?view=warehouse', tag: 'r1-task' }))
      .catch(() => { /* notifications are best-effort */ });
  };

  app.get('/api/tasks', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const s = req.query.status;
    const status = s === 'done' ? 'done' : s === 'all' ? undefined : 'open';
    const tasks = await store.listTasks({ status, limit: status === 'done' ? 50 : 200 });
    const open = status === 'open' ? tasks.length : (await store.listTasks({ status: 'open', limit: 500 })).length;
    res.json({ tasks, open });
  }));

  app.post('/api/tasks', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text) return res.status(400).json({ error: { message: 'Ieraksti, ko vajag no noliktavas' } });
    // First line is the headline, the rest is detail — so a pasted multi-line
    // order still reads well in the list.
    const [first, ...rest] = text.split('\n');
    const task = await store.createTask({
      kind: 'order', recordId: null,
      title: first.trim().slice(0, 120),
      details: rest.join('\n').trim().slice(0, 800) || null,
      location: typeof b.location === 'string' && b.location.trim() ? b.location.trim().toUpperCase() : null,
      plate: typeof b.plate === 'string' && b.plate.trim() ? b.plate.trim().toUpperCase() : null,
      createdBy: actorOf(req),
    });
    announceTask(task);
    res.status(201).json({ ok: true, task });
  }));

  app.post('/api/tasks/:id/done', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const t = await store.setTaskStatus(req.params.id, 'done', actorOf(req));
    if (!t) return res.status(404).json({ error: { message: 'Uzdevums nav atrasts' } });
    res.json({ ok: true, task: t });
  }));

  app.post('/api/tasks/:id/reopen', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const t = await store.setTaskStatus(req.params.id, 'open', null);
    if (!t) return res.status(404).json({ error: { message: 'Uzdevums nav atrasts' } });
    res.json({ ok: true, task: t });
  }));

  app.delete('/api/tasks/:id', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const ok = await store.deleteTask(req.params.id);
    if (!ok) return res.status(404).json({ error: { message: 'Uzdevums nav atrasts' } });
    res.json({ ok: true });
  }));

  // --- Pricing settings (Iestatījumi) ---------------------------------------
  // Everyone may READ the rules (the intake screen mirrors them live); only an
  // admin may change them or reprice stored sets.
  app.get('/api/pricing', requireAuth, asyncH(async (_req, res) => {
    res.json({ pricing: await loadPricing(), defaults: DEFAULT_PRICING });
  }));

  app.put('/api/pricing', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const cfg = cleanPricing(req.body);
    if (!cfg.tiers.length) return res.status(400).json({ error: { message: 'Vajag vismaz vienu cenu diapazonu' } });
    // Overlapping ranges would make the price depend on row order — reject them
    // rather than silently letting the first match win.
    for (let i = 1; i < cfg.tiers.length; i++) {
      if (cfg.tiers[i].from <= cfg.tiers[i - 1].to) {
        return res.status(400).json({
          error: { message: `Diapazoni pārklājas: ${cfg.tiers[i - 1].from}–${cfg.tiers[i - 1].to} un ${cfg.tiers[i].from}–${cfg.tiers[i].to}` },
        });
      }
    }
    await store.setSetting('pricing', cfg);
    res.json({ ok: true, pricing: cfg });
  }));

  // Reprice stored sets with the current rules. Only sets still in storage are
  // touched — a released order keeps what the customer was actually charged.
  app.post('/api/pricing/recalculate', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const cfg = await loadPricing();
    const dryRun = req.query.dryRun === '1';
    const all = await store.list();
    const targets = all.filter((r) => r.status === 'active' || r.status === 'prepared');
    let changed = 0, unchanged = 0, skipped = 0;
    const sample: Array<{ plate: string | null; size: string | null; from: string | null; to: string }> = [];
    for (const r of targets) {
      const rim = /alum|liet/i.test(r.rimNote ?? '') ? 'aluminum' : /tērau|terau|dzelz/i.test(r.rimNote ?? '') ? 'steel' : 'none';
      const { total, width } = priceWith(cfg, r.size1, rim, r.size2);
      if (!width) { skipped++; continue; } // no readable size → nothing to price
      const next = String(total);
      if ((r.feeEur ?? '') === next) { unchanged++; continue; }
      if (sample.length < 8) sample.push({ plate: r.plate, size: r.size1, from: r.feeEur, to: next });
      if (!dryRun) await store.updateRecord(r.id, { feeEur: next });
      changed++;
    }
    res.json({ ok: true, dryRun, changed, unchanged, skipped, total: targets.length, sample });
  }));

  // --- Web Push registration (one row per device) ---
  app.get('/api/push/key', requireAuth, (_req, res) => {
    res.json({ enabled: pushEnabled(), publicKey: vapidPublicKey() });
  });
  app.post('/api/push/subscribe', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const b = (req.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
    const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh : '';
    const auth = typeof b.keys?.auth === 'string' ? b.keys.auth : '';
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: { message: 'Nederīga abonēšana' } });
    await store.addPushSub({ endpoint, p256dh, auth, username: actorOf(req) });
    res.json({ ok: true });
  }));
  app.post('/api/push/unsubscribe', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (endpoint) await store.deletePushSub(endpoint);
    res.json({ ok: true });
  }));

  // --- Storage containers (user-defined shelves/racks) ---
  app.get('/api/containers', requireAuth, asyncH(async (_req, res) => {
    const store = await getStore();
    res.json({ containers: await store.listContainers() });
  }));
  app.post('/api/containers', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const b = (req.body ?? {}) as { prefix?: unknown; label?: unknown; rows?: unknown; cols?: unknown };
    const prefix = String(b.prefix ?? '').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-ZĀ-Ž]{1,4}$/.test(prefix)) return res.status(400).json({ error: { message: 'Prefikss: 1–4 burti (piem. D)' } });
    const rows = Math.trunc(Number(b.rows));
    const cols = Math.trunc(Number(b.cols));
    if (!Number.isFinite(rows) || rows < 1 || rows > 99 || !Number.isFinite(cols) || cols < 1 || cols > 99)
      return res.status(400).json({ error: { message: 'Rindas un kolonnas: 1–99' } });
    if (rows * cols > 600) return res.status(400).json({ error: { message: 'Pārāk daudz vietu (maks. 600)' } });
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null;
    const existing = await store.listContainers();
    if (existing.some((c) => c.prefix === prefix)) return res.status(409).json({ error: { message: `Konteiners "${prefix}" jau eksistē` } });
    try {
      const created = await store.createContainer({ prefix, label, rows, cols });
      res.status(201).json({ ok: true, container: created });
    } catch {
      res.status(409).json({ error: { message: `Konteiners "${prefix}" jau eksistē` } });
    }
  }));
  app.delete('/api/containers/:id', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const ok = await store.deleteContainer(req.params.id);
    if (!ok) return res.status(404).json({ error: { message: 'Konteiners nav atrasts' } });
    res.json({ ok: true });
  }));

  // Pending swaps: every 'prepared' set, newest first, shaped for the sidebar.
  app.get('/api/pending', requireAuth, asyncH(async (_req, res) => {
    const store = await getStore();
    const recs = (await store.list({ status: 'prepared' }))
      .sort((a, b) => (b.preparedDate ?? '').localeCompare(a.preparedDate ?? ''));
    const items = recs.map((r) => ({
      id: r.id, plate: r.plate, cust: r.customerName, phone: r.phone, loc: r.location,
      size: r.size1, size2: r.size2, brand: r.brand, quantity: r.quantity, sms: r.smsCode,
      thread: r.threadDepth ? `${r.threadDepth} mm` : '—', season: r.season,
      preparedDate: r.preparedDate, intakeDate: r.intakeDate,
    }));
    res.json({ count: items.length, pending: items });
  }));

  // --- Excel import (admin only): parse the workbook and REPLACE the DB.
  // The file is parsed in memory and never stored; Excel is the source of truth.
  app.post('/api/import', requireAdmin, upload.single('file'), asyncH(async (req, res) => {
    const file = (req as express.Request & { file?: { buffer: Buffer } }).file;
    if (!file) return res.status(400).json({ error: { message: 'No file uploaded (field name: file)' } });
    let parsed;
    try {
      parsed = await parseWorkbook(file.buffer);
    } catch {
      return res.status(400).json({ error: { message: 'Could not read the file as an .xlsx workbook' } });
    }
    if (parsed.records.length === 0) {
      return res.status(400).json({ error: { message: 'Neatpazina nevienu derīgu lapu. Pārbaudi, vai fails ir tajā pašā formātā (VIETA, AUTO NR., IZMĒRS…).' } });
    }
    // Dry run: return what WOULD be imported (summary + a sample) without touching the DB.
    if (req.query.dryRun === '1' || req.query.preview === '1') {
      const sample = parsed.records.slice(0, 8).map((r) => ({
        season: r.season, location: r.location, plate: r.plate, makeModel: r.makeModel,
        customerName: r.customerName, size1: r.size1, size2: r.size2, brand: r.brand,
        quantity: r.quantity, status: r.status,
      }));
      return res.json({ ok: true, dryRun: true, sample, ...parsed.summary });
    }
    const store = await getStore();
    const { imported } = await store.replaceAll(parsed.records);
    res.json({ ok: true, imported, ...parsed.summary });
  }));

  // --- User management (admin only) — the in-app "login & password generator". ---
  const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
  const MIN_PW = 8;

  app.get('/api/users', requireAdmin, asyncH(async (_req, res) => {
    const store = await getStore();
    res.json({ users: await store.listUsers() });
  }));

  app.post('/api/users', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const { username, name, role, password } = req.body ?? {};
    const u = String(username ?? '').trim().toLowerCase();
    const nm = String(name ?? '').trim();
    const rl: 'admin' | 'staff' = role === 'admin' ? 'admin' : 'staff';
    if (!USERNAME_RE.test(u)) return res.status(400).json({ error: { message: 'Lietotājvārds: 3–32 rakstzīmes (a–z, 0–9, . _ -)' } });
    if (!nm) return res.status(400).json({ error: { message: 'Vārds ir obligāts' } });
    if (String(password ?? '').length < MIN_PW) return res.status(400).json({ error: { message: `Parolei jābūt vismaz ${MIN_PW} rakstzīmes` } });
    if (await store.getUserByUsername(u)) return res.status(409).json({ error: { message: 'Lietotājs ar šādu vārdu jau eksistē' } });
    await store.createUser({ username: u, name: nm, passwordHash: await hashPassword(String(password)), role: rl });
    res.json({ ok: true, user: { username: u, name: nm, role: rl } });
  }));

  app.post('/api/users/:username/reset', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const u = String(req.params.username ?? '').trim().toLowerCase();
    const { password } = req.body ?? {};
    if (String(password ?? '').length < MIN_PW) return res.status(400).json({ error: { message: `Parolei jābūt vismaz ${MIN_PW} rakstzīmes` } });
    if (!(await store.getUserByUsername(u))) return res.status(404).json({ error: { message: 'Lietotājs nav atrasts' } });
    await store.setPasswordByUsername(u, await hashPassword(String(password)));
    res.json({ ok: true });
  }));

  app.delete('/api/users/:username', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const u = String(req.params.username ?? '').trim().toLowerCase();
    const target = await store.getUserByUsername(u);
    if (!target) return res.status(404).json({ error: { message: 'Lietotājs nav atrasts' } });
    const me = (req as express.Request & { user?: { username: string } }).user;
    if (me && me.username === u) return res.status(400).json({ error: { message: 'Nevar dzēst savu kontu' } });
    if (target.role === 'admin') {
      const admins = (await store.listUsers()).filter((x) => x.role === 'admin').length;
      if (admins <= 1) return res.status(400).json({ error: { message: 'Nevar dzēst pēdējo administratoru' } });
    }
    await store.deleteUserByUsername(u);
    res.json({ ok: true });
  }));

  app.post('/api/change-password', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const me = (req as express.Request & { user?: { username: string } }).user;
    const { currentPassword, newPassword } = req.body ?? {};
    if (String(newPassword ?? '').length < MIN_PW) return res.status(400).json({ error: { message: `Jaunajai parolei jābūt vismaz ${MIN_PW} rakstzīmes` } });
    const user = me ? await store.getUserByUsername(String(me.username).toLowerCase()) : null;
    if (!user || !(await verifyPassword(String(currentPassword ?? ''), user.passwordHash))) {
      return res.status(401).json({ error: { message: 'Nepareiza pašreizējā parole' } });
    }
    await store.setPasswordByUsername(user.username, await hashPassword(String(newPassword)));
    res.json({ ok: true });
  }));

  // Static UI (also served on Vercel via the catch-all rewrite).
  app.use(express.static(join(__dirname, '..', 'public')));

  return app;
}
