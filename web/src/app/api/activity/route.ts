import { api } from '@/server/http';
import { activityFeed } from '@/domain/history';
import { todayIso } from '@/domain/format';
import { listRecords } from '@/server/repo/records';
import { recentEvents } from '@/server/repo/misc';

export const GET = api({ perm: 'screen.home' }, async ({ perms, branchId }) => {
  const [all, events] = await Promise.all([listRecords({ branchId }), recentEvents(40, branchId)]);
  return { events: activityFeed(all, events, perms, todayIso()) };
});
