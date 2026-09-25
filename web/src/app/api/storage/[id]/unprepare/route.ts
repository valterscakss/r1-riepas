import { api } from '@/server/http';
import { unprepare } from '@/server/services';

/** Undo a prepare — the set goes back in its place. */
export const POST = api<{ id: string }>({ perm: 'act.operate' }, async ({ params, body, actor }) => unprepare(params.id, await body(), actor));
