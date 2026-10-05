import { api, bad } from '@/server/http';
import { addPushSub } from '@/server/repo/misc';

export const POST = api('user', async ({ body, actor }) => {
  const b = await body() as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
  const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh : '';
  const auth = typeof b.keys?.auth === 'string' ? b.keys.auth : '';
  // Only real push services: an arbitrary URL would make the server send requests wherever it points.
  if (!endpoint || !p256dh || !auth || !/^https:\/\//.test(endpoint)) throw bad('Nederīga abonēšana');
  await addPushSub({ endpoint, p256dh, auth, username: actor });
  return { ok: true };
});
