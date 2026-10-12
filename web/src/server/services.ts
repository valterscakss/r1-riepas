import { commentOf } from '@/domain/records';
import { cleanPricing, DEFAULT_PRICING, type PricingConfig } from '@/domain/pricing';
import { firstFreeSpot, spotUniverse, type SpotUniverse } from '@/domain/spots';
import { buildIntake, type IntakeBody } from '@/domain/intake';
import { taskDetailsFor, taskNotice, taskTitleFor } from '@/domain/tasks';
import { normCode, type StorageRecord, type Task } from '@/domain/types';
import * as records from './repo/records';
import * as misc from './repo/misc';
import { pushToAll } from './push';
import { notFound } from './http';


/** The setting that names the season whose sheet defines a branch's places. */
export const placeSeasonKey = (branchId: string) => `placeSeason:${branchId || '1'}`;

export async function placeSeasonOf(branchId: string): Promise<string | null> {
  const v = await misc.getSetting<string>(placeSeasonKey(branchId));
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** One branch's places and who holds them. */
export async function loadUniverse(branchId: string): Promise<SpotUniverse> {
  const [all, defs, season] = await Promise.all([
    records.listRecords({ branchId }), misc.listContainers(branchId), placeSeasonOf(branchId),
  ]);
  return spotUniverse(all, defs, season);
}

/**
 * Spot codes must not reach into another shop's letters: "Z5" here while rack Z
 * lives in the other shop would make a paper slip ambiguous. Returns the clashing
 * foreign prefix, or null.
 */
export async function foreignPrefix(name: string, branchId: string): Promise<string | null> {
  const others = (await misc.listContainers()).filter((c) => c.branchId !== branchId);
  return others.find((c) => name.startsWith(c.prefix))?.prefix ?? null;
}

/**
 * Refuse a record that lives in another shop. Lists are already filtered, but a
 * record is also reachable by id — without this, guessing an id would read or
 * change data in a branch the user was never given.
 */
export async function assertSameBranch(recordId: string, branchId: string): Promise<void> {
  const rec = await records.getRecord(recordId);
  if (rec && rec.branchId !== branchId) throw notFound('Ieraksts nav šajā filiālē');
}

/** Saved price rules, or the built-in ones. */
export async function loadPricing(): Promise<PricingConfig> {
  try {
    const raw = await misc.getSetting('pricing');
    return raw ? cleanPricing(raw) : DEFAULT_PRICING;
  } catch { return DEFAULT_PRICING; }
}

/** Tell every subscribed device about a new job. Fire-and-forget. */
export function announceTask(t: Pick<Task, 'title' | 'details' | 'location' | 'kind'>): void {
  void pushToAll(taskNotice(t)).catch(() => undefined);
}

/** Queue a warehouse job for a record; a failure is logged, never fatal. */
async function queueJob(kind: 'store' | 'prepare', rec: StorageRecord, actor: string, extra?: string | null): Promise<Task | null> {
  try {
    const task = await misc.createTask({
      kind, recordId: String(rec.id), title: taskTitleFor(rec),
      details: [taskDetailsFor(rec), extra].filter(Boolean).join(' · ') || null,
      location: rec.location, plate: rec.plate, createdBy: actor, branchId: rec.branchId,
    });
    announceTask(task);
    return task;
  } catch (e) {
    console.error(`[tasks] could not queue ${kind} job:`, e);
    return null;
  }
}

/**
 * Take a set in: first free place unless one was chosen, price from the rules,
 * a unique SMS code, a history entry and a "Novietot glabāšanā" job. With
 * `releaseId` it completes a seasonal swap — the prepared set that reserved the
 * place is closed first.
 */
export async function intake(b: IntakeBody, actor: string, branchId: string): Promise<StorageRecord> {
  const u = await loadUniverse(branchId);
  const location = b.location ? normCode(b.location) : firstFreeSpot(u);
  const smsCodes = new Set(u.all.map((r) => r.smsCode).filter((c): c is string => !!c));
  const input = buildIntake(b, { location, pricing: await loadPricing(), smsCodes, now: new Date() });
  if (b.releaseId) {
    const prev = String(b.releaseId);
    if (await records.releaseRecord(prev)) {
      await misc.logEvent(prev, 'swapped', 'Aizvietots ar jaunām riepām', actor);
      await misc.closeTasksForRecord(prev, actor);
    }
  }
  const rec = await records.createRecord({ ...input, branchId });
  await misc.logEvent(rec.id, 'created', commentOf(b.notes), actor);
  await queueJob('store', rec, actor);
  return rec;
}

export async function release(id: string, body: Record<string, unknown>, actor: string): Promise<StorageRecord> {
  const releaseDate = typeof body.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate) ? body.releaseDate : undefined;
  const rec = await records.releaseRecord(id, releaseDate);
  if (!rec) throw notFound();
  await misc.logEvent(rec.id, 'released', commentOf(body.comment), actor);
  await misc.closeTasksForRecord(rec.id, actor); // the set has left the building
  return rec;
}

/** Stage a set for a swap: tires out, place stays reserved, the warehouse fetches it. */
export async function prepare(id: string, body: Record<string, unknown>, actor: string) {
  const rec = await records.prepareRecord(id);
  if (!rec) throw notFound();
  const comment = commentOf(body.comment);
  await misc.logEvent(rec.id, 'prepared', comment, actor);
  const task = await queueJob('prepare', rec, actor, comment);
  return { ...rec, task };
}

export async function unprepare(id: string, body: Record<string, unknown>, actor: string): Promise<StorageRecord> {
  const rec = await records.prepareRecord(id, true);
  if (!rec) throw notFound();
  await misc.logEvent(rec.id, 'unprepared', commentOf(body.comment), actor);
  await misc.closeTasksForRecord(rec.id, actor);
  return rec;
}
