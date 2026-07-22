import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IntakeInput, StorageRecord } from './types.js';
import { getStore } from './store.js';
import { parseWorkbook } from './importExcel.js';
import {
  COOKIE, signToken, verifyPassword, hashPassword, currentUser, requireAuth, requireAdmin, toSession,
  AUTH_DISABLED, DEMO_USER,
} from './auth.js';

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

  // ---- Domain helpers (per design: pricing, spot assignment, SMS codes) ----
  const SPOT_RE = /^([A-ZĀ-Ž]{1,4})(\d{1,3})$/;
  async function spotUniverse() {
    const store = await getStore();
    const all = await store.list();
    const seen = new Map<string, { code: string; c: string; n: number }>();
    const occupied = new Map<string, (typeof all)[number]>();
    for (const r of all) {
      const code = (r.location ?? '').toUpperCase();
      const m = code.match(SPOT_RE);
      if (!m) continue;
      if (!seen.has(code)) seen.set(code, { code, c: m[1], n: Number(m[2]) });
      if (r.status === 'active' && !occupied.has(code)) occupied.set(code, r);
    }
    const spots = [...seen.values()].sort((a, b) => a.c.localeCompare(b.c) || a.n - b.n);
    return { spots, occupied, all };
  }
  const priceFor = (size: string | null, rim: string | null) => {
    const width = parseInt((size ?? '').slice(0, 3)) || 0;
    if (!width) return { base: 0, mult: 1, total: 0 };
    const base = width <= 215 ? 15 : width <= 245 ? 20 : width <= 275 ? 25 : 30;
    const mult = rim === 'aluminum' ? 1.3 : rim === 'steel' ? 1.2 : 1.0;
    return { base, mult, total: Math.round(base * mult * 100) / 100 };
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

  // Stats for dashboard + spots grid (design: containers, capacity, activity).
  app.get('/api/stats', requireAuth, asyncH(async (_req, res) => {
    const { spots, occupied, all } = await spotUniverse();
    const byC = new Map<string, { letter: string; spots: unknown[]; occ: number }>();
    for (const s of spots) {
      if (!byC.has(s.c)) byC.set(s.c, { letter: s.c, spots: [], occ: 0 });
      const g = byC.get(s.c)!;
      const r = occupied.get(s.code);
      if (r) g.occ++;
      g.spots.push(r
        ? { code: s.code, occ: true, id: r.id, plate: r.plate, cust: r.customerName, brand: r.brand, size: r.size1, sms: r.smsCode, thread: r.threadDepth }
        : { code: s.code, occ: false });
    }
    const containers = [...byC.values()]
      .map((g) => ({ ...g, total: g.spots.length }))
      .sort((a, b) => b.total - a.total || a.letter.localeCompare(b.letter))
      .slice(0, 8)
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const occ = [...occupied.keys()].length;
    const today = new Date().toISOString().slice(0, 10);
    const firstFree = spots.find((s) => !occupied.has(s.code));
    const revenue = all.filter((r) => r.status === 'active' && r.feeEur).reduce((a, r) => a + (parseFloat(r.feeEur!) || 0), 0);
    res.json({
      occ, total: spots.length, free: spots.length - occ,
      capPct: spots.length ? Math.round((occ / spots.length) * 100) : 0,
      todayIntakes: all.filter((r) => r.intakeDate === today).length,
      smsIssued: all.filter((r) => r.smsCode).length,
      revenueActive: Math.round(revenue * 100) / 100,
      assignNext: firstFree?.code ?? null,
      containers,
    });
  }));

  // Recent activity feed (intakes + releases by date).
  app.get('/api/activity', requireAuth, asyncH(async (_req, res) => {
    const store = await getStore();
    const all = await store.list();
    const ev: { t: string; type: 'in' | 'out'; plate: string | null; loc: string | null; d: string }[] = [];
    for (const r of all) {
      if (r.intakeDate) ev.push({ t: r.intakeDate, type: 'in', plate: r.plate, loc: r.location, d: r.intakeDate });
      if (r.releaseDate) ev.push({ t: r.releaseDate, type: 'out', plate: r.plate, loc: r.location, d: r.releaseDate });
    }
    ev.sort((a, b) => b.d.localeCompare(a.d));
    res.json({ events: ev.slice(0, 8) });
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
    // Pricing (design: base by width tier × rim multiplier).
    const rim = b.rim === 'aluminum' || b.rim === 'steel' ? b.rim : 'none';
    const { total } = priceFor(b.size1 ?? null, rim);
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
    const rec = await store.create(input);
    res.status(201).json(rec);
  }));

  app.post('/api/storage/:id/release', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const rec = await store.release(req.params.id, { releaseDate: req.body?.releaseDate });
    if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rec);
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
      return res.status(400).json({ error: { message: 'No recognizable seasonal sheets found in the workbook' } });
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
