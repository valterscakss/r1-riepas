import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client';
import { storage } from '../db/schema';
import { normStatus, type IntakeInput, type StorageRecord } from '@/domain/types';
import type { ParsedRecord } from '@/domain/excel/import';
import { recordEvents, photos, tasks } from '../db/schema';
import { todayIso } from '@/domain/format';

type Row = typeof storage.$inferSelect;

export const toRecord = (r: Row): StorageRecord => ({
  id: String(r.id), season: r.season, location: r.location, plate: r.plate,
  makeModel: r.makeModel, customerName: r.customerName, isCompany: !!r.isCompany,
  phone: r.phone, size1: r.size1, brand: r.brand, quantity: r.quantity,
  size2: r.size2, rimNote: r.rimNote, notes: r.notes,
  intakeDate: r.intakeDate, releaseDate: r.releaseDate,
  status: normStatus(r.status), preparedDate: r.preparedDate ?? null,
  threadDepth: r.threadDepth ?? null, smsCode: r.smsCode ?? null, feeEur: r.feeEur ?? null,
});

/** Ids are BIGINT; anything that isn't a positive integer matches nothing. */
export const idNum = (id: string): number | null => (/^\d{1,15}$/.test(id) ? Number(id) : null);

export interface ListOpts { status?: 'active' | 'prepared' | 'released'; q?: string }

/** Newest first. `q` searches plate, place, name, phone and car, case-insensitively. */
export async function listRecords(opts: ListOpts = {}): Promise<StorageRecord[]> {
  const where: SQL[] = [];
  if (opts.status) where.push(eq(storage.status, opts.status));
  if (opts.q) {
    const p = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(storage.plate, p), ilike(storage.location, p), ilike(storage.customerName, p), ilike(storage.phone, p), ilike(storage.makeModel, p))!);
  }
  const rows = await getDb().select().from(storage).where(where.length ? and(...where) : undefined).orderBy(desc(storage.id));
  return rows.map(toRecord);
}

export async function getRecord(id: string): Promise<StorageRecord | null> {
  const n = idNum(id);
  if (n === null) return null;
  const [r] = await getDb().select().from(storage).where(eq(storage.id, n));
  return r ? toRecord(r) : null;
}

export async function createRecord(input: IntakeInput): Promise<StorageRecord> {
  const [r] = await getDb().insert(storage).values({
    season: input.season, location: input.location, plate: input.plate, makeModel: input.makeModel,
    customerName: input.customerName, isCompany: input.isCompany ?? false, phone: input.phone,
    size1: input.size1, brand: input.brand, quantity: input.quantity, size2: input.size2,
    rimNote: input.rimNote, notes: input.notes, intakeDate: input.intakeDate ?? todayIso(),
    status: 'active', threadDepth: input.threadDepth, smsCode: input.smsCode, feeEur: input.feeEur,
  }).returning();
  return toRecord(r);
}

async function update(id: string, set: Partial<typeof storage.$inferInsert>): Promise<StorageRecord | null> {
  const n = idNum(id);
  if (n === null) return null;
  const [r] = await getDb().update(storage).set(set).where(eq(storage.id, n)).returning();
  return r ? toRecord(r) : null;
}

export const releaseRecord = (id: string, releaseDate?: string) =>
  update(id, { status: 'released', releaseDate: releaseDate ?? todayIso() });

/** Stage for a swap ('prepared'), or with `active` put the set back in its place. */
export const prepareRecord = (id: string, active = false) =>
  update(id, active ? { status: 'active', preparedDate: null } : { status: 'prepared', preparedDate: todayIso() });

const WRITABLE = ['season', 'location', 'plate', 'makeModel', 'customerName', 'phone', 'size1', 'brand', 'quantity',
  'size2', 'rimNote', 'notes', 'intakeDate', 'releaseDate', 'threadDepth', 'smsCode', 'feeEur'] as const;

/** Patch allowlisted fields only. */
export async function updateRecord(id: string, patch: Record<string, unknown>): Promise<StorageRecord | null> {
  const set: Partial<typeof storage.$inferInsert> = {};
  for (const k of WRITABLE) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    const v = patch[k];
    (set as Record<string, unknown>)[k] = v === '' || v === undefined || v === null ? null : String(v);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'isCompany')) set.isCompany = !!patch.isCompany;
  if (!Object.keys(set).length) return getRecord(id);
  return update(id, set);
}

export async function blockSpot(location: string): Promise<StorageRecord> {
  const [r] = await getDb().insert(storage).values({ location, status: 'blocked', intakeDate: todayIso(), notes: 'Bloķēts' }).returning();
  return toRecord(r);
}

export async function deleteRecord(id: string): Promise<boolean> {
  const n = idNum(id);
  if (n === null) return false;
  return (await getDb().delete(storage).where(eq(storage.id, n)).returning({ id: storage.id })).length > 0;
}

/** Move every record from one place code to another. */
export async function renameLocation(from: string, to: string): Promise<number> {
  const rows = await getDb().update(storage).set({ location: to })
    .where(sql`upper(btrim(coalesce(${storage.location}, ''))) = upper(btrim(${from}))`).returning({ id: storage.id });
  return rows.length;
}

/** Flip every record of one customer between company and private. */
export async function setCustomerType(name: string, isCompany: boolean): Promise<number> {
  const rows = await getDb().update(storage).set({ isCompany })
    .where(sql`upper(btrim(coalesce(${storage.customerName}, ''))) = upper(btrim(${name}))`).returning({ id: storage.id });
  return rows.length;
}

/**
 * Replace ALL storage rows (Excel import), in one transaction. Record ids are
 * reset, so per-record history, photos and record-linked tasks no longer map and
 * are cleared too; free-text orders survive.
 */
export async function replaceAll(records: ParsedRecord[]): Promise<number> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE storage RESTART IDENTITY`);
    await tx.delete(recordEvents);
    await tx.delete(tasks).where(sql`${tasks.recordId} IS NOT NULL`);
    await tx.delete(photos);
    for (let i = 0; i < records.length; i += 500) {
      await tx.insert(storage).values(records.slice(i, i + 500).map((r) => ({
        season: r.season, location: r.location, plate: r.plate, makeModel: r.makeModel,
        customerName: r.customerName, isCompany: r.isCompany ?? false, phone: r.phone, size1: r.size1,
        brand: r.brand, quantity: r.quantity, size2: r.size2, rimNote: r.rimNote,
        notes: r.notes, intakeDate: r.intakeDate, releaseDate: r.releaseDate,
        status: r.status ?? (r.releaseDate ? 'released' : 'active'),
      })));
    }
    return records.length;
  });
}
