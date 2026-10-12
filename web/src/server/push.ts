import { deletePushSub, listPushSubs } from './repo/misc';

/**
 * Web Push (VAPID): how the warehouse phone hears about a new job with the app
 * closed. Without VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY push is simply off and
 * the app falls back to polling.
 */
export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

/**
 * Notify every registered device. Gone devices (404/410) are dropped. Never
 * throws: a failed push must not fail the request that triggered it.
 */
export async function pushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!pushEnabled()) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  try {
    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@r1riepas.lv', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    const subs = await listPushSubs();
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        sent++;
      } catch (err) {
        failed++;
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await deletePushSub(s.endpoint).catch(() => undefined);
        else console.warn(`[push] send failed (${code ?? 'no status'}) for ${s.endpoint.slice(0, 60)}…`);
      }
    }));
  } catch (err) {
    console.error('[push] send failed:', err);
  }
  return { sent, failed };
}
