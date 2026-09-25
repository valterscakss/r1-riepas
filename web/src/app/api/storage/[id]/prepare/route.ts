import { api } from '@/server/http';
import { prepare } from '@/server/services';

/** Stage a set for a seasonal swap: tires out, place stays reserved. */
export const POST = api<{ id: string }>({ perm: 'act.operate' }, async ({ params, body, actor }) => prepare(params.id, await body(), actor));
