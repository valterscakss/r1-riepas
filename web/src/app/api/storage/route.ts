import { api, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { listRecords } from '@/server/repo/records';

export const GET = api({ perm: 'screen.table' }, async ({ query, perms }) => {
  const s = qs(query, 'status');
  const status = s === 'released' ? 'released' : s === 'active' ? 'active' : undefined;
  const records = redactAll(await listRecords({ status, q: qs(query, 'q') || undefined }), perms);
  return { count: records.length, records };
});
