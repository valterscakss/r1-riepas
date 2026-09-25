import { api, bad, qs } from '@/server/http';
import { redactAll } from '@/domain/perms';
import { plateLookup } from '@/domain/records';
import { normCode } from '@/domain/types';
import { listRecords } from '@/server/repo/records';

/** Intake prefill: what we know about this plate from its latest record. */
export const GET = api({ perm: 'act.operate' }, async ({ query, perms }) => {
  const plate = normCode(qs(query, 'plate'));
  if (!plate) throw bad('plate is required');
  return plateLookup(redactAll(await listRecords({ q: plate }), perms), plate);
});
