/** The canonical storage record used across the API and the UI. */
export interface StorageRecord {
  id: string;
  season: string | null;
  location: string | null;    // VIETA, e.g. "A1"
  plate: string | null;       // AUTO NR.
  makeModel: string | null;   // NOSAUKUMS (vehicle)
  customerName: string | null; // VĀRDS
  isCompany: boolean;
  phone: string | null;       // TELEFONA NR.
  size1: string | null;       // IZMĒRS
  brand: string | null;       // NOSAUKUMS (tire)
  quantity: string | null;    // SKAITS ("4", "2+2")
  size2: string | null;       // 2nd size (staggered) — from DISKI
  rimNote: string | null;     // DISKI when it's a rim note
  notes: string | null;       // PIEZĪMES
  intakeDate: string | null;  // SAŅEMŠANAS DATUMS (ISO yyyy-mm-dd)
  releaseDate: string | null; // IZSNIEGŠANAS DATUMS
  /**
   * 'active' = tires in the spot; 'prepared' = tires taken out but the spot stays
   * reserved (waiting for a seasonal swap); 'blocked' = spot manually held with no
   * tires; 'released' = order closed, spot free; 'free' = a placeholder that only
   * says "this spot exists and is empty" (legacy sheets wrote "BRĪVS").
   */
  status: RecordStatus;
  preparedDate: string | null;
  threadDepth: string | null; // protektora dziļums, mm
  smsCode: string | null;     // unikālais izsniegšanas kods
  feeEur: string | null;      // aprēķinātā cena, EUR
}

export type RecordStatus = 'active' | 'prepared' | 'blocked' | 'released' | 'free';

export type IntakeInput = Omit<StorageRecord, 'id' | 'status' | 'releaseDate' | 'preparedDate'> &
  Partial<Pick<StorageRecord, 'intakeDate'>>;

/**
 * What a user is, before per-user permissions are applied. The role only supplies
 * the DEFAULTS — every screen and action can be ticked on or off per person.
 */
export type Role = 'admin' | 'staff' | 'warehouse' | 'leja';

export const normRole = (r: unknown): Role =>
  r === 'admin' ? 'admin' : r === 'warehouse' ? 'warehouse' : r === 'leja' ? 'leja' : 'staff';

export const normStatus = (s: unknown): RecordStatus =>
  s === 'released' ? 'released' : s === 'prepared' ? 'prepared' : s === 'blocked' ? 'blocked'
    : s === 'free' ? 'free' : 'active';

export interface User {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  role: Role;
}

export interface UserSummary {
  id: string; username: string; name: string; role: Role; perms: string | null; createdAt: string | null;
}

/** One entry in a record's action history (audit trail + comments). */
export interface RecordEvent {
  id: string;
  recordId: string;
  action: string;          // created | prepared | unprepared | released | swapped | blocked | unblocked | edited | comment | photo
  comment: string | null;
  actor: string | null;
  createdAt: string | null;
}

/**
 * A job for the warehouse worker: 'store' (put a new intake INTO its place),
 * 'prepare' (fetch a staged set OUT), or 'order' (free-text request).
 */
export interface Task {
  id: string;
  kind: 'prepare' | 'order' | 'store';
  recordId: string | null;
  title: string;
  details: string | null;
  location: string | null;
  plate: string | null;
  status: 'open' | 'done';
  createdBy: string | null;
  createdAt: string | null;
  doneBy: string | null;
  doneAt: string | null;
}

export type TaskInput = Pick<Task, 'kind' | 'recordId' | 'title' | 'details' | 'location' | 'plate'> &
  { createdBy: string | null };

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

export interface PushSub { endpoint: string; p256dh: string; auth: string; username: string | null }

/**
 * A user-defined storage container. `cells` is one '1'/'0' per grid position in
 * reading order (null = all present). A place is numbered by POSITION (index+1),
 * so switching a cell off never renames its neighbours. `names` maps position →
 * custom code (JSON); `zones` merges cells into one place holding up to `cap` sets.
 */
export interface Container {
  id: string;
  prefix: string;
  label: string | null;
  rows: number;
  cols: number;
  cells: string | null;
  names: string | null;
  zones: string | null;
  createdAt: string | null;
}

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

/** Custom place names by position; bad JSON reads as none. */
export function parseNames(n: string | null | undefined): Record<string, string> {
  if (!n) return {};
  try {
    const v = JSON.parse(n);
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {};
  } catch { return {}; }
}

/** Expand a container's cell string into one boolean per grid position. */
export function cellMap(c: { rows: number; cols: number; cells?: string | null }): boolean[] {
  const total = Math.max(0, (c.rows || 0) * (c.cols || 0));
  const raw = c.cells ?? '';
  const out: boolean[] = [];
  for (let i = 0; i < total; i++) out.push(raw.length > i ? raw[i] === '1' : true);
  return out;
}

/** Case-insensitive match of a query against the fields staff search by. */
export function matches(rec: StorageRecord, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [rec.plate, rec.location, rec.customerName, rec.phone, rec.makeModel]
    .some((f) => (f ?? '').toLowerCase().includes(needle));
}

/** Upper-case and strip all whitespace: how plates and spot codes are compared. */
export const normCode = (s: unknown): string => String(s ?? '').toUpperCase().replace(/\s+/g, '');
