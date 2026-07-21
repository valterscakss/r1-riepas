import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Store, StorageRecord, IntakeInput } from '../types.js';
import { matches } from '../types.js';

/**
 * File-backed store for development / demo. Loads a JSON seed into memory and
 * persists mutations back to the same file. Not for production (no concurrency
 * control) — the Google Sheets adapter is the real datastore.
 */
export class LocalStore implements Store {
  private records: StorageRecord[] = [];
  private seq = 0;

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const rows = Array.isArray(raw) ? raw : raw.records ?? [];
      this.records = rows.map((r: any, i: number) => this.normalize(r, i));
      this.seq = this.records.length;
    }
  }

  kind() {
    return `local (${this.records.length} records from ${this.path})`;
  }

  private normalize(r: any, i: number): StorageRecord {
    // Accept both the importer's NormalRecord shape and our StorageRecord shape.
    return {
      id: r.id ?? String(i + 1),
      season: r.season ?? r.sheet ?? null,
      location: r.location ?? r.locationCode ?? null,
      plate: r.plate ?? null,
      makeModel: r.makeModel ?? null,
      customerName: r.customerName ?? null,
      isCompany: Boolean(r.isCompany),
      phone: r.phone ?? r.phoneE164 ?? null,
      size1: r.size1 ?? r.tires?.[0]?.size ?? null,
      brand: r.brand ?? r.tires?.[0]?.brand ?? null,
      quantity: r.quantity ?? r.quantityRaw ?? null,
      size2: r.size2 ?? r.tires?.[1]?.size ?? null,
      rimNote: r.rimNote ?? null,
      notes: r.notes ?? null,
      intakeDate: r.intakeDate ?? null,
      releaseDate: r.releaseDate ?? null,
      status: (r.status as 'active' | 'released') ?? (r.releaseDate ? 'released' : 'active'),
    };
  }

  private persist() {
    writeFileSync(this.path, JSON.stringify({ count: this.records.length, records: this.records }, null, 2));
  }

  async list(opts?: { status?: 'active' | 'released'; q?: string }): Promise<StorageRecord[]> {
    let out = this.records;
    if (opts?.status) out = out.filter((r) => r.status === opts.status);
    if (opts?.q) out = out.filter((r) => matches(r, opts.q!));
    return out;
  }

  async get(id: string): Promise<StorageRecord | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }

  async create(input: IntakeInput): Promise<StorageRecord> {
    const rec: StorageRecord = {
      ...input,
      id: String(++this.seq),
      status: 'active',
      releaseDate: null,
      intakeDate: input.intakeDate ?? new Date().toISOString().slice(0, 10),
      isCompany: Boolean(input.isCompany),
    };
    this.records.push(rec);
    this.persist();
    return rec;
  }

  async release(id: string, opts: { releaseDate?: string }): Promise<StorageRecord | null> {
    const rec = this.records.find((r) => r.id === id);
    if (!rec) return null;
    rec.status = 'released';
    rec.releaseDate = opts.releaseDate ?? new Date().toISOString().slice(0, 10);
    this.persist();
    return rec;
  }
}
