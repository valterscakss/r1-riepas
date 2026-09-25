import { canonBrand } from './brands';
import { noteSizeStrict } from './sizes';
import type { StorageRecord, Task } from './types';

export const TASK_KIND_LABEL: Record<Task['kind'], string> = {
  prepare: 'Sagatavot riepas', store: 'Novietot glabāšanā', order: 'Pasūtījums',
};

export const taskTitleFor = (r: StorageRecord) => (r.plate ?? r.location ?? 'Riepas').trim();

/** "4× Nokian 205/55/16 + 225/45/17 · customer · rims" — what the warehouse needs to find the set. */
export function taskDetailsFor(r: StorageRecord): string | null {
  const size2 = r.size2 ?? noteSizeStrict(r.notes);
  const tires = [r.quantity ? `${r.quantity}×` : '', canonBrand(r.brand) ?? '', r.size1 ?? ''].filter(Boolean).join(' ') + (size2 ? ` + ${size2}` : '');
  return [tires.trim() || null, r.customerName, r.rimNote].filter(Boolean).join(' · ') || null;
}

/** A free-text order: first line is the headline, the rest detail. */
export function parseOrder(text: string): { title: string; details: string | null } {
  const [first, ...rest] = text.split('\n');
  return { title: first.trim().slice(0, 120), details: rest.join('\n').trim().slice(0, 800) || null };
}

/** The push notification for a new job. */
export function taskNotice(t: Pick<Task, 'title' | 'details' | 'location' | 'kind'>) {
  const what = t.kind === 'prepare' ? 'Sagatavot riepas' : t.kind === 'store' ? 'Novietot glabāšanā' : 'Jauns pasūtījums';
  const body = [t.location ? (t.kind === 'prepare' ? `Vieta ${t.location}` : t.location) : null, t.title, t.details].filter(Boolean).join(' · ');
  return { title: `R1 · ${what}`, body: body.slice(0, 160), url: '/noliktava', tag: 'r1-task' };
}
