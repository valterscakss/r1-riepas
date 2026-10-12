import type { Perms } from './perms';
import { redactEventComment } from './perms';
import { tiresLine } from './records';
import { tms } from './format';
import type { RecordEvent, StorageRecord } from './types';

export interface HistoryEntry {
  type: string; d: string; plate: string | null; loc: string | null; recordId: string | null;
  comment: string | null; actor: string | null; cust: string | null; tires: string | null;
}

export interface HistoryFilter { from?: string; to?: string; types?: string[] | null; q?: string }

/**
 * Everything that ever happened: logged events, plus intakes/releases derived
 * from the date columns for records with no logged event (the imported years).
 * Future dates (typos like a 2026-12 release in July) are skipped.
 */
export function buildHistory(all: StorageRecord[], events: RecordEvent[], perms: Perms, today: string, f: HistoryFilter = {}): HistoryEntry[] {
  const byId = new Map(all.map((r) => [String(r.id), r]));
  const cust = (r?: StorageRecord) => (perms['field.customer'] ? (r?.customerName ?? null) : null);
  const tires = (r?: StorageRecord) => (r ? tiresLine(r) || null : null);
  const ev: HistoryEntry[] = [];
  const hasCreated = new Set<string>();
  const hasReleased = new Set<string>();
  for (const e of events) {
    const r = byId.get(String(e.recordId));
    if (e.action === 'created') hasCreated.add(String(e.recordId));
    if (e.action === 'released' || e.action === 'swapped') hasReleased.add(String(e.recordId));
    ev.push({ type: e.action, d: e.createdAt ?? '', plate: r?.plate ?? null, loc: r?.location ?? null, recordId: r ? String(r.id) : null, comment: redactEventComment(e.action, e.comment, perms), actor: e.actor, cust: cust(r), tires: tires(r) });
  }
  for (const r of all) {
    if (r.intakeDate && r.intakeDate <= today && !hasCreated.has(String(r.id)))
      ev.push({ type: 'in', d: r.intakeDate, plate: r.plate, loc: r.location, recordId: String(r.id), comment: null, actor: null, cust: cust(r), tires: tires(r) });
    if (r.releaseDate && r.releaseDate <= today && !hasReleased.has(String(r.id)))
      ev.push({ type: 'out', d: r.releaseDate, plate: r.plate, loc: r.location, recordId: String(r.id), comment: null, actor: null, cust: cust(r), tires: tires(r) });
  }
  // Dates compare on the date part, so a timestamped event on the "to" day counts.
  let list = ev;
  if (f.from) list = list.filter((e) => e.d.slice(0, 10) >= f.from!);
  if (f.to) list = list.filter((e) => e.d.slice(0, 10) <= f.to!);
  if (f.types?.length) { const t = new Set(f.types); list = list.filter((e) => t.has(e.type)); }
  const q = (f.q ?? '').trim().toUpperCase();
  if (q) list = list.filter((e) => [e.plate, e.loc, e.cust, e.comment, e.actor].some((x) => (x ?? '').toUpperCase().includes(q)));
  return list.sort((a, b) => tms(b.d) - tms(a.d));
}

/** Dashboard feed: the latest dozen, in the shape the home screen draws. */
export function activityFeed(all: StorageRecord[], recentEvents: RecordEvent[], perms: Perms, today: string) {
  return buildHistory(all, recentEvents, perms, today).slice(0, 12)
    .map((e) => ({ type: e.type, plate: e.plate, loc: e.loc, d: e.d, comment: e.comment, actor: e.actor }));
}

export const HISTORY_PAGE = 50;
