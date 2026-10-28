/**
 * R1 Tires service worker.
 *  1. Makes the app installable on a phone (Add to home screen).
 *  2. Receives Web Push, so the warehouse gets a notification the moment a job
 *     is queued — even with the app closed.
 * API responses are NEVER cached; only the shell and static assets are.
 */
const CACHE = 'r1-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/vendor/sweetalert2.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
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
  if (url.pathname.startsWith('/api/')) return; // always live data

  // Navigations: network first (the app must never be stale), cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {}); return res; })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }
  // Static assets: serve from cache, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }).catch(() => hit || Response.error());
      return hit || net;
    }),
  );
});

self.addEventListener('push', (e) => {
  let d = { title: 'R1 Tires', body: 'Jauns uzdevums noliktavā', url: '/?view=warehouse' };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'r1-task',
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: d.url || '/?view=warehouse' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/?view=warehouse';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse an open window if there is one; the client jumps to the view itself.
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
