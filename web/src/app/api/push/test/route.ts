import { api, bad } from '@/server/http';
import { pushEnabled, pushToAll } from '@/server/push';
import { countPushSubs } from '@/server/repo/misc';

/** Prove the whole chain works without ordering something for real. */
export const POST = api('user', async ({ actor }) => {
  if (!pushEnabled()) throw bad('Paziņojumi nav konfigurēti (trūkst VAPID atslēgu)');
  const devices = await countPushSubs();
  if (!devices) throw bad('Neviena ierīce nav pieteikta. Nospied “Paziņojumi” Noliktavas skatā.');
  const { sent, failed } = await pushToAll({ title: 'R1 · Tests', body: `Paziņojumi darbojas · pārbaudīja ${actor}`, url: '/noliktava', tag: 'r1-test' });
  return { ok: true, devices, sent, failed };
});
