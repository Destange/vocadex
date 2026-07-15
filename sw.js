/* VocaDex service worker */
const VERSION = '1.0.0';
const CACHE = 'vocadex-' + VERSION;
const ASSETS = ['.', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('vocadex-') && k !== CACHE && k !== 'vocadex-meta').map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;             // API externes : réseau direct
  if (e.request.mode === 'navigate') {
    // network-first pour toujours avoir la dernière version, cache en secours (offline)
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('index.html', copy));
        return r;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }))
  );
});

/* ---------- Rappels (Periodic Background Sync, Chrome Android) ---------- */
const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60];
function isDue(card, now) {
  if (card.seen === 0) return true;
  const iv = INTERVALS[Math.min(card.streak, INTERVALS.length - 1)];
  return now - card.last >= iv * 86400000;
}

async function checkAndNotify() {
  try {
    const cache = await caches.open('vocadex-meta');
    const res = await cache.match('/meta.json');
    if (!res) return;
    const meta = await res.json();
    if (!meta.reminders) return;
    const now = Date.now();
    // pas de rappel si l'app a été ouverte il y a moins de 18 h
    if (now - meta.lastOpen < 18 * 3600000) return;
    // max un rappel par 20 h
    const lastN = await cache.match('/lastnotif');
    if (lastN) {
      const t = parseInt(await lastN.text());
      if (now - t < 20 * 3600000) return;
    }
    const due = (meta.cards || []).filter(c => isDue(c, now)).length;
    if (due === 0) return;
    await self.registration.showNotification('VocaDex 📖', {
      body: due === 1 ? 'Un mot t’attend pour la révision !'
                      : due + ' mots t’attendent pour la révision !',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'vocadex-reminder'
    });
    await cache.put('/lastnotif', new Response(String(now)));
  } catch (e) { /* silencieux */ }
}

self.addEventListener('periodicsync', e => {
  if (e.tag === 'vocadex-reminder') e.waitUntil(checkAndNotify());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('.');
    })
  );
});
