/**
 * R1 Tires service worker.
 *  1. Makes the app installable on a phone (Add to home screen).
 *  2. Receives Web Push, so the warehouse hears about a job with the app closed.
 * API responses and pages are never served from cache while online; only
 * Next's immutable build assets and the icons are cached.
 */
const CACHE = 'r1-next-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  // Drop the old app's shell cache (r1-shell-v1) and any older version of ours.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Content-hashed build output and icons never change under the same URL.
  const immutable = url.pathname.startsWith('/_next/static/') || /^\/icon-.*\.png$/.test(url.pathname);
  if (!immutable) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    })),
  );
});

self.addEventListener('push', (e) => {
  let d = { title: 'R1 Tires', body: 'Jauns uzdevums noliktavā', url: '/noliktava' };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'r1-task',
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: d.url || '/noliktava' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/noliktava';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse an open window if there is one; the app navigates itself.
      for (const c of list) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
          c.postMessage({ type: 'r1-open', url: target });
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
