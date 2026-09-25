import { api } from '@/server/http';
import { HISTORY_PAGE } from '@/domain/history';
import { loadHistory } from '@/server/history';

/** Full history, filterable and paged 50 at a time. */
export const GET = api({ perm: 'screen.history' }, async ({ query, perms }) => {
  const list = await loadHistory(query, perms);
  const page = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
  return {
    total: list.length, page, pages: Math.max(1, Math.ceil(list.length / HISTORY_PAGE)),
    events: list.slice((page - 1) * HISTORY_PAGE, page * HISTORY_PAGE),
  };
});
