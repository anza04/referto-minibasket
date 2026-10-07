/* Service worker: rende l'app completamente utilizzabile offline */
const CACHE = 'referto-mb-v4';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/templates.js', './js/rules.js', './js/engine.js', './js/xlsx.js', './js/storage.js', './js/app.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google API: sempre in rete
  // cache prima (avvio istantaneo anche offline), aggiornamento in background
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      const net = fetch(e.request, { cache: 'no-cache' }).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      }).catch(() => cached || caches.match('./index.html'));
      return cached || net;
    })
  );
});
