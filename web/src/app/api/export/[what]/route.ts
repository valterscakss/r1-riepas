import { api, bad, notFound, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { analytics } from '@/domain/analytics';
import { matches } from '@/domain/types';
import { analyticsRows, customerRows, historyRows, pendingRows, spotRows, storageRows, taskRows, toXlsx } from '@/domain/excel/export';
import { todayIso } from '@/domain/format';
import { listRecords } from '@/server/repo/records';
import { listTasks } from '@/server/repo/misc';
import { loadHistory } from '@/server/history';
import { loadUniverse } from '@/server/services';

const SHEETS: Record<string, [sheet: string, file: string]> = {
  storage: ['Tabula', 'tabula'], history: ['Vēsture', 'vesture'], analytics: ['Analītika', 'analitika'],
  customers: ['Klienti', 'klienti'], tasks: ['Noliktava', 'noliktava'], pending: ['Sagatavotie', 'sagatavotie'], spots: ['Novietnes', 'novietnes'],
};

/** Every list leaves as .xlsx with the same filters and field rules as on screen. */
export const GET = api<{ what: string }>({ perm: 'act.export' }, async ({ params, query, perms }) => {
  const what = params.what;
  if (!SHEETS[what]) throw bad('Nezināms eksporta veids');
  const q = qs(query, 'q');
  let rows: Array<Record<string, string | number>>;
  if (what === 'storage') {
    const status = qs(query, 'status');
    let recs = redactAll(await listRecords(), perms);
    if (status === 'active' || status === 'released' || status === 'prepared') recs = recs.filter((r) => r.status === status);
    if (q) recs = recs.filter((r) => matches(r, q));
    rows = storageRows(recs);
  } else if (what === 'history') {
    rows = historyRows(await loadHistory(query, perms));
  } else if (what === 'analytics') {
    rows = analyticsRows(analytics(await listRecords(), { season: qs(query, 'season'), status: qs(query, 'status'), customer: qs(query, 'customer'), rims: qs(query, 'rims') }));
  } else if (what === 'customers') {
    const type = qs(query, 'type');
    let recs = redactAll(await listRecords(q ? { q } : {}), perms);
    if (type === 'company') recs = recs.filter((r) => r.isCompany);
    else if (type === 'private') recs = recs.filter((r) => !r.isCompany);
    rows = customerRows(recs);
  } else if (what === 'tasks') {
    const s = qs(query, 'status');
    rows = taskRows(await listTasks({ status: s === 'done' ? 'done' : s === 'all' ? undefined : 'open', limit: 500 }));
  } else if (what === 'pending') {
    const recs = redactAll(await listRecords({ status: 'prepared' }), perms).sort((a, b) => (b.preparedDate ?? '').localeCompare(a.preparedDate ?? ''));
    rows = pendingRows(recs);
  } else {
    rows = spotRows(await loadUniverse(), perms);
  }
  if (!rows.length) throw notFound(what === 'pending' ? 'Nav sagatavotu riepu' : 'Nav ko eksportēt');
  const [sheet, file] = SHEETS[what];
  return new Response(new Uint8Array(toXlsx(rows, sheet)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="r1-${file}-${todayIso()}.xlsx"`,
    },
  });
});
