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


export async function loadUniverse(): Promise<SpotUniverse> {
  const [all, defs] = await Promise.all([records.listRecords(), misc.listContainers()]);
  return spotUniverse(all, defs);
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
      location: rec.location, plate: rec.plate, createdBy: actor,
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
export async function intake(b: IntakeBody, actor: string): Promise<StorageRecord> {
  const u = await loadUniverse();
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
  const rec = await records.createRecord(input);
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
