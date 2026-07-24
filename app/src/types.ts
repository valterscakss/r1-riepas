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
  // tires (unavailable); 'released' = order closed, spot free.
  status: 'active' | 'prepared' | 'blocked' | 'released';
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

/** A user-defined storage container (a shelf/rack/box of numbered places). */
export interface Container {
  id: string;
  prefix: string;   // spot code prefix, e.g. "D" → D1, D2, …
  label: string | null; // optional display name
  rows: number;     // physical rows
  cols: number;     // places per row; capacity = rows × cols
  createdAt: string | null;
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
  createContainer(c: { prefix: string; label: string | null; rows: number; cols: number }): Promise<Container>;
  /** Delete a container definition by id. Returns true if removed. */
  deleteContainer(id: string): Promise<boolean>;
}

/** Case-insensitive match of a query against the fields staff search by. */
export function matches(rec: StorageRecord, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [rec.plate, rec.location, rec.customerName, rec.phone, rec.makeModel]
    .some((f) => (f ?? '').toLowerCase().includes(needle));
}
