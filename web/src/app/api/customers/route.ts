import { api, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { groupCustomers } from '@/domain/records';
import { listRecords } from '@/server/repo/records';

export const GET = api({ perm: 'screen.customers' }, async ({ query, perms }) => {
  const q = qs(query, 'q').toUpperCase();
  const type = qs(query, 'type');
  let all = redactAll(await listRecords(q ? { q } : {}), perms);
  if (type === 'company') all = all.filter((r) => r.isCompany);
  else if (type === 'private') all = all.filter((r) => !r.isCompany);
  return { customers: groupCustomers(all, process.env.DUMMY_PHONE || '01010101010') };
});
