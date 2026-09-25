import { api, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { plateSuggestions } from '@/domain/records';
import { normCode } from '@/domain/types';
import { listRecords } from '@/server/repo/records';

export const GET = api({ perm: 'act.operate' }, async ({ query, perms }) => {
  const q = normCode(qs(query, 'q'));
  if (q.length < 2) return { suggestions: [] };
  return { suggestions: plateSuggestions(redactAll(await listRecords({ q }), perms), q) };
});
