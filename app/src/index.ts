import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Store, IntakeInput } from './types.js';
import { LocalStore } from './stores/localStore.js';
import { SheetsStore } from './stores/sheetsStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

// --- Choose the datastore -------------------------------------------------
// Google Sheets if configured, otherwise the local seed store (dev/demo).
function makeStore(): Store {
  if (process.env.SHEET_ID && process.env.SHEET_TAB) {
    return new SheetsStore(process.env.SHEET_ID, process.env.SHEET_TAB);
  }
  const seed = process.env.SEED_FILE ?? join(__dirname, '..', 'data', 'sample-seed.json');
  return new LocalStore(seed);
}
const store = makeStore();

const app = express();
app.use(express.json());

const asyncH = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: { message: String(err?.message ?? err) } });
    });

app.get('/api/health', (_req, res) => res.json({ ok: true, store: store.kind() }));

// List / search current or released storage.
app.get('/api/storage', asyncH(async (req, res) => {
  const status = req.query.status === 'released' ? 'released' : req.query.status === 'active' ? 'active' : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const records = await store.list({ status, q });
  res.json({ count: records.length, records });
}));

app.get('/api/storage/:id', asyncH(async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
  res.json(rec);
}));

// Intake — create a new storage record.
app.post('/api/intake', asyncH(async (req, res) => {
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

// Retrieval — mark a record released.
app.post('/api/storage/:id/release', asyncH(async (req, res) => {
  const rec = await store.release(req.params.id, { releaseDate: req.body?.releaseDate });
  if (!rec) return res.status(404).json({ error: { message: 'Not found' } });
  res.json(rec);
}));

app.use(express.static(join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`R1 Tires app on http://localhost:${PORT}  [store: ${store.kind()}]`);
});
