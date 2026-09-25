import { api, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { companySuggestions } from '@/domain/records';
import { listRecords } from '@/server/repo/records';

export const GET = api({ perm: 'act.operate' }, async ({ query, perms }) => {
  // The suggestions ARE customer names — nothing to offer without that field.
  if (!perms['field.customer']) return { suggestions: [] };
  return { suggestions: companySuggestions(redactAll(await listRecords(), perms), qs(query, 'q')) };
});
