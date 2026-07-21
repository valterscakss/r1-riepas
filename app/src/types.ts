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
  status: 'active' | 'released';
}

export type IntakeInput = Omit<StorageRecord, 'id' | 'status' | 'releaseDate'> &
  Partial<Pick<StorageRecord, 'intakeDate'>>;

export interface Store {
  /** List records, optionally filtered by status and a free-text query. */
  list(opts?: { status?: 'active' | 'released'; q?: string }): Promise<StorageRecord[]>;
  get(id: string): Promise<StorageRecord | null>;
  /** Create a new intake record. */
  create(input: IntakeInput): Promise<StorageRecord>;
  /** Mark a record released (retrieval). */
  release(id: string, opts: { releaseDate?: string }): Promise<StorageRecord | null>;
  /** Which backend is active (for the UI banner). */
  kind(): string;
}

/** Case-insensitive match of a query against the fields staff search by. */
export function matches(rec: StorageRecord, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [rec.plate, rec.location, rec.customerName, rec.phone, rec.makeModel]
    .some((f) => (f ?? '').toLowerCase().includes(needle));
}
