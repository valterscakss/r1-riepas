import { api, bad, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { activeThenNewest, histItem } from '@/domain/records';
import { normCode } from '@/domain/types';
import { listRecords } from '@/server/repo/records';

/** Every season of one vehicle, for the spot panel. */
export const GET = api({ any: ['screen.spots', 'screen.customers'] }, async ({ query, perms }) => {
  const plate = normCode(qs(query, 'plate'));
  if (!plate) throw bad('plate is required');
  const recs = redactAll(await listRecords({ q: plate }), perms).filter((r) => normCode(r.plate) === plate).sort(activeThenNewest);
  if (!recs.length) return { plate, found: false, count: 0, customer: null, history: [] };
  const cur = recs.find((r) => r.status === 'active') ?? recs[0];
  return {
    plate, found: true, count: recs.length,
    customer: { name: cur.customerName, phone: cur.phone, isCompany: cur.isCompany, makeModel: cur.makeModel },
    history: recs.map(histItem),
  };
});
