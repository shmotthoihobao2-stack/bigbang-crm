/* BigBang CRM — Service Worker (PWA offline) */
const CACHE = 'bbcrm-v20';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sync.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];
const CDN = [
  'https://unpkg.com/dexie@3/dist/dexie.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // CDN cache riêng từng cái để 1 cái lỗi không hỏng cả batch
    for (const url of CDN) {
      try { await cache.add(new Request(url, { mode: 'no-cors' })); } catch (err) {}
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // KHÔNG cache API Supabase — dữ liệu phải luôn tươi
  if (url.hostname.endsWith('.supabase.co')) return;
  if (e.request.method !== 'GET') return;

  // Cache-first cho app shell + CDN; nền vẫn cập nhật bản mới (stale-while-revalidate)
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    const fetchPromise = fetch(e.request).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => cached);
    return cached || fetchPromise;
  })());
});
