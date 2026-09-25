import { api, qs } from '@/server/http';
import { analytics } from '@/domain/analytics';
import { listRecords } from '@/server/repo/records';

export const GET = api({ perm: 'screen.analytics' }, async ({ query }) =>
  analytics(await listRecords(), { season: qs(query, 'season'), status: qs(query, 'status'), customer: qs(query, 'customer'), rims: qs(query, 'rims') }));
