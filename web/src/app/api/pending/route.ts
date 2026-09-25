import { api } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { setCard } from '@/domain/records';
import { listRecords } from '@/server/repo/records';

/** Every prepared set (waiting for its swap), newest first. */
export const GET = api({ perm: 'screen.pending' }, async ({ perms }) => {
  const recs = redactAll(await listRecords({ status: 'prepared' }), perms)
    .sort((a, b) => (b.preparedDate ?? '').localeCompare(a.preparedDate ?? ''));
  return { count: recs.length, pending: recs.map(setCard) };
});
