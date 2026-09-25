import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { containers, photos, pushSubs, recordEvents, settings, tasks } from '../db/schema';
import type { Container, Photo, PushSub, RecordEvent, Task, TaskInput } from '@/domain/types';
import { idNum } from './records';

/** timestamptz → ISO, so the client sorts and formats consistently. */
const iso = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

// ---- Containers ----
const toContainer = (r: typeof containers.$inferSelect): Container => ({
  id: String(r.id), prefix: r.prefix, label: r.label, rows: r.rows, cols: r.cols,
  cells: r.cells ?? null, names: r.names ?? null, zones: r.zones ?? null, createdAt: iso(r.createdAt),
});

export async function listContainers(): Promise<Container[]> {
  return (await getDb().select().from(containers).orderBy(asc(containers.prefix))).map(toContainer);
}

export async function createContainer(c: { prefix: string; label: string | null; rows: number; cols: number; cells: string | null; zones?: string | null }): Promise<Container> {
  const [r] = await getDb().insert(containers).values(c).returning();
  return toContainer(r);
}

export async function updateContainer(id: string, patch: Partial<Pick<Container, 'label' | 'rows' | 'cols' | 'cells' | 'names' | 'zones'>>): Promise<Container | null> {
  const n = idNum(id);
  if (n === null || !Object.keys(patch).length) return null;
  const [r] = await getDb().update(containers).set(patch).where(eq(containers.id, n)).returning();
  return r ? toContainer(r) : null;
}

export async function deleteContainer(id: string): Promise<boolean> {
  const n = idNum(id);
  if (n === null) return false;
  return (await getDb().delete(containers).where(eq(containers.id, n)).returning({ id: containers.id })).length > 0;
}

// ---- Record events ----
const toEvent = (r: typeof recordEvents.$inferSelect): RecordEvent => ({
  id: String(r.id), recordId: r.recordId, action: r.action, comment: r.comment, actor: r.actor, createdAt: iso(r.createdAt),
});

export async function addEvent(e: { recordId: string; action: string; comment: string | null; actor: string | null }): Promise<RecordEvent> {
  const [r] = await getDb().insert(recordEvents).values(e).returning();
  return toEvent(r);
}

/** History is non-critical: a failed write must not fail the action it records. */
export async function logEvent(recordId: string, action: string, comment: string | null, actor: string | null): Promise<void> {
  try { await addEvent({ recordId, action, comment, actor }); } catch (e) { console.error('[events] could not log', action, e); }
}

export async function listEvents(recordId: string): Promise<RecordEvent[]> {
  return (await getDb().select().from(recordEvents).where(eq(recordEvents.recordId, recordId)).orderBy(asc(recordEvents.id))).map(toEvent);
}

export async function recentEvents(limit: number): Promise<RecordEvent[]> {
  return (await getDb().select().from(recordEvents).orderBy(desc(recordEvents.id)).limit(Math.max(1, Math.min(5000, limit)))).map(toEvent);
}

export async function getEvent(id: string): Promise<RecordEvent | null> {
  const n = idNum(id);
  if (n === null) return null;
  const [r] = await getDb().select().from(recordEvents).where(eq(recordEvents.id, n));
  return r ? toEvent(r) : null;
}

export async function updateEventComment(id: string, comment: string | null): Promise<RecordEvent | null> {
  const n = idNum(id);
  if (n === null) return null;
  const [r] = await getDb().update(recordEvents).set({ comment }).where(eq(recordEvents.id, n)).returning();
  return r ? toEvent(r) : null;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const n = idNum(id);
  if (n === null) return false;
  return (await getDb().delete(recordEvents).where(eq(recordEvents.id, n)).returning({ id: recordEvents.id })).length > 0;
}

// ---- Tasks ----
const toTask = (r: typeof tasks.$inferSelect): Task => ({
  id: String(r.id), kind: r.kind === 'prepare' ? 'prepare' : r.kind === 'store' ? 'store' : 'order', recordId: r.recordId,
  title: r.title, details: r.details, location: r.location, plate: r.plate,
  status: r.status === 'done' ? 'done' : 'open', createdBy: r.createdBy,
  createdAt: iso(r.createdAt), doneBy: r.doneBy, doneAt: iso(r.doneAt),
});

export async function listTasks(opts: { status?: 'open' | 'done'; limit?: number } = {}): Promise<Task[]> {
  const rows = await getDb().select().from(tasks)
    .where(opts.status ? eq(tasks.status, opts.status) : undefined)
    .orderBy(desc(tasks.id)).limit(Math.max(1, Math.min(500, opts.limit ?? 200)));
  return rows.map(toTask);
}

export async function countOpenTasks(): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.status, 'open'));
  return r.n;
}

export async function createTask(t: TaskInput): Promise<Task> {
  const [r] = await getDb().insert(tasks).values(t).returning();
  return toTask(r);
}

export async function setTaskStatus(id: string, status: 'open' | 'done', actor: string | null): Promise<Task | null> {
  const n = idNum(id);
  if (n === null) return null;
  const done = status === 'done';
  const [r] = await getDb().update(tasks).set({ status, doneBy: done ? actor : null, doneAt: done ? new Date().toISOString() : null })
    .where(eq(tasks.id, n)).returning();
  return r ? toTask(r) : null;
}

/** Close any open job for a record (set released, prepare undone, swap finished). */
export async function closeTasksForRecord(recordId: string, actor: string | null): Promise<number> {
  try {
    const rows = await getDb().update(tasks).set({ status: 'done', doneBy: actor, doneAt: sql`now()` })
      .where(and(eq(tasks.recordId, recordId), eq(tasks.status, 'open'))).returning({ id: tasks.id });
    return rows.length;
  } catch (e) { console.error('[tasks] could not close jobs for', recordId, e); return 0; }
}

export async function deleteTask(id: string): Promise<boolean> {
  const n = idNum(id);
  if (n === null) return false;
  return (await getDb().delete(tasks).where(eq(tasks.id, n)).returning({ id: tasks.id })).length > 0;
}

// ---- Photos ----
const photoCols = { id: photos.id, recordId: photos.recordId, mime: photos.mime, bytes: photos.bytes, width: photos.width, height: photos.height, createdBy: photos.createdBy, createdAt: photos.createdAt };
const toPhoto = (r: { id: number; recordId: string; mime: string; bytes: number; width: number | null; height: number | null; createdBy: string | null; createdAt: string }): Photo =>
  ({ ...r, id: String(r.id), createdAt: iso(r.createdAt) });

export async function listPhotos(recordId: string): Promise<Photo[]> {
  return (await getDb().select(photoCols).from(photos).where(eq(photos.recordId, recordId)).orderBy(desc(photos.id))).map(toPhoto);
}

export async function getPhoto(id: string): Promise<{ mime: string; data: Buffer; recordId: string } | null> {
  const n = idNum(id);
  if (n === null) return null;
  const [r] = await getDb().select({ mime: photos.mime, data: photos.data, recordId: photos.recordId }).from(photos).where(eq(photos.id, n));
  return r ?? null;
}

export async function addPhoto(p: { recordId: string; mime: string; data: Buffer; width: number | null; height: number | null; createdBy: string | null }): Promise<Photo> {
  const [r] = await getDb().insert(photos).values({ ...p, bytes: p.data.length }).returning(photoCols);
  return toPhoto(r);
}

export async function deletePhoto(id: string): Promise<boolean> {
  const n = idNum(id);
  if (n === null) return false;
  return (await getDb().delete(photos).where(eq(photos.id, n)).returning({ id: photos.id })).length > 0;
}

export async function photoCounts(recordIds: string[]): Promise<Record<string, number>> {
  if (!recordIds.length) return {};
  const rows = await getDb().select({ recordId: photos.recordId, n: sql<number>`count(*)::int` })
    .from(photos).where(inArray(photos.recordId, recordIds)).groupBy(photos.recordId);
  return Object.fromEntries(rows.map((r) => [r.recordId, r.n]));
}

// ---- Settings (JSON blobs by key) ----
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const [r] = await getDb().select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  if (!r) return null;
  try { return JSON.parse(r.value) as T; } catch { return null; }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const v = JSON.stringify(value);
  await getDb().insert(settings).values({ key, value: v })
    .onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: sql`now()` } });
}

export async function deleteSetting(key: string): Promise<void> {
  await getDb().delete(settings).where(eq(settings.key, key));
}

// ---- Push subscriptions ----
export async function listPushSubs(): Promise<PushSub[]> {
  return getDb().select({ endpoint: pushSubs.endpoint, p256dh: pushSubs.p256dh, auth: pushSubs.auth, username: pushSubs.username }).from(pushSubs);
}

export async function countPushSubs(): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(pushSubs);
  return r.n;
}

/** Upsert by endpoint — re-subscribing the same device must not duplicate. */
export async function addPushSub(s: PushSub): Promise<void> {
  await getDb().insert(pushSubs).values(s)
    .onConflictDoUpdate({ target: pushSubs.endpoint, set: { p256dh: s.p256dh, auth: s.auth, username: s.username } });
}

export async function deletePushSub(endpoint: string): Promise<boolean> {
  return (await getDb().delete(pushSubs).where(eq(pushSubs.endpoint, endpoint)).returning({ e: pushSubs.endpoint })).length > 0;
}
