import { api, bad } from '@/server/http';
import { intake } from '@/server/services';

export const POST = api({ perm: 'act.operate' }, async ({ body, actor }) => {
  const b = await body();
  if (!b.plate) throw bad('Numura zīme ir obligāta');
  return Response.json(await intake(b, actor), { status: 201 });
});
