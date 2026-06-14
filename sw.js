/* BigBang CRM — Service Worker KILL-SWITCH
   SW cache-first cũ khiến điện thoại/máy KẸT bản code cũ (không nhận được bản vá đồng bộ).
   File này KHÔNG cache gì nữa: tự xóa sạch cache + tự gỡ chính nó -> mọi thiết bị quay về
   tải trực tiếp từ mạng (luôn mới). Kết hợp với cache-bust ?v=<commit> trên app.js/sync.js. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (err) {}
    try { await self.registration.unregister(); } catch (err) {}
    // Tải lại các tab đang mở để chúng lấy bản mới ngay
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => { try { c.navigate(c.url); } catch (e) {} });
    } catch (err) {}
  })());
});

// KHÔNG có handler 'fetch' -> không can thiệp request nào, mọi thứ đi thẳng ra mạng.
