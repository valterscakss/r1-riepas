import { api } from '@/server/http';
import { pushEnabled, vapidPublicKey } from '@/server/push';
import { countPushSubs } from '@/server/repo/misc';

export const GET = api('user', async () => ({
  enabled: pushEnabled(), publicKey: vapidPublicKey(), devices: await countPushSubs().catch(() => 0),
}));
