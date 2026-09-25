import { api, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { releaseMatches, setCard } from '@/domain/records';
import { normCode } from '@/domain/types';
import { listRecords } from '@/server/repo/records';

/**
 * Find sets in storage by SMS code, plate or place. Matching may use the SMS
 * code (that is how customers identify themselves); only the payload is cut
 * down to what this user may see.
 */
export const GET = api({ perm: 'act.operate' }, async ({ query, perms }) => {
  const q = normCode(qs(query, 'q'));
  if (!q) return { q: '', results: [] };
  const hits = releaseMatches(await listRecords({ status: 'active' }), q);
  return { q, results: redactAll(hits, perms).map(setCard) };
});
