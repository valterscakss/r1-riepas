/** The canonical storage record used across the API and stores. */
export interface StorageRecord {
  id: string;
  season: string | null;
  location: string | null;   // VIETA, e.g. "A1"
  plate: string | null;      // AUTO NR.
  makeModel: string | null;  // NOSAUKUMS (vehicle)
  customerName: string | null; // VĀRDS
  isCompany: boolean;
  phone: string | null;      // TELEFONA NR.
  size1: string | null;      // IZMĒRS
  brand: string | null;      // NOSAUKUMS (tire)
  quantity: string | null;   // SKAITS ("4", "2+2")
  size2: string | null;      // 2nd size (staggered) — from DISKI
  rimNote: string | null;    // DISKI when it's a rim note
  notes: string | null;      // PIEZĪMES
  intakeDate: string | null; // SAŅEMŠANAS DATUMS (ISO yyyy-mm-dd)
  releaseDate: string | null;// IZSNIEGŠANAS DATUMS
  // 'active' = tires in the spot; 'prepared' = tires taken out but the spot stays
  // reserved (waiting for a seasonal swap); 'blocked' = spot manually held with no
  // tires (unavailable); 'released' = order closed, spot free; 'free' = a
  // placeholder that only says "this spot exists and is empty" (the legacy sheets
  // wrote "BRĪVS" in the plate column for these).
  status: 'active' | 'prepared' | 'blocked' | 'released' | 'free';
  preparedDate: string | null; // when the set was staged for a swap
  // Phase-1 features (null for migrated history)
  threadDepth: string | null; // protektora dziļums, mm
  smsCode: string | null;     // unikālais izsniegšanas kods
  feeEur: string | null;      // aprēķinātā cena, EUR
}

export type IntakeInput = Omit<StorageRecord, 'id' | 'status' | 'releaseDate' | 'preparedDate'> &
  Partial<Pick<StorageRecord, 'intakeDate'>>;

export interface User {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  role: 'admin' | 'staff';
}

/** One entry in a record's action history (audit trail + comments). */
export interface RecordEvent {
  id: string;
  recordId: string;
  action: string;          // created | prepared | unprepared | released | blocked | unblocked | edited | comment
  comment: string | null;  // optional note attached to the action
  actor: string | null;    // username who did it
  createdAt: string | null;
}

/**
 * A job for the warehouse worker. Two sources feed the same queue:
 *  - 'prepare' — created automatically when staff stage a set for a swap, so the
 *    warehouse knows which spot to fetch tires from;
 *  - 'order'   — a free-text request typed into the warehouse chat box.
 * The warehouse view shows only OPEN tasks; ticking one done makes it disappear.
 */
export interface Task {
  id: string;
  kind: 'prepare' | 'order';
  recordId: string | null;  // linked storage record (prepare tasks)
  title: string;            // headline: plate for prepares, first line for orders
  details: string | null;   // tires/notes, or the typed order text
  location: string | null;  // spot code to fetch from
  plate: string | null;
  status: 'open' | 'done';
  createdBy: string | null;
  createdAt: string | null;
  doneBy: string | null;
  doneAt: string | null;
}

export type TaskInput = Pick<Task, 'kind' | 'recordId' | 'title' | 'details' | 'location' | 'plate'> &
  { createdBy: string | null };

/**
 * Editable pricing rules. A tier matches on the tire's WIDTH (the first number of
 * 225/45/17), inclusive at both ends, and the widest tire in the set decides.
 * `rims` multiplies the tier price when the set is stored on rims.
 */
export interface PricingTier { from: number; to: number; price: number }
export interface PricingConfig {
  tiers: PricingTier[];
  rims: { none: number; steel: number; aluminum: number };
}
export const DEFAULT_PRICING: PricingConfig = {
  tiers: [
    { from: 0, to: 215, price: 15 },
    { from: 216, to: 245, price: 20 },
    { from: 246, to: 275, price: 25 },
    { from: 276, to: 999, price: 30 },
  ],
  rims: { none: 1, steel: 1.2, aluminum: 1.3 },
};

/**
 * A photo attached to a stored set (tread wear, damage, the rims as handed in).
 * Bytes live in the database so there is no second service to configure or pay
 * for; the client downscales before upload to keep rows small.
 */
export interface Photo {
  id: string;
  recordId: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdBy: string | null;
  createdAt: string | null;
}

/** A browser/phone registered for Web Push notifications about new tasks. */
export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
  username: string | null;
}

/**
 * A user-defined storage container (a shelf/rack/box of numbered places).
 *
 * `cells` draws the actual shape: one '1' or '0' per grid position in reading
 * order (rows × cols), so an L-shaped rack is a full grid with its missing corner
 * switched off. Null/empty means every position exists — the original behaviour.
 *
 * A place is numbered by its POSITION in the grid (index + 1), never by counting
 * the active ones. Switching a cell off therefore leaves every other place's code
 * untouched; numbering with gaps is the price of never silently renaming a spot
 * that already holds someone's tires.
 */
export interface Container {
  id: string;
  prefix: string;   // spot code prefix, e.g. "D" → D1, D2, …
  label: string | null; // optional display name
  rows: number;     // physical rows
  cols: number;     // places per row; grid size = rows × cols
  cells: string | null; // '1'/'0' per position, or null for "all present"
  /**
   * Custom names for individual places, as a JSON object of position index →
   * name (e.g. {"21":"B7"}). A place without an entry keeps its automatic
   * code (prefix + position). Renames live here so an empty renamed place
   * survives with no record to carry it.
   */
  names: string | null;
  /**
   * Merged areas, as JSON: [{ name, cells: [indices], cap }]. The cells stop
   * being individual places; the zone is ONE location that can hold up to `cap`
   * sets at once (e.g. a floor corner that fits six).
   */
  zones: string | null;
  createdAt: string | null;
}

/** Parsed shape of one merged zone. */
export interface Zone { name: string; cells: number[]; cap: number }
export function parseZones(z: string | null | undefined): Zone[] {
  if (!z) return [];
  try {
    const raw = JSON.parse(z);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x) => ({
        name: String(x?.name ?? '').toUpperCase().trim(),
        cells: Array.isArray(x?.cells) ? x.cells.map((n: unknown) => Math.trunc(Number(n))).filter((n: number) => Number.isFinite(n) && n >= 0) : [],
        cap: Math.max(1, Math.min(99, Math.trunc(Number(x?.cap)) || 1)),
      }))
      .filter((x) => x.name && x.cells.length);
  } catch { return []; }
}

/** Expand a container's cell string into one boolean per grid position. */
export function cellMap(c: { rows: number; cols: number; cells?: string | null }): boolean[] {
  const total = Math.max(0, (c.rows || 0) * (c.cols || 0));
  const raw = c.cells ?? '';
  const out: boolean[] = [];
  for (let i = 0; i < total; i++) out.push(raw.length > i ? raw[i] === '1' : true);
  return out;
}

export interface ImportSummary {
  parsed: number;
  imported: number;
  skipped: number;
}

export interface Store {
  /** List records, optionally filtered by status and a free-text query. */
  list(opts?: { status?: 'active' | 'prepared' | 'released'; q?: string }): Promise<StorageRecord[]>;
  get(id: string): Promise<StorageRecord | null>;
  /** Create a new intake record. */
  create(input: IntakeInput): Promise<StorageRecord>;
  /** Mark a record released (retrieval). */
  release(id: string, opts: { releaseDate?: string }): Promise<StorageRecord | null>;
  /** Stage a set for a swap: tires out, spot stays reserved ('prepared'). status back to 'active' via `active:true`. */
  prepare(id: string, opts: { preparedDate?: string; active?: boolean }): Promise<StorageRecord | null>;
  /** Reserve an empty spot with a placeholder 'blocked' record (no tires). */
  blockSpot(location: string): Promise<StorageRecord>;
  /** Hard-delete a record (used to unblock a spot). */
  deleteRecord(id: string): Promise<boolean>;
  /** Patch editable fields of a record (Tabula manual edit). Only allowlisted keys apply. */
  updateRecord(id: string, patch: Partial<StorageRecord>): Promise<StorageRecord | null>;
  /**
   * Flip every record of one customer between company and private in a single
   * statement. The importer guesses this from the sheet and gets it wrong for
   * names like "Sandijs"; fixing it one record at a time is not workable when a
   * customer has hundreds. Returns how many rows changed.
   */
  setCustomerType(customerName: string, isCompany: boolean): Promise<number>;
  /**
   * Replace ALL storage rows with the given records, transactionally.
   * Used by the Excel import pipeline (Excel = source of truth).
   */
  replaceAll(records: IntakeInput[]): Promise<{ imported: number }>;
  /** Which backend is active (for the UI banner). */
  kind(): string;

  // --- Auth (staff users) ---
  /** Create the users table if needed and seed an admin from env when empty. */
  ensureAuth(): Promise<void>;
  getUserByUsername(username: string): Promise<User | null>;
  createUser(u: { username: string; name: string; passwordHash: string; role: 'admin' | 'staff' }): Promise<void>;
  setPasswordByUsername(username: string, passwordHash: string): Promise<boolean>;
  countUsers(): Promise<number>;
  /** List users WITHOUT password hashes — for admin user management. */
  listUsers(): Promise<Array<{ id: string; username: string; name: string; role: 'admin' | 'staff'; createdAt: string | null }>>;
  /** Delete a user by username. Returns true if a row was removed. */
  deleteUserByUsername(username: string): Promise<boolean>;

  // --- Storage containers (user-defined shelves/racks) ---
  /** List all defined containers, ordered by prefix. */
  listContainers(): Promise<Container[]>;
  /** Create a container. Returns the created row. */
  createContainer(c: { prefix: string; label: string | null; rows: number; cols: number; cells: string | null }): Promise<Container>;
  /** Update a container's label, grid size, drawn shape or place names. */
  updateContainer(id: string, patch: { label?: string | null; rows?: number; cols?: number; cells?: string | null; names?: string | null; zones?: string | null }): Promise<Container | null>;
  /** Move every record from one spot code to another (a place was renamed). */
  renameLocation(from: string, to: string): Promise<number>;
  /** Delete a container definition by id. Returns true if removed. */
  deleteContainer(id: string): Promise<boolean>;

  // --- Record events (per-record action history + comments) ---
  /** Append an event to a record's history. */
  addEvent(e: { recordId: string; action: string; comment: string | null; actor: string | null }): Promise<RecordEvent>;
  /** List a record's events, oldest first. */
  listEvents(recordId: string): Promise<RecordEvent[]>;
  /** Most recent events across all records, newest first (for the activity feed). */
  recentEvents(limit: number): Promise<RecordEvent[]>;
  /** Edit an event's comment. Returns the updated event or null. */
  updateEvent(id: string, comment: string | null): Promise<RecordEvent | null>;
  /** Delete an event. Returns true if removed. */
  deleteEvent(id: string): Promise<boolean>;

  // --- Warehouse tasks (prepare jobs + free-text orders) ---
  /** List tasks, newest first. Omit `status` for everything. */
  listTasks(opts?: { status?: 'open' | 'done'; limit?: number }): Promise<Task[]>;
  /** Create a task. Returns the created row. */
  createTask(t: TaskInput): Promise<Task>;
  /** Mark a task done/open. `actor` is stamped as doneBy when closing. */
  setTaskStatus(id: string, status: 'open' | 'done', actor: string | null): Promise<Task | null>;
  /** Close any OPEN task attached to a record (used when a prepare is undone). */
  closeTasksForRecord(recordId: string, actor: string | null): Promise<number>;
  /** Hard-delete a task. */
  deleteTask(id: string): Promise<boolean>;

  // --- Record photos ---
  /** Photo metadata for a record, newest first (never the bytes). */
  listPhotos(recordId: string): Promise<Photo[]>;
  /** The image itself, for serving. */
  getPhoto(id: string): Promise<{ mime: string; data: Buffer } | null>;
  addPhoto(p: { recordId: string; mime: string; data: Buffer; width: number | null; height: number | null; createdBy: string | null }): Promise<Photo>;
  deletePhoto(id: string): Promise<boolean>;
  /** How many photos each of these records has — for list badges. */
  photoCounts(recordIds: string[]): Promise<Record<string, number>>;

  // --- App settings (JSON blobs keyed by name, e.g. 'pricing') ---
  /** Read a settings blob. Returns null when it was never saved. */
  getSetting(key: string): Promise<unknown | null>;
  setSetting(key: string, value: unknown): Promise<void>;

  // --- Web Push subscriptions ---
  listPushSubs(): Promise<PushSub[]>;
  /** Upsert by endpoint — re-subscribing the same device must not duplicate. */
  addPushSub(s: PushSub): Promise<void>;
  deletePushSub(endpoint: string): Promise<boolean>;
}

/** Case-insensitive match of a query against the fields staff search by. */
export function matches(rec: StorageRecord, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [rec.plate, rec.location, rec.customerName, rec.phone, rec.makeModel]
    .some((f) => (f ?? '').toLowerCase().includes(needle));
}
