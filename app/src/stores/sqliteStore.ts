import Database from 'better-sqlite3';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store, StorageRecord, IntakeInput, User, Container, RecordEvent, Task, TaskInput, PushSub } from '../types.js';

/**
 * SQLite datastore — the self-contained default backend. A real, durable, local
 * database in a single file. No external service, no credentials, nothing for a
 * company IT policy to block. Backup = copy the .db file (or schedule an export).
 */
const DDL = `
CREATE TABLE IF NOT EXISTS storage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  season       TEXT,
  location     TEXT,
  plate        TEXT,
  makeModel    TEXT,
  customerName TEXT,
  isCompany    INTEGER NOT NULL DEFAULT 0,
  phone        TEXT,
  size1        TEXT,
  brand        TEXT,
  quantity     TEXT,
  size2        TEXT,
  rimNote      TEXT,
  notes        TEXT,
  intakeDate   TEXT,
  releaseDate  TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  threadDepth  TEXT,
  smsCode      TEXT,
  feeEur       TEXT,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_storage_plate  ON storage(plate);
CREATE INDEX IF NOT EXISTS idx_storage_status ON storage(status);
CREATE INDEX IF NOT EXISTS idx_storage_location ON storage(location);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS containers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix     TEXT UNIQUE NOT NULL,
  label      TEXT,
  rows       INTEGER NOT NULL DEFAULT 1,
  cols       INTEGER NOT NULL DEFAULT 4,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  comment    TEXT,
  actor      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_record ON record_events(record_id);

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'order',
  record_id  TEXT,
  title      TEXT NOT NULL,
  details    TEXT,
  location   TEXT,
  plate      TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  done_by    TEXT,
  done_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_record ON tasks(record_id);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  username   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

interface Row {
  id: number; season: string | null; location: string | null; plate: string | null;
  makeModel: string | null; customerName: string | null; isCompany: number;
  phone: string | null; size1: string | null; brand: string | null; quantity: string | null;
  size2: string | null; rimNote: string | null; notes: string | null;
  intakeDate: string | null; releaseDate: string | null; status: string;
  threadDepth?: string | null; smsCode?: string | null; feeEur?: string | null; preparedDate?: string | null;
}

const normStatus = (s: string): 'active' | 'prepared' | 'blocked' | 'released' =>
  s === 'released' ? 'released' : s === 'prepared' ? 'prepared' : s === 'blocked' ? 'blocked' : 'active';

const toRecord = (r: Row): StorageRecord => ({
  id: String(r.id), season: r.season, location: r.location, plate: r.plate,
  makeModel: r.makeModel, customerName: r.customerName, isCompany: !!r.isCompany,
  phone: r.phone, size1: r.size1, brand: r.brand, quantity: r.quantity,
  size2: r.size2, rimNote: r.rimNote, notes: r.notes,
  intakeDate: r.intakeDate, releaseDate: r.releaseDate,
  status: normStatus(r.status), preparedDate: r.preparedDate ?? null,
  threadDepth: r.threadDepth ?? null, smsCode: r.smsCode ?? null, feeEur: r.feeEur ?? null,
});

export class SqliteStore implements Store {
  private db: Database.Database;
  private seededFrom: string | null = null;

  constructor(dbFile: string, seedFile?: string) {
    mkdirSync(dirname(dbFile), { recursive: true });
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(DDL);
    for (const col of ['threadDepth', 'smsCode', 'feeEur', 'preparedDate']) {
      try { this.db.exec(`ALTER TABLE storage ADD COLUMN ${col} TEXT`); } catch { /* exists */ }
    }
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM storage').get() as { n: number }).n;
    if (count === 0 && seedFile && existsSync(seedFile)) this.seed(seedFile);
  }

  private seed(seedFile: string) {
    const raw = JSON.parse(readFileSync(seedFile, 'utf8'));
    const rows: any[] = Array.isArray(raw) ? raw : raw.records ?? [];
    const insert = this.db.prepare(`INSERT INTO storage
      (season, location, plate, makeModel, customerName, isCompany, phone, size1, brand, quantity, size2, rimNote, notes, intakeDate, releaseDate, status)
      VALUES (@season, @location, @plate, @makeModel, @customerName, @isCompany, @phone, @size1, @brand, @quantity, @size2, @rimNote, @notes, @intakeDate, @releaseDate, @status)`);
    const tx = this.db.transaction((items: any[]) => {
      for (const r of items) {
        insert.run({
          season: r.season ?? r.sheet ?? null,
          location: r.location ?? r.locationCode ?? null,
          plate: r.plate ?? null,
          makeModel: r.makeModel ?? null,
          customerName: r.customerName ?? null,
          isCompany: r.isCompany ? 1 : 0,
          phone: r.phone ?? r.phoneE164 ?? null,
          size1: r.size1 ?? r.tires?.[0]?.size ?? null,
          brand: r.brand ?? r.tires?.[0]?.brand ?? null,
          quantity: r.quantity ?? r.quantityRaw ?? null,
          size2: r.size2 ?? r.tires?.[1]?.size ?? null,
          rimNote: r.rimNote ?? null,
          notes: r.notes ?? null,
          intakeDate: r.intakeDate ?? null,
          releaseDate: r.releaseDate ?? null,
          status: r.status ?? (r.releaseDate ? 'released' : 'active'),
        });
      }
    });
    tx(rows);
    this.seededFrom = seedFile;
  }

  kind() {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM storage').get() as { n: number }).n;
    return `sqlite (${n} records${this.seededFrom ? `, seeded from ${this.seededFrom}` : ''})`;
  }

  async list(opts?: { status?: 'active' | 'prepared' | 'released'; q?: string }): Promise<StorageRecord[]> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts?.status) { where.push('status = @status'); params.status = opts.status; }
    if (opts?.q) {
      where.push('(UPPER(plate) LIKE @q OR UPPER(location) LIKE @q OR UPPER(customerName) LIKE @q OR phone LIKE @q OR UPPER(makeModel) LIKE @q)');
      params.q = `%${opts.q.toUpperCase()}%`;
    }
    const sql = `SELECT * FROM storage ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
    return (this.db.prepare(sql).all(params) as Row[]).map(toRecord);
  }

  async get(id: string): Promise<StorageRecord | null> {
    const r = this.db.prepare('SELECT * FROM storage WHERE id = ?').get(Number(id)) as Row | undefined;
    return r ? toRecord(r) : null;
  }

  async create(input: IntakeInput): Promise<StorageRecord> {
    const rec = {
      season: input.season ?? null, location: input.location ?? null, plate: input.plate ?? null,
      makeModel: input.makeModel ?? null, customerName: input.customerName ?? null,
      isCompany: input.isCompany ? 1 : 0, phone: input.phone ?? null,
      size1: input.size1 ?? null, brand: input.brand ?? null, quantity: input.quantity ?? null,
      size2: input.size2 ?? null, rimNote: input.rimNote ?? null, notes: input.notes ?? null,
      intakeDate: input.intakeDate ?? new Date().toISOString().slice(0, 10),
      releaseDate: null as string | null, status: 'active',
      threadDepth: input.threadDepth ?? null, smsCode: input.smsCode ?? null, feeEur: input.feeEur ?? null,
    };
    const info = this.db.prepare(`INSERT INTO storage
      (season, location, plate, makeModel, customerName, isCompany, phone, size1, brand, quantity, size2, rimNote, notes, intakeDate, releaseDate, status, threadDepth, smsCode, feeEur)
      VALUES (@season, @location, @plate, @makeModel, @customerName, @isCompany, @phone, @size1, @brand, @quantity, @size2, @rimNote, @notes, @intakeDate, @releaseDate, @status, @threadDepth, @smsCode, @feeEur)`).run(rec);
    return (await this.get(String(info.lastInsertRowid)))!;
  }

  async release(id: string, opts: { releaseDate?: string }): Promise<StorageRecord | null> {
    const date = opts.releaseDate ?? new Date().toISOString().slice(0, 10);
    const info = this.db.prepare(`UPDATE storage SET status = 'released', releaseDate = ? WHERE id = ?`).run(date, Number(id));
    if (info.changes === 0) return null;
    return this.get(id);
  }

  async prepare(id: string, opts: { preparedDate?: string; active?: boolean }): Promise<StorageRecord | null> {
    const info = opts.active
      ? this.db.prepare(`UPDATE storage SET status = 'active', preparedDate = NULL WHERE id = ?`).run(Number(id))
      : this.db.prepare(`UPDATE storage SET status = 'prepared', preparedDate = ? WHERE id = ?`)
          .run(opts.preparedDate ?? new Date().toISOString().slice(0, 10), Number(id));
    if (info.changes === 0) return null;
    return this.get(id);
  }

  async blockSpot(location: string): Promise<StorageRecord> {
    const info = this.db.prepare(`INSERT INTO storage (location, status, intakeDate, notes) VALUES (?, 'blocked', ?, 'Bloķēts')`)
      .run(location, new Date().toISOString().slice(0, 10));
    return (await this.get(String(info.lastInsertRowid)))!;
  }

  async deleteRecord(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM storage WHERE id = ?').run(Number(id)).changes > 0;
  }

  async updateRecord(id: string, patch: Partial<StorageRecord>): Promise<StorageRecord | null> {
    const editable = ['season', 'location', 'plate', 'makeModel', 'customerName', 'phone',
      'size1', 'brand', 'quantity', 'size2', 'rimNote', 'notes', 'intakeDate', 'releaseDate',
      'threadDepth', 'smsCode', 'feeEur'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of editable) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        sets.push(`${k} = ?`);
        const v = (patch as Record<string, unknown>)[k];
        vals.push(v === '' || v === undefined ? null : v);
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'isCompany')) { sets.push('isCompany = ?'); vals.push(patch.isCompany ? 1 : 0); }
    if (!sets.length) return this.get(id);
    vals.push(Number(id));
    const info = this.db.prepare(`UPDATE storage SET ${sets.join(', ')} WHERE id = ?`).run(...(vals as never[]));
    if (info.changes === 0) return null;
    return this.get(id);
  }

  async replaceAll(records: IntakeInput[]): Promise<{ imported: number }> {
    const insert = this.db.prepare(`INSERT INTO storage
      (season, location, plate, makeModel, customerName, isCompany, phone, size1, brand, quantity, size2, rimNote, notes, intakeDate, releaseDate, status)
      VALUES (@season, @location, @plate, @makeModel, @customerName, @isCompany, @phone, @size1, @brand, @quantity, @size2, @rimNote, @notes, @intakeDate, @releaseDate, @status)`);
    const tx = this.db.transaction((items: IntakeInput[]) => {
      this.db.prepare('DELETE FROM storage').run();
      this.db.prepare('DELETE FROM record_events').run(); // record IDs are reused → stale history would mis-attach
      this.db.prepare('DELETE FROM tasks WHERE record_id IS NOT NULL').run(); // same for record-linked warehouse jobs
      for (const r of items) {
        insert.run({
          season: r.season ?? null, location: r.location ?? null, plate: r.plate ?? null,
          makeModel: r.makeModel ?? null, customerName: r.customerName ?? null,
          isCompany: r.isCompany ? 1 : 0, phone: r.phone ?? null,
          size1: r.size1 ?? null, brand: r.brand ?? null, quantity: r.quantity ?? null,
          size2: r.size2 ?? null, rimNote: r.rimNote ?? null, notes: r.notes ?? null,
          intakeDate: r.intakeDate ?? null, releaseDate: (r as { releaseDate?: string }).releaseDate ?? null,
          status: (r as { status?: string }).status ?? ((r as { releaseDate?: string }).releaseDate ? 'released' : 'active'),
        });
      }
      return items.length;
    });
    return { imported: tx(records) };
  }

  // --- Auth ---
  async ensureAuth(): Promise<void> { /* table created in constructor DDL */ }

  async getUserByUsername(username: string): Promise<User | null> {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; name: string; password_hash: string; role: string } | undefined;
    return r ? { id: String(r.id), username: r.username, name: r.name, passwordHash: r.password_hash, role: r.role === 'admin' ? 'admin' : 'staff' } : null;
  }

  async createUser(u: { username: string; name: string; passwordHash: string; role: 'admin' | 'staff' }): Promise<void> {
    this.db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)')
      .run(u.username.toLowerCase(), u.name, u.passwordHash, u.role);
  }

  async setPasswordByUsername(username: string, passwordHash: string): Promise<boolean> {
    const info = this.db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash, username.toLowerCase());
    return info.changes > 0;
  }

  async countUsers(): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  async listUsers(): Promise<Array<{ id: string; username: string; name: string; role: 'admin' | 'staff'; createdAt: string | null }>> {
    const rows = this.db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC, id ASC')
      .all() as Array<{ id: number; username: string; name: string; role: string; created_at: string | null }>;
    return rows.map((r) => ({
      id: String(r.id), username: r.username, name: r.name,
      role: (r.role === 'admin' ? 'admin' : 'staff') as 'admin' | 'staff', createdAt: r.created_at ?? null,
    }));
  }

  async deleteUserByUsername(username: string): Promise<boolean> {
    const info = this.db.prepare('DELETE FROM users WHERE username = ?').run(username.toLowerCase());
    return info.changes > 0;
  }

  // --- Containers ---
  async listContainers(): Promise<Container[]> {
    const rows = this.db.prepare('SELECT id, prefix, label, rows, cols, created_at FROM containers ORDER BY prefix ASC')
      .all() as Array<{ id: number; prefix: string; label: string | null; rows: number; cols: number; created_at: string | null }>;
    return rows.map((r) => ({ id: String(r.id), prefix: r.prefix, label: r.label, rows: r.rows, cols: r.cols, createdAt: r.created_at ?? null }));
  }

  async createContainer(c: { prefix: string; label: string | null; rows: number; cols: number }): Promise<Container> {
    const info = this.db.prepare('INSERT INTO containers (prefix, label, rows, cols) VALUES (?,?,?,?)')
      .run(c.prefix, c.label, c.rows, c.cols);
    const r = this.db.prepare('SELECT id, prefix, label, rows, cols, created_at FROM containers WHERE id = ?')
      .get(info.lastInsertRowid) as { id: number; prefix: string; label: string | null; rows: number; cols: number; created_at: string | null };
    return { id: String(r.id), prefix: r.prefix, label: r.label, rows: r.rows, cols: r.cols, createdAt: r.created_at ?? null };
  }

  async deleteContainer(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM containers WHERE id = ?').run(Number(id)).changes > 0;
  }

  // --- Record events ---
  private eventRow(r: { id: number; record_id: string; action: string; comment: string | null; actor: string | null; created_at: string | null }): RecordEvent {
    return { id: String(r.id), recordId: r.record_id, action: r.action, comment: r.comment, actor: r.actor, createdAt: r.created_at ?? null };
  }
  async addEvent(e: { recordId: string; action: string; comment: string | null; actor: string | null }): Promise<RecordEvent> {
    const info = this.db.prepare('INSERT INTO record_events (record_id, action, comment, actor) VALUES (?,?,?,?)')
      .run(e.recordId, e.action, e.comment, e.actor);
    const r = this.db.prepare('SELECT * FROM record_events WHERE id = ?').get(info.lastInsertRowid) as never;
    return this.eventRow(r);
  }
  async listEvents(recordId: string): Promise<RecordEvent[]> {
    const rows = this.db.prepare('SELECT * FROM record_events WHERE record_id = ? ORDER BY id ASC').all(recordId) as never[];
    return rows.map((r) => this.eventRow(r));
  }
  async recentEvents(limit: number): Promise<RecordEvent[]> {
    const rows = this.db.prepare('SELECT * FROM record_events ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(100, limit))) as never[];
    return rows.map((r) => this.eventRow(r));
  }
  async updateEvent(id: string, comment: string | null): Promise<RecordEvent | null> {
    const info = this.db.prepare('UPDATE record_events SET comment = ? WHERE id = ?').run(comment, Number(id));
    if (info.changes === 0) return null;
    const r = this.db.prepare('SELECT * FROM record_events WHERE id = ?').get(Number(id)) as never;
    return this.eventRow(r);
  }
  async deleteEvent(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM record_events WHERE id = ?').run(Number(id)).changes > 0;
  }

  // --- Warehouse tasks ---
  private taskRow(r: TaskRow): Task {
    return {
      id: String(r.id), kind: r.kind === 'prepare' ? 'prepare' : 'order', recordId: r.record_id,
      title: r.title, details: r.details, location: r.location, plate: r.plate,
      status: r.status === 'done' ? 'done' : 'open', createdBy: r.created_by,
      createdAt: r.created_at ?? null, doneBy: r.done_by, doneAt: r.done_at ?? null,
    };
  }
  async listTasks(opts?: { status?: 'open' | 'done'; limit?: number }): Promise<Task[]> {
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 200));
    const rows = (opts?.status
      ? this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY id DESC LIMIT ?').all(opts.status, limit)
      : this.db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit)) as TaskRow[];
    return rows.map((r) => this.taskRow(r));
  }
  async createTask(t: TaskInput): Promise<Task> {
    const info = this.db.prepare(
      'INSERT INTO tasks (kind, record_id, title, details, location, plate, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(t.kind, t.recordId, t.title, t.details, t.location, t.plate, t.createdBy);
    return this.taskRow(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) as TaskRow);
  }
  async setTaskStatus(id: string, status: 'open' | 'done', actor: string | null): Promise<Task | null> {
    const info = this.db.prepare('UPDATE tasks SET status = ?, done_by = ?, done_at = ? WHERE id = ?')
      .run(status, status === 'done' ? actor : null, status === 'done' ? new Date().toISOString() : null, Number(id));
    if (info.changes === 0) return null;
    return this.taskRow(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id)) as TaskRow);
  }
  async closeTasksForRecord(recordId: string, actor: string | null): Promise<number> {
    return this.db.prepare(`UPDATE tasks SET status = 'done', done_by = ?, done_at = ? WHERE record_id = ? AND status = 'open'`)
      .run(actor, new Date().toISOString(), recordId).changes;
  }
  async deleteTask(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(id)).changes > 0;
  }

  // --- Push subscriptions ---
  async listPushSubs(): Promise<PushSub[]> {
    return this.db.prepare('SELECT endpoint, p256dh, auth, username FROM push_subs').all() as PushSub[];
  }
  async addPushSub(s: PushSub): Promise<void> {
    this.db.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, username) VALUES (?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, username = excluded.username`)
      .run(s.endpoint, s.p256dh, s.auth, s.username);
  }
  async deletePushSub(endpoint: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint).changes > 0;
  }
}

interface TaskRow {
  id: number; kind: string; record_id: string | null; title: string; details: string | null;
  location: string | null; plate: string | null; status: string; created_by: string | null;
  created_at: string | null; done_by: string | null; done_at: string | null;
}
