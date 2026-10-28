import type { Store } from './types.js';

/**
 * Web Push (VAPID) — how the warehouse phone gets told about a new job even when
 * the app isn't open. Configure with:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (generate: npx web-push generate-vapid-keys)
 *   VAPID_SUBJECT                          (mailto: address or site URL)
 * Without those keys push is simply OFF — the app still works and the warehouse
 * view falls back to polling + an in-app notification while it's open.
 */
export const pushEnabled = (): boolean =>
  !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export const vapidPublicKey = (): string | null => process.env.VAPID_PUBLIC_KEY ?? null;

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

/**
 * Send a notification to every registered device. Dead subscriptions (the browser
 * uninstalled the app or revoked permission) answer 404/410 — drop those so the
 * table doesn't grow stale. Never throws: a failed push must not fail the request
 * that triggered it.
 */
export async function pushToAll(store: Store, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!pushEnabled()) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  try {
    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@r1riepas.lv',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    const subs = await store.listPushSubs();
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        sent++;
      } catch (err) {
        failed++;
        const code = (err as { statusCode?: number }).statusCode;
        // 404/410 = the device is gone for good; anything else points at a config
        // problem (wrong VAPID pair, blocked egress) and is worth seeing in logs.
        if (code === 404 || code === 410) { try { await store.deletePushSub(s.endpoint); } catch { /* ignore */ } }
        else console.warn(`[push] send failed (${code ?? 'no status'}) for ${s.endpoint.slice(0, 60)}…`);
      }
    }));
  } catch (err) {
    console.error('[push] send failed:', err);
  }
  return { sent, failed };
}
