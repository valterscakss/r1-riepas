import { api } from '@/server/http';
import { release } from '@/server/services';

export const POST = api<{ id: string }>({ perm: 'act.operate' }, async ({ params, body, actor }) => release(params.id, await body(), actor));
