import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IntakeInput } from './types.js';
import { getStore } from './store.js';
import { parseWorkbook } from './importExcel.js';
import {
  COOKIE, signToken, verifyPassword, currentUser, requireAuth, requireAdmin, toSession,
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
    res.cookie(COOKIE, signToken(session), cookieOpts);
    res.json({ user: session });
  }));

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
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
    res.json({
      plate, found: true, history: hits.length, lastSeason: s.season, lastIntake: s.intakeDate,
      suggestion: {
        makeModel: s.makeModel, customerName: s.customerName, isCompany: s.isCompany,
        phone: s.phone, size1: s.size1, brand: s.brand, quantity: s.quantity,
        size2: s.size2, rimNote: s.rimNote,
      },
    });
  }));

  app.post('/api/intake', requireAuth, asyncH(async (req, res) => {
    const store = await getStore();
    const b = req.body ?? {};
    if (!b.location && !b.plate) {
      return res.status(400).json({ error: { message: 'At least a location or a plate is required' } });
    }
    const input: IntakeInput = {
      season: b.season ?? null,
      location: b.location ?? null,
      plate: b.plate ? String(b.plate).toUpperCase().replace(/\s+/g, '') : null,
      makeModel: b.makeModel ?? null,
      customerName: b.customerName ?? null,
      isCompany: Boolean(b.isCompany),
      phone: b.phone ?? null,
      size1: b.size1 ?? null,
      brand: b.brand ?? null,
      quantity: b.quantity ?? null,
      size2: b.size2 ?? null,
      rimNote: b.rimNote ?? null,
      notes: b.notes ?? null,
      intakeDate: b.intakeDate ?? undefined,
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

  // Static UI (also served on Vercel via the catch-all rewrite).
  app.use(express.static(join(__dirname, '..', 'public')));

  return app;
}
