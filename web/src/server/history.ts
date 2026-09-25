import { buildHistory } from '@/domain/history';
import { todayIso } from '@/domain/format';
import type { Perms } from '@/domain/perms';
import { listRecords } from './repo/records';
import { recentEvents } from './repo/misc';

/** Shared by the Vēsture screen and its Excel export, so both show the same rows. */
export async function loadHistory(query: URLSearchParams, perms: Perms) {
  const [all, events] = await Promise.all([listRecords(), recentEvents(5000)]);
  const types = query.get('types');
  return buildHistory(all, events, perms, todayIso(), {
    from: query.get('from') ?? '', to: query.get('to') ?? '',
    types: types ? types.split(',') : null, q: query.get('q') ?? '',
  });
}
