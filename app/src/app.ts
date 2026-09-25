import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IntakeInput, StorageRecord, Store, PricingConfig, PricingTier, Role } from './types.js';
import { DEFAULT_PRICING, matches, cellMap, parseZones } from './types.js';
import { getStore } from './store.js';
import { parseWorkbook } from './importExcel.js';
import {
  COOKIE, signToken, verifyPassword, hashPassword, currentUser, requireAuth, requireStaff, requireAdmin, toSession,
  AUTH_DISABLED, DEMO_USER,
} from './auth.js';
import { pushToAll, pushEnabled, vapidPublicKey } from './push.js';
import { PERM_KEYS, ROLE_DEFAULTS, effectivePerms, bustPerms, requirePerm, requireAnyPerm, attachPerms, permsOf, redactRecord, redactAll, redactEventComment, type PermKey } from './perms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const asyncH = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((err) => {
      // The detail goes to the server log only — driver and SQL errors can carry
      // table names, values and connection details the client has no business seeing.
      console.error(`[api] ${req.method} ${req.path} failed:`, err);
      if (!res.headersSent) res.status(500).json({ error: { message: 'Servera kļūda. Mēģini vēlreiz.' } });
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
  // Permission gates bound to this app's store.
  const P = (key: PermKey) => requirePerm(getStore, key);
  const PAny = (keys: PermKey[]) => requireAnyPerm(getStore, keys);
  const PAttach = attachPerms(getStore);
  app.use(express.json());
  app.use(cookieParser());

  // --- Auth ---
  // Brute-force guard. Failures are counted per username in the settings table, so
  // the count holds across serverless instances; a second, per-IP count in memory
  // slows down one client spraying many usernames at the same instance.
  const LOGIN_MAX_FAILS = 5;
  const LOGIN_IP_MAX_FAILS = 20;
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const ipFails = new Map<string, { n: number; first: number }>();
  type FailRec = { n: number; first: number };
  const failKey = (u: string) => `login_fail:${u}`;
  const readFails = async (store: Store, u: string): Promise<FailRec | null> => {
    try {
      const v = (await store.getSetting(failKey(u))) as FailRec | null;
      return v && Date.now() - v.first < LOGIN_WINDOW_MS ? v : null;
    } catch { return null; }
  };
  const minutesLeft = (first: number) => Math.max(1, Math.ceil((first + LOGIN_WINDOW_MS - Date.now()) / 60000));
  const tooMany = (res: express.Response, first: number) =>
    res.status(429).json({ error: { message: `Pārāk daudz neveiksmīgu mēģinājumu. Mēģini vēlreiz pēc ${minutesLeft(first)} min.` } });

  app.post('/api/login', asyncH(async (req, res) => {
    const store = await getStore();
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ error: { message: 'Username and password required' } });
    // Case-insensitive username (guards against mobile auto-capitalization).
    const uname = String(username).trim().toLowerCase();
    const ip = req.ip ?? 'unknown';
    const ipRec = ipFails.get(ip);
    if (ipRec && Date.now() - ipRec.first < LOGIN_WINDOW_MS && ipRec.n >= LOGIN_IP_MAX_FAILS) return tooMany(res, ipRec.first);
    const fails = await readFails(store, uname);
    if (fails && fails.n >= LOGIN_MAX_FAILS) return tooMany(res, fails.first);
    const user = await store.getUserByUsername(uname);
    if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
      const next = fails ? { n: fails.n + 1, first: fails.first } : { n: 1, first: Date.now() };
      try { await store.setSetting(failKey(uname), next); } catch { /* store without settings */ }
      const ipNext = ipRec && Date.now() - ipRec.first < LOGIN_WINDOW_MS ? { n: ipRec.n + 1, first: ipRec.first } : { n: 1, first: Date.now() };
      if (ipFails.size > 5000) ipFails.clear(); // bounded memory; the per-user count is the real guard
      ipFails.set(ip, ipNext);
      return res.status(401).json({ error: { message: 'Invalid username or password' } });
    }
    if (fails) { try { await store.setSetting(failKey(uname), { n: 0, first: 0 }); } catch { /* ignore */ } }
    const session = toSession(user);
    const token = signToken(session);
    res.cookie(COOKIE, token, cookieOpts);
    const perms = await effectivePerms(store, session);
    // Also return the token so the SPA can store it and send it as a Bearer
    // header — this keeps login working even when the browser blocks cookies.
    res.json({ user: session, token, perms });
  }));

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
    res.json({ ok: true });
  });

  app.get('/api/me', asyncH(async (req, res) => {
    if (AUTH_DISABLED()) {
      const all = Object.fromEntries(PERM_KEYS.map((k) => [k, true]));
      return res.json({ user: DEMO_USER, perms: all });
    }
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: { message: 'Not authenticated' } });
    res.json({ user: u, perms: await effectivePerms(await getStore(), u) });
  }));

  app.get('/api/health', asyncH(async (_req, res) => {
    const store = await getStore();
    res.json({ ok: true, store: store.kind() });
  }));

  // --- Data (auth required) ---
  app.get('/api/storage', P('screen.table'), asyncH(async (req, res) => {
    const store = await getStore();
    const status = req.query.status === 'released' ? 'released' : req.query.status === 'active' ? 'active' : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const records = redactAll(await store.list({ status, q }), permsOf(req));
    res.json({ count: records.length, records });
  }));

  app.get('/api/storage/:id', requireAuth, PAttach, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(redactRecord(rec, permsOf(req)));
  }));

  // Manual edit of a record's data fields (Tabula). Only allowlisted keys are applied.
  app.patch('/api/storage/:id', P('act.edit'), asyncH(async (req, res) => {
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

  app.get('/api/lookup', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const raw = typeof req.query.plate === 'string' ? req.query.plate : '';
    const plate = raw.toUpperCase().replace(/\s+/g, '');
    if (!plate) return res.status(400).json({ error: { message: 'plate is required' } });
    const all = redactAll(await store.list({ q: plate }), permsOf(req));
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
  app.get('/api/plate-suggest', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const q = String(req.query.q ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (q.length < 2) return res.json({ suggestions: [] });
    const all = redactAll(await store.list({ q }), permsOf(req));
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

  // Company typeahead for intake: distinct company names already on file, so a
  // returning company is picked rather than retyped into a second spelling.
  app.get('/api/company-suggest', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const q = String(req.query.q ?? '').trim().toUpperCase();
    const perms = permsOf(req);
    // The suggestions ARE customer names — nothing to offer without that field.
    if (!perms['field.customer']) return res.json({ suggestions: [] });
    const all = redactAll(await store.list(), perms);
    const seen = new Map<string, { name: string; plates: Set<string>; phone: string | null; last: string; count: number }>();
    for (const r of all) {
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
    const suggestions = [...seen.values()]
      .sort((a, b) => {
        const ap = a.name.toUpperCase().startsWith(q) ? 0 : 1, bp = b.name.toUpperCase().startsWith(q) ? 0 : 1;
        return ap - bp || b.count - a.count || a.name.localeCompare(b.name, 'lv');
      })
      .slice(0, 8)
      .map((e) => ({ name: e.name, phone: e.phone, vehicles: e.plates.size, count: e.count, last: e.last || null }));
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
    // A place carries rows from every season it has ever been used in, so the one
    // that decides what the grid shows must be the CURRENT holder. `list()` returns
    // id DESC, which for the imported workbook is OLDEST sheet first — taking the
    // first match surfaced a 2022 placeholder instead of this season's customer.
    const holdsSpot = (r: StorageRecord) => r.status === 'active' || r.status === 'prepared' || r.status === 'blocked';
    // A row with real content outranks a bare placeholder; then the later intake
    // wins; then the row touched most recently.
    const substance = (r: StorageRecord) => (r.plate || r.size1 || r.customerName ? 1 : 0);
    const current = (a: StorageRecord, b: StorageRecord) => {
      if (substance(a) !== substance(b)) return substance(a) > substance(b) ? a : b;
      const ad = a.intakeDate ?? '', bd = b.intakeDate ?? '';
      if (ad !== bd) return ad > bd ? a : b;
      return Number(a.id) > Number(b.id) ? a : b;
    };
    for (const r of all) {
      const code = (r.location ?? '').toUpperCase();
      const m = code.match(SPOT_RE);
      if (!m) continue;
      if (!seen.has(code)) seen.set(code, { code, c: m[1], n: Number(m[2]) });
      // Stored ('active'), staged-for-swap ('prepared') and manually 'blocked' spots all hold the spot.
      if (!holdsSpot(r)) continue;
      const prev = occupied.get(code);
      occupied.set(code, prev ? current(prev, r) : r);
    }
    // Add every place from user-defined containers, so empty containers appear too.
    // A place is numbered by its POSITION in the grid, so switching a cell off
    // never renumbers the places around it — but a place may carry a CUSTOM NAME
    // (renamed by the admin), stored in the def's names map by position.
    // `layouts` keeps the grid order (cell descriptor or null per position) so the
    // UI can draw the shape with its holes and merged zones.
    type LayoutCell = { code: string; zone?: { name: string; cap: number; span: number; hspan: number } } | { fill: true; code?: undefined } | null;
    const layouts = new Map<string, LayoutCell[]>();
    const zoneCaps = new Map<string, number>();
    for (const d of defs) {
      const map = cellMap(d);
      let names: Record<string, string> = {};
      try { names = d.names ? JSON.parse(d.names) : {}; } catch { /* ignore bad json */ }
      const zones = parseZones(d.zones);
      const zoneAt = new Map<number, { name: string; cap: number; first: number; size: number }>();
      for (const z of zones) {
        const cells = z.cells.filter((i) => i < map.length && map[i]).sort((a, b) => a - b);
        if (!cells.length) continue;
        const zi = { name: z.name, cap: z.cap, first: cells[0], size: cells.length };
        cells.forEach((i) => zoneAt.set(i, zi));
        zoneCaps.set(z.name, z.cap);
        if (!seen.has(z.name)) seen.set(z.name, { code: z.name, c: d.prefix, n: cells[0] + 1 });
      }
      const layout: LayoutCell[] = [];
      map.forEach((on, i) => {
        if (!on) { layout.push(null); return; }
        const z = zoneAt.get(i);
        if (z) {
          // First zone cell renders the zone; the rest are 'fill' so the client can
          // stretch the zone button across them instead of leaving holes.
          layout.push(i === z.first ? { code: z.name, zone: { name: z.name, cap: z.cap, span: z.size, hspan: 1 } } : { fill: true });
          return;
        }
        const code = (names[String(i)] || `${d.prefix}${i + 1}`).toUpperCase();
        layout.push({ code });
        if (!seen.has(code)) seen.set(code, { code, c: d.prefix, n: i + 1 });
      });
      // hspan: how many cells the zone button may stretch horizontally — the run of
      // its own fill cells immediately to its right in the same row.
      layout.forEach((c, i) => {
        if (!c || !('zone' in c) || !c.zone) return;
        let h = 1;
        const row = Math.floor(i / d.cols);
        for (let j = i + 1; j < layout.length && Math.floor(j / d.cols) === row; j++) {
          const nx = layout[j];
          if (nx && 'fill' in nx && nx.fill) h++; else break;
        }
        c.zone.hspan = h;
      });
      layouts.set(d.prefix, layout);
    }
    const spots = [...seen.values()].sort((a, b) => a.c.localeCompare(b.c) || a.n - b.n);
    // A zone holds up to `cap` sets: it is "free" until that many records sit there.
    const zoneLoad = new Map<string, StorageRecord[]>();
    for (const r of all) {
      const code = (r.location ?? '').toUpperCase();
      if (!zoneCaps.has(code)) continue;
      if (r.status === 'active' || r.status === 'prepared' || r.status === 'blocked') {
        if (!zoneLoad.has(code)) zoneLoad.set(code, []);
        zoneLoad.get(code)!.push(r);
      }
    }
    for (const [name, cap] of zoneCaps) {
      const load = (zoneLoad.get(name) ?? []).length;
      if (load < cap) occupied.delete(name); // below capacity → still assignable
    }
    return { spots, occupied, all, defs, layouts, zoneCaps, zoneLoad };
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
      // Everything else the row holds, so the client view can show the full picture.
      sms: r.smsCode, rims: r.rimNote, notes: r.notes, makeModel: r.makeModel,
      size1: r.size1, size2, quantity: r.quantity, brand: canonBrand(r.brand),
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
  app.get('/api/stats', PAny(['screen.home','screen.spots','screen.intake']), asyncH(async (req, res) => {
    const { spots, occupied, all, defs, layouts, zoneCaps, zoneLoad } = await spotUniverse();
    // The spot map shows who sits where: it goes out under the same field rules as
    // any record payload, or the floor roles would read names and SMS codes here.
    const perms = permsOf(req);
    const custOf = (r: StorageRecord) => (perms['field.customer'] ? r.customerName : null);
    const smsOf = (r: StorageRecord) => (perms['field.sms'] ? r.smsCode : null);
    const defByPrefix = new Map(defs.map((d) => [d.prefix, d]));
    const spotView = (code: string, zone?: { name: string; cap: number; span: number; hspan: number }) => {
      if (zone) {
        // A zone is one place holding several sets: report the load against the cap.
        const recs = zoneLoad.get(zone.name) ?? [];
        return {
          code: zone.name, zone: true, cap: zone.cap, count: recs.length, span: zone.span, hspan: zone.hspan,
          occ: recs.length >= zone.cap, reserved: false, blocked: false, hasRims: false,
          plates: recs.slice(0, 6).map((r) => r.plate).filter(Boolean),
          recs: recs.slice(0, 20).map((r) => ({ id: r.id, plate: r.plate, cust: custOf(r), size: r.size1, brand: r.brand, status: r.status })),
        };
      }
      const r = occupied.get(code);
      return r
        ? { code, occ: true, reserved: r.status === 'prepared', blocked: r.status === 'blocked', hasRims: !!r.rimNote, id: r.id, plate: r.plate, cust: custOf(r), brand: r.brand, size: r.size1, sms: smsOf(r), thread: r.threadDepth }
        : { code, occ: false };
    };
    // Capacity bookkeeping: a zone contributes `cap` places and its load, not 0/1.
    const zoneOf = (code: string) => zoneCaps.has(code);
    const byC = new Map<string, { letter: string; spots: unknown[]; occ: number; cap: number }>();
    for (const s of spots) {
      if (!byC.has(s.c)) byC.set(s.c, { letter: s.c, spots: [], occ: 0, cap: 0 });
      const g = byC.get(s.c)!;
      if (zoneOf(s.code)) {
        g.cap += zoneCaps.get(s.code)!;
        g.occ += Math.min((zoneLoad.get(s.code) ?? []).length, zoneCaps.get(s.code)!);
      } else {
        g.cap += 1;
        if (occupied.get(s.code)) g.occ++;
      }
      // The flat list must know zones too — the click-through panel reads it.
      g.spots.push(zoneOf(s.code)
        ? spotView(s.code, { name: s.code, cap: zoneCaps.get(s.code)!, span: 0, hspan: 1 })
        : spotView(s.code));
    }
    const containers = [...byC.values()]
      .map((g) => {
        const d = defByPrefix.get(g.letter);
        // `cells` is the drawn grid in reading order — null where the rack has a
        // hole — so the UI renders an L-shape as an L-shape. Containers that exist
        // only because records mention them have no drawing, so cells === spots.
        const layout = d ? layouts.get(d.prefix) : null;
        const cells = layout
          ? layout.map((c) => (c ? ('fill' in c && c.fill ? { zoneFill: true } : spotView(c.code!, 'zone' in c ? c.zone : undefined)) : null))
          : g.spots;
        return {
          ...g, cells, total: g.cap, cols: d?.cols ?? 4, rows: d?.rows ?? null,
          label: d?.label ?? null, defId: d?.id ?? null, drawn: d?.cells ?? null,
          zones: d ? parseZones(d.zones) : [], names: d?.names ?? null,
        };
      })
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const totalCap = containers.reduce((a, c) => a + c.total, 0);
    const occ = containers.reduce((a, c) => a + c.occ, 0);
    const reserved = [...occupied.values()].filter((r) => r.status === 'prepared').length;
    const today = new Date().toISOString().slice(0, 10);
    const firstFree = spots.find((s) => !occupied.has(s.code) && !zoneOf(s.code));
    const revenue = all.filter((r) => r.status === 'active' && r.feeEur).reduce((a, r) => a + (parseFloat(r.feeEur!) || 0), 0);
    res.json({
      occ, total: totalCap, free: totalCap - occ, reserved,
      capPct: totalCap ? Math.round((occ / totalCap) * 100) : 0,
      todayIntakes: all.filter((r) => r.intakeDate === today).length,
      smsIssued: all.filter((r) => r.smsCode).length,
      revenueActive: perms['field.price'] ? Math.round(revenue * 100) / 100 : null,
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
  const analyticsData = async (req: express.Request) => {
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
    return {
      total: all.length,
      active: all.filter((r) => r.status === 'active').length,
      prepared: all.filter((r) => r.status === 'prepared').length,
      released: all.filter((r) => r.status === 'released').length,
      withSecondSize: withSecond,
      seasonOptions, selectedSeason,
      filters: { status: fStatus, customer: fCustomer, rims: fRims },
      makes: top(makes), models: top(models), sizes: top(sizes),
      brands: top(brands), seasons: top(seasons, 30), quantities: top(quantities),
    };
  };

  app.get('/api/analytics', P('screen.analytics'), asyncH(async (req, res) => {
    res.json(await analyticsData(req));
  }));

  // Recent activity feed (intakes + releases by date).
  app.get('/api/activity', P('screen.home'), asyncH(async (req, res) => {
    const perms = permsOf(req);
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
      ev.push({ type: e.action, plate: r?.plate ?? null, loc: r?.location ?? null, d: e.createdAt ?? '', comment: redactEventComment(e.action, e.comment, perms), actor: e.actor });
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
    // Timestamps arrive in three shapes: a plain date from an intake/release column,
    // an ISO string from Postgres, and "YYYY-MM-DD HH:MM:SS" from SQLite. The last
    // one used to parse as NaN and sort as epoch 0, dropping every logged action to
    // the bottom of the list, below records from years back.
    const tms = (d: string) => {
      if (!d) return 0;
      let s = d.trim().replace(' ', 'T');
      if (!s.includes('T')) s += 'T00:00:00';
      if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';   // a naive timestamp is UTC
      const t = Date.parse(s);
      return Number.isNaN(t) ? 0 : t;
    };
    ev.sort((a, b) => tms(b.d || '') - tms(a.d || ''));
    res.json({ events: ev.slice(0, 12) });
  }));

  // Full history — the activity feed without its 12-row cap. Everything that ever
  // happened, filterable by date range, action type and free text, paged so the
  // client can scroll back as far as the data goes. Each entry carries recordId so
  // the UI can open the full record (data, comments, photos) behind it.
  const buildHistory = async (req: express.Request) => {
    const store = await getStore();
    const perms = permsOf(req);
    const all = await store.list();
    const byId = new Map(all.map((r) => [String(r.id), r]));
    type H = { type: string; d: string; plate: string | null; loc: string | null; recordId: string | null; comment: string | null; actor: string | null; cust: string | null; tires: string | null };
    const ev: H[] = [];
    const tiresOf = (r?: StorageRecord) => r ? [r.quantity ? `${r.quantity}×` : '', canonBrand(r.brand) ?? '', r.size1 ?? ''].filter(Boolean).join(' ') || null : null;
    const events = await store.recentEvents(5000);
    const hasCreated = new Set<string>();
    const hasReleased = new Set<string>();
    for (const e of events) {
      const r = byId.get(String(e.recordId));
      if (e.action === 'created') hasCreated.add(String(e.recordId));
      if (e.action === 'released' || e.action === 'swapped') hasReleased.add(String(e.recordId));
      ev.push({ type: e.action, d: e.createdAt ?? '', plate: r?.plate ?? null, loc: r?.location ?? null, recordId: r ? String(r.id) : null, comment: redactEventComment(e.action, e.comment, perms), actor: e.actor, cust: perms['field.customer'] ? (r?.customerName ?? null) : null, tires: tiresOf(r) });
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const r of all) {
      if (r.intakeDate && r.intakeDate <= today && !hasCreated.has(String(r.id)))
        ev.push({ type: 'in', d: r.intakeDate, plate: r.plate, loc: r.location, recordId: String(r.id), comment: null, actor: null, cust: perms['field.customer'] ? r.customerName : null, tires: tiresOf(r) });
      if (r.releaseDate && r.releaseDate <= today && !hasReleased.has(String(r.id)))
        ev.push({ type: 'out', d: r.releaseDate, plate: r.plate, loc: r.location, recordId: String(r.id), comment: null, actor: null, cust: perms['field.customer'] ? r.customerName : null, tires: tiresOf(r) });
    }
    // Filters. Dates compare on the date part, so a full-timestamp event on the
    // "to" day is still included.
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const types = typeof req.query.types === 'string' && req.query.types ? new Set(req.query.types.split(',')) : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase() : '';
    let list = ev;
    if (from) list = list.filter((e) => e.d.slice(0, 10) >= from);
    if (to) list = list.filter((e) => e.d.slice(0, 10) <= to);
    if (types) list = list.filter((e) => types.has(e.type));
    if (q) list = list.filter((e) => [e.plate, e.loc, e.cust, e.comment, e.actor].some((f) => (f ?? '').toUpperCase().includes(q)));
    // Timestamps arrive in three shapes: a plain date from an intake/release column,
    // an ISO string from Postgres, and "YYYY-MM-DD HH:MM:SS" from SQLite. The last
    // one used to parse as NaN and sort as epoch 0, dropping every logged action to
    // the bottom of the list, below records from years back.
    const tms = (d: string) => {
      if (!d) return 0;
      let s = d.trim().replace(' ', 'T');
      if (!s.includes('T')) s += 'T00:00:00';
      if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';   // a naive timestamp is UTC
      const t = Date.parse(s);
      return Number.isNaN(t) ? 0 : t;
    };
    list.sort((a, b) => tms(b.d) - tms(a.d));
    return list;
  };

  app.get('/api/history', P('screen.history'), asyncH(async (req, res) => {
    const list = await buildHistory(req);
    const PAGE = 50;
    const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
    res.json({
      total: list.length, page, pages: Math.max(1, Math.ceil(list.length / PAGE)),
      events: list.slice((page - 1) * PAGE, page * PAGE),
    });
  }));

  // Customers view: grouped by name+plate with storage history.
  app.get('/api/customers', P('screen.customers'), asyncH(async (req, res) => {
    const store = await getStore();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase() : '';
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    let all = redactAll(await store.list(q ? { q } : undefined), permsOf(req));
    if (type === 'company') all = all.filter((r) => r.isCompany);
    else if (type === 'private') all = all.filter((r) => !r.isCompany);
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

  // Reclassify a whole customer at once. The importer guesses company-vs-private
  // from the sheet and gets it wrong for names like "Sandijs"; a customer with
  // hundreds of visits can't be corrected record by record.
  app.post('/api/customers/type', P('screen.customers'), asyncH(async (req, res) => {
    const store = await getStore();
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: { message: 'Trūkst klienta vārda' } });
    const isCompany = !!req.body?.isCompany;
    const changed = await store.setCustomerType(name, isCompany);
    res.json({ ok: true, changed, isCompany });
  }));

  // Full storage history for a single vehicle (all seasons), for the spot panel.
  app.get('/api/vehicle', PAny(['screen.spots','screen.customers']), asyncH(async (req, res) => {
    const store = await getStore();
    const plate = String(req.query.plate ?? '').toUpperCase().replace(/\s+/g, '');
    if (!plate) return res.status(400).json({ error: { message: 'plate is required' } });
    const recs = redactAll(await store.list({ q: plate }), permsOf(req))
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
  app.get('/api/release-lookup', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const q = String(req.query.q ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (!q) return res.json({ q: '', results: [] });
    const perms = permsOf(req);
    const active = await store.list({ status: 'active' });
    const norm = (s: string | null) => String(s ?? '').toUpperCase().replace(/\s+/g, '');
    // Most recently stored first: when a plate matches several seasons, the set
    // that came in last is the one being asked about.
    const newest = (a: StorageRecord, b: StorageRecord) =>
      String(b.intakeDate ?? '').localeCompare(String(a.intakeDate ?? '')) || (Number(b.id) || 0) - (Number(a.id) || 0);
    const exact = active.filter((r) => norm(r.smsCode) === q || norm(r.plate) === q || norm(r.location) === q).sort(newest);
    const chosen = exact.length
      ? exact
      : active.filter((r) => norm(r.plate).includes(q) || norm(r.smsCode).includes(q)).sort(newest).slice(0, 20);
    // Matching above may use the SMS code (that is how customers identify
    // themselves); only the payload is cut down to what this user may see.
    const results = redactAll(chosen, perms).map((r) => ({
      id: r.id, plate: r.plate, cust: r.customerName, phone: r.phone, loc: r.location,
      size: r.size1, size2: r.size2, brand: r.brand, quantity: r.quantity, sms: r.smsCode,
      thread: r.threadDepth ? `${r.threadDepth} mm` : '—',
      fee: r.feeEur ? `€${Number(r.feeEur).toFixed(2).replace('.', ',')}` : '—',
      intakeDate: r.intakeDate, season: r.season,
    }));
    res.json({ q, results });
  }));

  app.post('/api/intake', P('act.operate'), asyncH(async (req, res) => {
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
    // Hand the shelving to the warehouse: a 'store' job saying which place this
    // set must go INTO. Ticking it done = the tires are physically on the shelf.
    try {
      const task = await store.createTask({
        kind: 'store', recordId: String(rec.id), title: taskTitleFor(rec),
        details: taskDetailsFor(rec), location: rec.location, plate: rec.plate,
        createdBy: actorOf(req),
      });
      announceTask(task);
    } catch (e) { console.error('[tasks] could not queue store job:', e); }
    res.status(201).json(rec);
  }));

  app.post('/api/storage/:id/release', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.release(req.params.id, { releaseDate: req.body?.releaseDate });
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    await logEvent(store, rec.id, 'released', req.body?.comment, req);
    // The set has left the building — any warehouse job for it is settled.
    try { await store.closeTasksForRecord(String(rec.id), actorOf(req)); } catch { /* non-critical */ }
    res.json(rec);
  }));

  // Stage a set for a seasonal swap: tires out, spot stays reserved ('prepared').
  app.post('/api/storage/:id/prepare', P('act.operate'), asyncH(async (req, res) => {
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
  app.post('/api/storage/:id/unprepare', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.prepare(req.params.id, { active: true });
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    await logEvent(store, rec.id, 'unprepared', req.body?.comment, req);
    // The job is off the table — take it out of the warehouse list too.
    try { await store.closeTasksForRecord(String(rec.id), actorOf(req)); } catch { /* non-critical */ }
    res.json(rec);
  }));

  // Rename a place. Codes stay automatic (prefix + position) until someone does
  // this; then the custom name wins. Every record on the old code moves with it,
  // so occupancy and history follow the physical place, not the label.
  app.post('/api/spots/:code/rename', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const from = String(req.params.code).toUpperCase().replace(/\s+/g, '');
    const to = String(req.body?.name ?? '').toUpperCase().replace(/\s+/g, '');
    // Free-form names: letters, digits and dashes, up to 10 chars ("PLAUKTS-1").
    if (!/^[A-ZĀ-Ž0-9-]{1,10}$/.test(to) || !/[A-ZĀ-Ž0-9]/.test(to)) {
      return res.status(400).json({ error: { message: 'Nosaukums: 1–10 burti/cipari/domuzīmes (piem. B7 vai PLAUKTS-1)' } });
    }
    if (from === to) return res.json({ ok: true, changed: 0, name: to });
    const { spots, layouts, defs } = await spotUniverse();
    if (!spots.some((s) => s.code === from)) return res.status(404).json({ error: { message: 'Vieta nav atrasta' } });
    if (spots.some((s) => s.code === to)) return res.status(409).json({ error: { message: `Vieta ${to} jau eksistē` } });
    // If the place belongs to a drawn container, persist the name by position so
    // it survives with no record to carry it. Any name works here — the layout
    // itself keeps the place on the grid.
    let inDrawn = false;
    for (const d of defs) {
      const layout = layouts.get(d.prefix) ?? [];
      const idx = layout.findIndex((c) => c && c.code === from && !('zone' in c && c.zone));
      if (idx >= 0) {
        inDrawn = true;
        let names: Record<string, string> = {};
        try { names = d.names ? JSON.parse(d.names) : {}; } catch { /* ignore */ }
        // Renaming back to the automatic code just clears the alias.
        if (to === `${d.prefix}${idx + 1}`) delete names[String(idx)];
        else names[String(idx)] = to;
        await store.updateContainer(d.id, { names: Object.keys(names).length ? JSON.stringify(names) : null });
        break;
      }
    }
    // A spot that exists only through its records has nothing to anchor a
    // free-form name to — the grid reconstructs it from "letters + number", so
    // any other shape would drop it off the Novietnes map entirely.
    if (!inDrawn && !SPOT_RE.test(to)) {
      return res.status(400).json({
        error: { message: 'Šī vieta nav uzzīmētā konteinerā, tāpēc nosaukumam jābūt burti+numurs (piem. B7). Brīvs nosaukums iespējams vietām, kuru konteiners ir izveidots sadaļā Novietnes.' },
      });
    }
    const changed = await store.renameLocation(from, to);
    res.json({ ok: true, changed, name: to });
  }));

  // Manually block/reserve an empty spot (no tires) so it's unavailable.
  app.post('/api/spots/:code/block', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const code = String(req.params.code).toUpperCase().replace(/\s+/g, '');
    // Membership in the spot universe is the real check — custom-named places
    // (PLAUKTS-1) don't match the letters+number pattern but are perfectly valid.
    const { spots, occupied } = await spotUniverse();
    if (!spots.some((s) => s.code === code)) return res.status(404).json({ error: { message: 'Nezināma vieta' } });
    if (occupied.has(code)) return res.status(409).json({ error: { message: 'Vieta jau ir aizņemta' } });
    const rec = await store.blockSpot(code);
    await logEvent(store, rec.id, 'blocked', req.body?.comment, req);
    res.status(201).json(rec);
  }));
  // Unblock: remove the placeholder that was holding the spot.
  app.post('/api/storage/:id/unblock', P('act.operate'), asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    if (rec.status !== 'blocked') return res.status(400).json({ error: { message: 'Šī vieta nav bloķēta' } });
    await store.deleteRecord(req.params.id);
    res.json({ ok: true });
  }));

  // --- Record history / comments (audit trail per record) ---
  app.get('/api/storage/:id/events', requireAuth, PAttach, asyncH(async (req, res) => {
    const store = await getStore();
    const perms = permsOf(req);
    const events = (await store.listEvents(req.params.id)).map((e) => ({ ...e, comment: redactEventComment(e.action, e.comment, perms) }));
    res.json({ events });
  }));
  app.post('/api/storage/:id/events', P('act.media'), asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!comment) return res.status(400).json({ error: { message: 'Komentārs ir tukšs' } });
    const ev = await store.addEvent({ recordId: req.params.id, action: 'comment', comment: comment.slice(0, 500), actor: actorOf(req) });
    res.status(201).json({ ok: true, event: ev });
  }));
  app.patch('/api/events/:id', P('act.media'), asyncH(async (req, res) => {
    const store = await getStore();
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 500) : '';
    const ev = await store.updateEvent(req.params.id, comment || null);
    if (!ev) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ ok: true, event: ev });
  }));
  app.delete('/api/events/:id', P('act.media'), asyncH(async (req, res) => {
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
    const what = t.kind === 'prepare' ? 'Sagatavot riepas' : t.kind === 'store' ? 'Novietot glabāšanā' : 'Jauns pasūtījums';
    const body = [t.location ? (t.kind === 'prepare' ? `Vieta ${t.location}` : t.location) : null, t.title, t.details].filter(Boolean).join(' · ');
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
  app.get('/api/pricing', P('act.operate'), asyncH(async (_req, res) => {
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
  app.get('/api/push/key', requireAuth, asyncH(async (_req, res) => {
    let devices = 0;
    try { devices = (await (await getStore()).listPushSubs()).length; } catch { /* not fatal */ }
    res.json({ enabled: pushEnabled(), publicKey: vapidPublicKey(), devices });
  }));

  // Prove the whole chain works without having to order something for real.
  app.post('/api/push/test', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    if (!pushEnabled()) return res.status(400).json({ error: { message: 'Paziņojumi nav konfigurēti (trūkst VAPID atslēgu)' } });
    const devices = (await store.listPushSubs()).length;
    if (!devices) return res.status(400).json({ error: { message: 'Neviena ierīce nav pieteikta. Nospied “Paziņojumi” Noliktavas skatā.' } });
    const who = actorOf(req);
    const { sent, failed } = await pushToAll(store, {
      title: 'R1 · Tests',
      body: `Paziņojumi darbojas${who ? ` · pārbaudīja ${who}` : ''}`,
      url: '/?view=warehouse', tag: 'r1-test',
    });
    res.json({ ok: true, devices, sent, failed });
  }));
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

  // --- Record photos ------------------------------------------------------
  // Pictures of the set as handed in — tread, damage, the rims. The client
  // downscales before upload, so rows stay small enough to live in the database
  // and there is no second service to configure.
  const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

  app.get('/api/storage/:id/photos', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const photos = await store.listPhotos(req.params.id);
    res.json({ photos: photos.map((p) => ({ ...p, url: `/api/photos/${p.id}` })) });
  }));

  app.post('/api/storage/:id/photos', P('act.media'), photoUpload.single('photo'), asyncH(async (req, res) => {
    const store = await getStore();
    const file = (req as express.Request & { file?: { buffer: Buffer; mimetype: string } }).file;
    if (!file) return res.status(400).json({ error: { message: 'Fails nav pievienots' } });
    if (!PHOTO_TYPES.has(file.mimetype)) return res.status(400).json({ error: { message: 'Atļauti tikai JPG, PNG vai WEBP attēli' } });
    const rec = await store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: { message: 'Ieraksts nav atrasts' } });
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; };
    const photo = await store.addPhoto({
      recordId: String(rec.id), mime: file.mimetype, data: file.buffer,
      width: num(req.body?.width), height: num(req.body?.height), createdBy: actorOf(req),
    });
    await logEvent(store, String(rec.id), 'photo', null, req); // the label already says it
    res.status(201).json({ ok: true, photo: { ...photo, url: `/api/photos/${photo.id}` } });
  }));

  // Serving the bytes. Images are immutable once stored (a new photo gets a new
  // id), so they can be cached hard despite the app's global no-store header.
  app.get('/api/photos/:id', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const p = await store.getPhoto(req.params.id);
    if (!p) return res.status(404).json({ error: { message: 'Bilde nav atrasta' } });
    res.setHeader('Content-Type', p.mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(p.data);
  }));

  app.delete('/api/photos/:id', P('act.media'), asyncH(async (req, res) => {
    const store = await getStore();
    const ok = await store.deletePhoto(req.params.id);
    if (!ok) return res.status(404).json({ error: { message: 'Bilde nav atrasta' } });
    res.json({ ok: true });
  }));

  // --- Storage containers (user-defined shelves/racks) ---
  app.get('/api/containers', PAny(['screen.spots','screen.intake']), asyncH(async (_req, res) => {
    const store = await getStore();
    res.json({ containers: await store.listContainers() });
  }));
  // Validate a grid + drawn shape. `cells` arrives as a '1'/'0' string, one char
  // per grid position; anything shorter is padded with "present".
  const readGrid = (b: Record<string, unknown>) => {
    const rows = Math.trunc(Number(b.rows));
    const cols = Math.trunc(Number(b.cols));
    if (!Number.isFinite(rows) || rows < 1 || rows > 99 || !Number.isFinite(cols) || cols < 1 || cols > 99) {
      return { error: 'Rindas un kolonnas: 1–99' } as const;
    }
    if (rows * cols > 600) return { error: 'Pārāk liels konteiners (maks. 600 rūtiņas)' } as const;
    const total = rows * cols;
    let cells: string | null = null;
    if (typeof b.cells === 'string' && b.cells.length) {
      const raw = b.cells.replace(/[^01]/g, '');
      cells = raw.length >= total ? raw.slice(0, total) : raw.padEnd(total, '1');
      if (!cells.includes('1')) return { error: 'Jāatzīmē vismaz viena vieta' } as const;
      if (!cells.includes('0')) cells = null; // a full grid needs no drawing stored
    }
    return { rows, cols, cells } as const;
  };

  app.post('/api/containers', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const prefix = String(b.prefix ?? '').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-ZĀ-Ž]{1,4}$/.test(prefix)) return res.status(400).json({ error: { message: 'Prefikss: 1–4 burti (piem. D)' } });
    const grid = readGrid(b);
    if ('error' in grid) return res.status(400).json({ error: { message: grid.error } });
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null;
    const existing = await store.listContainers();
    if (existing.some((c) => c.prefix === prefix)) return res.status(409).json({ error: { message: `Konteiners "${prefix}" jau eksistē` } });
    try {
      let created = await store.createContainer({ prefix, label, rows: grid.rows, cols: grid.cols, cells: grid.cells });
      // Zones drawn during creation are saved in a follow-up write; validation for
      // them lives in the PATCH path and a brand-new container has no records to guard.
      if (typeof b.zones === 'string' && b.zones.length) {
        const zones = parseZones(b.zones);
        if (zones.length) created = (await store.updateContainer(created.id, { zones: JSON.stringify(zones) })) ?? created;
      }
      res.status(201).json({ ok: true, container: created });
    } catch {
      res.status(409).json({ error: { message: `Konteiners "${prefix}" jau eksistē` } });
    }
  }));

  // Redraw an existing container. Refuses to remove a place that currently holds
  // tires — the shape is a drawing of the rack, not a way to delete stock.
  app.patch('/api/containers/:id', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const all = await store.listContainers();
    const def = all.find((c) => String(c.id) === String(req.params.id));
    if (!def) return res.status(404).json({ error: { message: 'Konteiners nav atrasts' } });
    const grid = readGrid({ rows: b.rows ?? def.rows, cols: b.cols ?? def.cols, cells: b.cells });
    if ('error' in grid) return res.status(400).json({ error: { message: grid.error } });

    // Zones: validate the incoming drawing. Each zone needs a name and a cap;
    // its cells must be inside the grid and active.
    let zonesJson: string | null | undefined = undefined;
    if (b.zones !== undefined) {
      const zones = parseZones(typeof b.zones === 'string' ? b.zones : JSON.stringify(b.zones ?? []));
      const activeCells = cellMap({ rows: grid.rows, cols: grid.cols, cells: grid.cells });
      const usedCell = new Set<number>();
      const usedName = new Set<string>();
      for (const z of zones) {
        if (!/^[A-ZĀ-Ž0-9-]{1,8}$/.test(z.name)) return res.status(400).json({ error: { message: `Zonas nosaukums "${z.name}": 1–8 burti/cipari` } });
        if (usedName.has(z.name)) return res.status(400).json({ error: { message: `Zonas nosaukums "${z.name}" atkārtojas` } });
        usedName.add(z.name);
        for (const i of z.cells) {
          if (i >= activeCells.length || !activeCells[i]) return res.status(400).json({ error: { message: `Zona "${z.name}" iezīmē neaktīvu rūtiņu` } });
          if (usedCell.has(i)) return res.status(400).json({ error: { message: `Rūtiņa pieder divām zonām` } });
          usedCell.add(i);
        }
      }
      zonesJson = zones.length ? JSON.stringify(zones) : null;
    }

    // What survives the edit: the alias-aware code of every active cell, plus the
    // names of the zones being saved.
    let names: Record<string, string> = {};
    try { names = def.names ? JSON.parse(def.names) : {}; } catch { /* ignore */ }
    const newZones = zonesJson !== undefined ? parseZones(zonesJson) : parseZones(def.zones);
    const zoneCells = new Set(newZones.flatMap((z) => z.cells));
    const activeMap = cellMap({ rows: grid.rows, cols: grid.cols, cells: grid.cells });
    // Codes this container was responsible for BEFORE the edit:
    const { spots, occupied, layouts, zoneLoad } = await spotUniverse();
    const before = new Set((layouts.get(def.prefix) ?? []).flatMap((c) => (c && c.code ? [c.code] : [])));

    // `names` is the code each place carries, by position. The editor sends the
    // whole map when the shape is redrawn: a cell that moves (grid resized, the
    // drawing shifted) takes its code along, so every record already pointing at
    // that code still lands on the same physical place. Without this, changing the
    // column count alone would slide every code onto a different cell.
    let namesJson: string | null | undefined = undefined;
    if (b.names !== undefined) {
      let raw: unknown = b.names;
      if (typeof raw === 'string') { try { raw = raw.length ? JSON.parse(raw) : {}; } catch { raw = null; } }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return res.status(400).json({ error: { message: 'Nederīgs vietu nosaukumu saraksts' } });
      const next: Record<string, string> = {};
      const used = new Map<string, number>();
      for (const z of newZones) used.set(z.name, -1);
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const idx = Math.trunc(Number(k));
        // Entries for cells that are gone or swallowed by a zone simply don't apply.
        if (!Number.isFinite(idx) || idx < 0 || idx >= activeMap.length || !activeMap[idx] || zoneCells.has(idx)) continue;
        const name = String(v ?? '').toUpperCase().replace(/\s+/g, '');
        if (!/^[A-ZĀ-Ž0-9-]{1,10}$/.test(name) || !/[A-ZĀ-Ž0-9]/.test(name)) {
          return res.status(400).json({ error: { message: `Vietas nosaukums "${name}": 1–10 burti/cipari/domuzīmes` } });
        }
        if (used.has(name)) return res.status(409).json({ error: { message: `Nosaukums ${name} atkārtojas divām vietām` } });
        used.set(name, idx);
        // Taking a code that belongs to a place outside this container would merge
        // two different shelves into one.
        if (!before.has(name) && spots.some((s) => s.code === name)) {
          return res.status(409).json({ error: { message: `Vieta ${name} jau eksistē citur` } });
        }
        if (name !== `${def.prefix}${idx + 1}`) next[String(idx)] = name;
      }
      namesJson = Object.keys(next).length ? JSON.stringify(next) : null;
      names = next;
    }

    const survives = new Set<string>(newZones.map((z) => z.name));
    activeMap.forEach((on, i) => { if (on && !zoneCells.has(i)) survives.add((names[String(i)] || `${def.prefix}${i + 1}`).toUpperCase()); });
    // A zone below capacity is "assignable" and therefore absent from `occupied`,
    // but records still live on it — count it as occupied for the removal guard.
    const holds = (code: string) => occupied.has(code) || (zoneLoad.get(code)?.length ?? 0) > 0;
    const lost = [...before].filter((code) => holds(code) && !survives.has(code));
    if (lost.length) {
      return res.status(409).json({
        error: { message: `Šīs vietas ir aizņemtas un tās nevar noņemt: ${lost.slice(0, 12).join(', ')}${lost.length > 12 ? ` +${lost.length - 12}` : ''}` },
      });
    }
    const label = b.label === undefined ? undefined : (typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null);
    const updated = await store.updateContainer(def.id, {
      ...(label === undefined ? {} : { label }),
      ...(zonesJson === undefined ? {} : { zones: zonesJson }),
      ...(namesJson === undefined ? {} : { names: namesJson }),
      rows: grid.rows, cols: grid.cols, cells: grid.cells,
    });
    res.json({ ok: true, container: updated });
  }));

  // Renumber a container: hand out clean codes prefix1…prefixN in reading order,
  // closing the gaps that switching cells off leaves behind. Every record moves
  // with its place, so the tires stay physically where they are — only the label
  // on the place changes. Zones keep their own names and are skipped.
  app.post('/api/containers/:id/renumber', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const all = await store.listContainers();
    const def = all.find((c) => String(c.id) === String(req.params.id));
    if (!def) return res.status(404).json({ error: { message: 'Konteiners nav atrasts' } });
    let names: Record<string, string> = {};
    try { names = def.names ? JSON.parse(def.names) : {}; } catch { /* ignore */ }
    const zones = parseZones(def.zones);
    const zoneCells = new Set(zones.flatMap((z) => z.cells));
    const zoneNames = new Set(zones.map((z) => z.name));
    const plan: Array<{ idx: number; from: string; to: string }> = [];
    cellMap(def).forEach((on, i) => {
      if (!on || zoneCells.has(i)) return;
      const from = (names[String(i)] || `${def.prefix}${i + 1}`).toUpperCase();
      plan.push({ idx: i, from, to: `${def.prefix}${plan.length + 1}` });
    });
    if (!plan.length) return res.status(400).json({ error: { message: 'Konteinerā nav numurējamu vietu' } });
    // Never take a number that already belongs to something else.
    const mine = new Set(plan.map((p) => p.from));
    const { spots } = await spotUniverse();
    const clash = plan.find((p) => p.to !== p.from && (zoneNames.has(p.to) || (spots.some((s) => s.code === p.to) && !mine.has(p.to))));
    if (clash) return res.status(409).json({ error: { message: `Numurs ${clash.to} jau pieder citai vietai` } });

    // Order the renames so each one lands on a code nothing is sitting on yet.
    // Closing gaps only frees numbers, so this normally needs no detours; custom
    // names can form a cycle (A→B, B→A), and that one place waits on a temp code.
    const pending = new Map(plan.filter((p) => p.to !== p.from).map((p) => [p.from, p]));
    const held = new Set(pending.keys());
    const steps: Array<{ from: string; to: string }> = [];
    const tail: Array<{ from: string; to: string }> = [];
    const stamp = `TMP-${Date.now().toString(36).toUpperCase()}`;
    while (pending.size) {
      const ready = [...pending.values()].filter((p) => !held.has(p.to));
      if (ready.length) {
        for (const p of ready) { steps.push({ from: p.from, to: p.to }); pending.delete(p.from); held.delete(p.from); }
        continue;
      }
      const p = pending.values().next().value!;
      const tmp = `${stamp}-${tail.length}`;
      steps.push({ from: p.from, to: tmp });
      tail.push({ from: tmp, to: p.to });
      pending.delete(p.from); held.delete(p.from);
    }
    let renamed = 0;
    for (const s of [...steps, ...tail]) renamed += await store.renameLocation(s.from, s.to);
    // Persist the result by position: a number that no longer matches the
    // automatic prefix+position has to be stored as that place's name.
    const next: Record<string, string> = {};
    for (const p of plan) if (p.to !== `${def.prefix}${p.idx + 1}`) next[String(p.idx)] = p.to;
    const container = await store.updateContainer(def.id, { names: Object.keys(next).length ? JSON.stringify(next) : null });
    res.json({ ok: true, places: plan.length, changed: plan.filter((p) => p.to !== p.from).length, renamed, container });
  }));
  app.delete('/api/containers/:id', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const ok = await store.deleteContainer(req.params.id);
    if (!ok) return res.status(404).json({ error: { message: 'Konteiners nav atrasts' } });
    res.json({ ok: true });
  }));

  // Pending swaps: every 'prepared' set, newest first, shaped for the sidebar.
  app.get('/api/pending', P('screen.pending'), asyncH(async (req, res) => {
    const store = await getStore();
    const recs = redactAll(await store.list({ status: 'prepared' }), permsOf(req))
      .sort((a, b) => (b.preparedDate ?? '').localeCompare(a.preparedDate ?? ''));
    const items = recs.map((r) => ({
      id: r.id, plate: r.plate, cust: r.customerName, phone: r.phone, loc: r.location,
      size: r.size1, size2: r.size2, brand: r.brand, quantity: r.quantity, sms: r.smsCode,
      thread: r.threadDepth ? `${r.threadDepth} mm` : '—', season: r.season,
      preparedDate: r.preparedDate, intakeDate: r.intakeDate,
    }));
    res.json({ count: items.length, pending: items });
  }));

  // --- Excel export ----------------------------------------------------------
  // Every list in the app can leave as a .xlsx. The export mirrors what is on
  // screen — same filters, same column order — so what you downloaded matches
  // what you were looking at.
  const asSheet = async (rows: Array<Record<string, unknown>>, sheet: string, res: express.Response, file: string) => {
    const XLSX = (await import('xlsx')).default;
    const ws = XLSX.utils.json_to_sheet(rows);
    // Roughly size columns to their content so the file opens readable.
    const headers = Object.keys(rows[0] ?? {});
    ws['!cols'] = headers.map((h) => ({
      wch: Math.min(42, Math.max(h.length + 2, ...rows.slice(0, 400).map((r) => String(r[h] ?? '').length + 2))),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
    const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.send(buf);
  };
  const stamp = () => new Date().toISOString().slice(0, 10);
  const yn = (b: boolean) => (b ? 'Jā' : 'Nē');
  const STATUS_LV: Record<string, string> = {
    active: 'Glabājas', prepared: 'Rezervēts', blocked: 'Bloķēts', released: 'Izsniegts', free: 'Brīva vieta',
  };

  app.get('/api/export/:what', P('act.export'), asyncH(async (req, res) => {
    const store = await getStore();
    const what = req.params.what;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (what === 'storage') {
      const status = req.query.status;
      let rows = redactAll(await store.list(), permsOf(req));
      if (status === 'active' || status === 'released' || status === 'prepared') rows = rows.filter((r) => r.status === status);
      if (q) rows = rows.filter((r) => matches(r, q));
      const out = rows.map((r) => ({
        Vieta: r.location ?? '', 'Auto nr.': r.plate ?? '', Nosaukums: r.makeModel ?? '',
        Vārds: r.customerName ?? '', Uzņēmums: yn(r.isCompany), Telefons: r.phone ?? '',
        Izmērs: r.size1 ?? '', '2. izmērs': r.size2 ?? '', Ražotājs: canonBrand(r.brand) ?? '',
        Skaits: r.quantity ?? '', Diski: r.rimNote ?? '', Protektors: r.threadDepth ?? '',
        'SMS kods': r.smsCode ?? '', Cena: r.feeEur ?? '', Piezīmes: r.notes ?? '',
        Saņemts: r.intakeDate ?? '', Izsniegts: r.releaseDate ?? '',
        Sezona: r.season ?? '', Statuss: STATUS_LV[r.status] ?? r.status,
      }));
      if (!out.length) return res.status(404).json({ error: { message: 'Nav ko eksportēt' } });
      return asSheet(out, 'Tabula', res, `r1-tabula-${stamp()}.xlsx`);
    }

    if (what === 'history') {
      const ACTION_LV: Record<string, string> = {
        in: 'Pieņemšana', created: 'Pieņemšana', out: 'Izsniegšana', released: 'Izsniegšana',
        swapped: 'Maiņa', prepared: 'Sagatavots', unprepared: 'Atpakaļ vietā',
        blocked: 'Bloķēts', unblocked: 'Atbloķēts', edited: 'Rediģēts', comment: 'Komentārs', photo: 'Bilde',
      };
      const list = await buildHistory(req);
      const out = list.map((e) => ({
        Datums: e.d, Darbība: ACTION_LV[e.type] ?? e.type, 'Auto nr.': e.plate ?? '',
        Klients: e.cust ?? '', Vieta: e.loc ?? '', Riepas: e.tires ?? '',
        Komentārs: e.comment ?? '', Veica: e.actor ?? '',
      }));
      if (!out.length) return res.status(404).json({ error: { message: 'Nav ko eksportēt' } });
      return asSheet(out, 'Vēsture', res, `r1-vesture-${stamp()}.xlsx`);
    }

    if (what === 'analytics') {
      // The dashboard's aggregates, one sheet-friendly table: every chart's rows
      // stacked with a column saying which chart they came from.
      const a = await analyticsData(req);
      const out: Array<Record<string, unknown>> = [];
      const push = (group: string, items: Array<{ label: string; count: number }>) =>
        items.forEach((x) => out.push({ Grupa: group, Vērtība: x.label, Skaits: x.count }));
      push('Auto markas', a.makes); push('Modeļi', a.models); push('Izmēri', a.sizes);
      push('Ražotāji', a.brands); push('Daudzuma veidi', a.quantities); push('Sezonas', a.seasons);
      if (!out.length) return res.status(404).json({ error: { message: 'Nav ko eksportēt' } });
      return asSheet(out, 'Analītika', res, `r1-analitika-${stamp()}.xlsx`);
    }

    if (what === 'customers') {
      // One row per storage entry, grouped under its client — so the sheet can be
      // pivoted or filtered per customer in Excel.
      const type = typeof req.query.type === 'string' ? req.query.type : '';
      let all = redactAll(await store.list(q ? { q } : undefined), permsOf(req));
      if (type === 'company') all = all.filter((r) => r.isCompany);
      else if (type === 'private') all = all.filter((r) => !r.isCompany);
      const out = all
        .filter((r) => r.plate || r.customerName)
        .map((r) => ({
          Klients: r.customerName ?? '', Uzņēmums: yn(r.isCompany), Telefons: r.phone ?? '',
          'Auto nr.': r.plate ?? '', Auto: r.makeModel ?? '',
          Sezona: r.season ?? '', Vieta: r.location ?? '',
          Riepas: [r.quantity ? `${r.quantity}×` : '', canonBrand(r.brand) ?? '', r.size1 ?? ''].filter(Boolean).join(' '),
          '2. izmērs': r.size2 ?? '', Diski: r.rimNote ?? '', Protektors: r.threadDepth ?? '',
          Cena: r.feeEur ?? '', 'SMS kods': r.smsCode ?? '',
          Saņemts: r.intakeDate ?? '', Izsniegts: r.releaseDate ?? '',
          Statuss: STATUS_LV[r.status] ?? r.status,
        }))
        .sort((a, b) => a.Klients.localeCompare(b.Klients, 'lv') || (b.Saņemts || '').localeCompare(a.Saņemts || ''));
      if (!out.length) return res.status(404).json({ error: { message: 'Nav ko eksportēt' } });
      return asSheet(out, 'Klienti', res, `r1-klienti-${stamp()}.xlsx`);
    }

    if (what === 'tasks') {
      const s = req.query.status;
      const status = s === 'done' ? 'done' : s === 'all' ? undefined : 'open';
      const tasks = await store.listTasks({ status, limit: 500 });
      const out = tasks.map((t) => ({
        Veids: t.kind === 'prepare' ? 'Sagatavot riepas' : t.kind === 'store' ? 'Novietot glabāšanā' : 'Pasūtījums',
        Nosaukums: t.title, Apraksts: t.details ?? '', Vieta: t.location ?? '', 'Auto nr.': t.plate ?? '',
        Statuss: t.status === 'done' ? 'Pabeigts' : 'Darāms',
        Pieprasīja: t.createdBy ?? '', Izveidots: t.createdAt ?? '',
        Pabeidza: t.doneBy ?? '', Pabeigts: t.doneAt ?? '',
      }));
      if (!out.length) return res.status(404).json({ error: { message: 'Nav ko eksportēt' } });
      return asSheet(out, 'Noliktava', res, `r1-noliktava-${stamp()}.xlsx`);
    }

    if (what === 'pending') {
      const recs = redactAll(await store.list({ status: 'prepared' }), permsOf(req))
        .sort((a, b) => (b.preparedDate ?? '').localeCompare(a.preparedDate ?? ''));
      const out = recs.map((r) => ({
        Vieta: r.location ?? '', 'Auto nr.': r.plate ?? '', Klients: r.customerName ?? '', Telefons: r.phone ?? '',
        Riepas: [r.quantity ? `${r.quantity}×` : '', canonBrand(r.brand) ?? '', r.size1 ?? ''].filter(Boolean).join(' '),
        '2. izmērs': r.size2 ?? '', Sezona: r.season ?? '',
        Sagatavots: r.preparedDate ?? '', Saņemts: r.intakeDate ?? '',
      }));
      if (!out.length) return res.status(404).json({ error: { message: 'Nav sagatavotu riepu' } });
      return asSheet(out, 'Sagatavotie', res, `r1-sagatavotie-${stamp()}.xlsx`);
    }

    if (what === 'spots') {
      const { spots, occupied } = await spotUniverse();
      const perms = permsOf(req);
      const out = spots.map((s) => {
        const held = occupied.get(s.code);
        const r = held ? redactRecord(held, perms) : undefined;
        return {
          Vieta: s.code, Konteiners: s.c,
          Statuss: r ? (STATUS_LV[r.status] ?? r.status) : 'Brīvs',
          'Auto nr.': r?.plate ?? '', Klients: r?.customerName ?? '',
          Izmērs: r?.size1 ?? '', Ražotājs: canonBrand(r?.brand) ?? '',
          Diski: r?.rimNote ?? '', 'SMS kods': r?.smsCode ?? '', Saņemts: r?.intakeDate ?? '',
        };
      });
      if (!out.length) return res.status(404).json({ error: { message: 'Nav ko eksportēt' } });
      return asSheet(out, 'Novietnes', res, `r1-novietnes-${stamp()}.xlsx`);
    }

    return res.status(400).json({ error: { message: 'Nezināms eksporta veids' } });
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

  // Anything unrecognised lands on 'staff' rather than silently granting more.
  const readRole = (r: unknown): Role =>
    r === 'admin' ? 'admin' : r === 'warehouse' ? 'warehouse' : r === 'leja' ? 'leja' : 'staff';

  app.post('/api/users', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const { username, name, role, password } = req.body ?? {};
    const u = String(username ?? '').trim().toLowerCase();
    const nm = String(name ?? '').trim();
    const rl = readRole(role);
    if (!USERNAME_RE.test(u)) return res.status(400).json({ error: { message: 'Lietotājvārds: 3–32 rakstzīmes (a–z, 0–9, . _ -)' } });
    if (!nm) return res.status(400).json({ error: { message: 'Vārds ir obligāts' } });
    if (String(password ?? '').length < MIN_PW) return res.status(400).json({ error: { message: `Parolei jābūt vismaz ${MIN_PW} rakstzīmes` } });
    if (await store.getUserByUsername(u)) return res.status(409).json({ error: { message: 'Lietotājs ar šādu vārdu jau eksistē' } });
    await store.createUser({ username: u, name: nm, passwordHash: await hashPassword(String(password)), role: rl });
    res.json({ ok: true, user: { username: u, name: nm, role: rl } });
  }));

  // Per-user permission checklist (admin): read effective + overrides, save overrides.
  app.get('/api/users/:username/perms', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const u = String(req.params.username ?? '').trim().toLowerCase();
    const target = await store.getUserByUsername(u);
    if (!target) return res.status(404).json({ error: { message: 'Lietotājs nav atrasts' } });
    let overrides: Record<string, boolean> = {};
    try { const raw = await store.getUserPerms(u); if (raw) overrides = JSON.parse(raw); } catch { /* ignore */ }
    const defaults = ROLE_DEFAULTS[target.role] ?? ROLE_DEFAULTS.staff;
    const effective = { ...defaults } as Record<string, boolean>;
    for (const k of PERM_KEYS) if (typeof overrides[k] === 'boolean') effective[k] = overrides[k];
    res.json({ username: u, role: target.role, keys: PERM_KEYS, defaults, overrides, effective });
  }));

  app.put('/api/users/:username/perms', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const u = String(req.params.username ?? '').trim().toLowerCase();
    const target = await store.getUserByUsername(u);
    if (!target) return res.status(404).json({ error: { message: 'Lietotājs nav atrasts' } });
    if (target.role === 'admin') return res.status(400).json({ error: { message: 'Administratoram vienmēr ir visas tiesības' } });
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Store only real deviations from the role defaults, so changing a role later
    // brings its new defaults instead of a stale frozen copy.
    const defaults = ROLE_DEFAULTS[target.role] ?? ROLE_DEFAULTS.staff;
    const overrides: Record<string, boolean> = {};
    for (const k of PERM_KEYS) {
      if (typeof body[k] === 'boolean' && body[k] !== defaults[k]) overrides[k] = body[k] as boolean;
    }
    await store.setUserPerms(u, Object.keys(overrides).length ? JSON.stringify(overrides) : null);
    bustPerms(u);
    res.json({ ok: true, overrides });
  }));

  // Edit a user: login name, display name and role. The row keeps its id and its
  // permission overrides, so a rename carries them along. Editing yourself hands
  // back a fresh token, or the rename would log the admin out of the session they
  // are doing it from; everyone else has to sign in again under the new name.
  app.patch('/api/users/:username', requireAdmin, asyncH(async (req, res) => {
    const store = await getStore();
    const from = String(req.params.username ?? '').trim().toLowerCase();
    const target = await store.getUserByUsername(from);
    if (!target) return res.status(404).json({ error: { message: 'Lietotājs nav atrasts' } });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const me = (req as express.Request & { user?: { username: string } }).user;
    const isSelf = !!me && me.username.toLowerCase() === from;

    const patch: { username?: string; name?: string; role?: Role } = {};
    if (b.username !== undefined) {
      const to = String(b.username).trim().toLowerCase();
      if (!USERNAME_RE.test(to)) return res.status(400).json({ error: { message: 'Lietotājvārds: 3–32 rakstzīmes (a–z, 0–9, . _ -)' } });
      if (to !== from) {
        if (await store.getUserByUsername(to)) return res.status(409).json({ error: { message: 'Lietotājs ar šādu vārdu jau eksistē' } });
        patch.username = to;
      }
    }
    if (b.name !== undefined) {
      const nm = String(b.name).trim();
      if (!nm) return res.status(400).json({ error: { message: 'Vārds ir obligāts' } });
      if (nm !== target.name) patch.name = nm;
    }
    if (b.role !== undefined) {
      const rl = readRole(b.role);
      if (rl !== target.role) {
        // Losing the last admin would leave nobody able to manage the app.
        if (target.role === 'admin') {
          const admins = (await store.listUsers()).filter((x) => x.role === 'admin').length;
          if (admins <= 1) return res.status(400).json({ error: { message: 'Nevar noņemt pēdējam administratoram administratora lomu' } });
        }
        if (isSelf) return res.status(400).json({ error: { message: 'Savu lomu nevar mainīt — palūdz to izdarīt citam administratoram' } });
        patch.role = rl;
      }
    }
    if (!Object.keys(patch).length) return res.json({ ok: true, changed: false, user: { username: target.username, name: target.name, role: target.role } });
    await store.updateUser(from, patch);
    // Both names: the old cache entry is now stale, the new one must start clean.
    bustPerms(from);
    if (patch.username) bustPerms(patch.username);
    const next = { id: target.id, username: patch.username ?? target.username, name: patch.name ?? target.name, role: patch.role ?? target.role };
    res.json({
      ok: true, changed: true, user: { username: next.username, name: next.name, role: next.role },
      // Only ever for the admin editing their own account.
      token: isSelf ? signToken(next) : undefined,
      reauth: !isSelf && !!(patch.username || patch.role),
    });
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
