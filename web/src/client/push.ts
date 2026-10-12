'use client';

import { api, post } from './api';

/** Whether this device is registered for server push (then local alerts would double up). */
export const pushState = { on: false };

export interface PushCfg { enabled: boolean; publicKey: string | null; devices: number }

const b64ToU8 = (s: string) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Register this device with the server. Quietly false when push isn't configured or allowed. */
export async function subscribePush(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const cfg = await api<PushCfg>('/api/push/key');
    if (!cfg.enabled || !cfg.publicKey) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.publicKey) });
    await post('/api/push/subscribe', sub.toJSON());
    pushState.on = true;
    return true;
  } catch (e) {
    console.warn('push subscribe failed', e);
    return false;
  }
}

/** Ask for permission, then register. */
export async function enablePush(): Promise<'on' | 'blocked' | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return 'blocked';
  await subscribePush();
  return 'on';
}
