/* ===================================================================
   BIGBANG CRM — sync.js
   Đồng bộ Supabase: offline-first (IndexedDB là cache, cloud là gốc)
   - Mọi thay đổi local được xếp vào "outbox" rồi đẩy lên cloud
   - Mở app / bấm Đồng bộ: kéo dữ liệu cloud về, merge theo updated_at
   - Không cấu hình Supabase => app chạy local y như cũ
   =================================================================== */

// ===== DB v3: thêm cột uuid + bảng outbox =====
db.version(3).stores({
  customers: '++id, uuid, name, phone, zalo, social, source, note, created_at',
  orders: '++id, uuid, order_code, customer_id, show_day, ticket_tier, quantity, unit_price, total, deposit_amount, status, payment_proof, delivery_method, ctv, note, created_at, updated_at',
  inventory: '++id, uuid, show_day, ticket_tier, total_stock, cost_price',
  settings: 'key',
  resales: '++id, uuid, order_id, customer_name, status, created_at',
  outbox: '++id, table_name, created_at'
});
// ===== DB v4: thêm email vào customers (fix conflict với app.js v3) =====
db.version(4).stores({
  customers: '++id, uuid, name, phone, email, zalo, social, source, note, created_at',
  orders: '++id, uuid, order_code, customer_id, show_day, ticket_tier, quantity, unit_price, total, deposit_amount, status, payment_proof, delivery_method, ctv, note, created_at, updated_at',
  inventory: '++id, uuid, show_day, ticket_tier, total_stock, cost_price',
  settings: 'key',
  resales: '++id, uuid, order_id, customer_name, status, created_at',
  outbox: '++id, table_name, created_at'
});

// ===== SUPABASE DEFAULTS (hardcode để không mất kết nối khi xóa cache) =====
const DEFAULT_SUPABASE_URL = 'https://satcrqkyxrrioctncokv.supabase.co';
const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhdGNycWt5eHJyaW9jdG5jb2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNzg5MDMsImV4cCI6MjA5Njc1NDkwM30.dpMVDMnX6wvmaUfAmu0NxYVqXE-sbSYnUi9Ufz4-Ce0';

// ===== STATE =====
let sb = null;                 // supabase client
let sbReady = false;           // đã đăng nhập thành công
let syncTimer = null;
let pulling = false;           // đang pull => hooks không enqueue (tránh vòng lặp)
const SYNC_TABLES = ['customers', 'orders', 'inventory', 'resales'];
const SETTINGS_NO_SYNC = ['supabaseUrl', 'supabaseKey', 'supabaseEmail', 'supabasePassword', 'lastBackup'];
const outboxRetryCount = new Map(); // theo dõi số lần lỗi để bỏ qua item kẹt vĩnh viễn

function genUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ===== HOOKS: tự bắt mọi thay đổi, không cần sửa code cũ =====
SYNC_TABLES.forEach(tableName => {
  db[tableName].hook('creating', function (primKey, obj) {
    if (!obj.uuid) obj.uuid = genUUID();
    if (!pulling) {
      const self = this;
      this.onsuccess = function (id) {
        enqueue(tableName, 'upsert', { ...obj, id });
      };
    }
  });
  db[tableName].hook('updating', function (mods, primKey, obj) {
    if (!pulling) {
      this.onsuccess = function () {
        enqueue(tableName, 'upsert', { ...obj, ...mods, id: primKey });
      };
    }
  });
  db[tableName].hook('deleting', function (primKey, obj) {
    if (!pulling && obj && obj.uuid) {
      this.onsuccess = function () {
        enqueue(tableName, 'delete', { uuid: obj.uuid });
      };
    }
  });
});

db.settings.hook('updating', function (mods, primKey, obj) {
  if (!pulling && !SETTINGS_NO_SYNC.includes(primKey)) {
    this.onsuccess = function () {
      enqueue('app_settings', 'upsert', { key: primKey, value: (mods.value !== undefined ? mods.value : obj.value) });
    };
  }
});
db.settings.hook('creating', function (primKey, obj) {
  if (!pulling && !SETTINGS_NO_SYNC.includes(obj.key)) {
    this.onsuccess = function () {
      enqueue('app_settings', 'upsert', { key: obj.key, value: obj.value });
    };
  }
});

async function enqueue(tableName, op, payload) {
  try {
    await db.outbox.add({ table_name: tableName, op, payload: JSON.stringify(payload), created_at: new Date().toISOString() });
    updateSyncStatus();
    debouncedPush();
  } catch (e) { console.error('enqueue', e); }
}

function debouncedPush() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(processOutbox, 1500);
}

// ===== CHUYỂN ĐỔI RECORD LOCAL -> CLOUD =====
async function toCloud(tableName, rec) {
  if (tableName === 'customers') {
    return {
      uuid: rec.uuid, name: rec.name || '', phone: rec.phone || '', email: rec.email || '', zalo: rec.zalo || '',
      social: rec.social || '', source: rec.source || '', note: rec.note || '',
      created_at: rec.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(), deleted: false
    };
  }
  if (tableName === 'orders') {
    let customerUuid = null;
    if (rec.customer_id) {
      const c = await db.customers.get(rec.customer_id);
      if (c) {
        if (!c.uuid) { c.uuid = genUUID(); await db.customers.update(c.id, { uuid: c.uuid }); }
        customerUuid = c.uuid;
      }
    }
    return {
      uuid: rec.uuid, order_code: rec.order_code, customer_uuid: customerUuid,
      show_day: rec.show_day, ticket_tier: rec.ticket_tier, quantity: rec.quantity || 0,
      unit_price: rec.unit_price || 0, total: rec.total || 0, deposit_amount: rec.deposit_amount || 0,
      status: rec.status, delivery_method: rec.delivery_method || '', ctv: rec.ctv || '',
      seat_number: rec.seat_number || '',
      ticket_source: rec.ticket_source || '',
      combo_info: rec.combo_info || '',
      payment_proof: rec.payment_proof || '',
      note: rec.note || '', created_at: rec.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(), deleted: !!rec.deleted_at
    };
  }
  if (tableName === 'inventory') {
    return {
      uuid: rec.uuid, show_day: rec.show_day, ticket_tier: rec.ticket_tier,
      total_stock: rec.total_stock || 0, cost_price: rec.cost_price || 0,
      updated_at: new Date().toISOString(), deleted: false
    };
  }
  if (tableName === 'resales') {
    let orderUuid = null;
    if (rec.order_id) {
      const o = await db.orders.get(rec.order_id);
      if (o && o.uuid) orderUuid = o.uuid;
    }
    return {
      uuid: rec.uuid, order_uuid: orderUuid, order_code: rec.order_code || '',
      customer_name: rec.customer_name || '', customer_phone: rec.customer_phone || '',
      show_day: rec.show_day, ticket_tier: rec.ticket_tier, quantity: rec.quantity || 0,
      original_price: rec.original_price || 0, asking_price: rec.asking_price || 0,
      service_fee: rec.service_fee || 0, seat_number: rec.seat_number || '', reason: rec.reason || '', note: rec.note || '',
      status: rec.status, created_at: rec.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(), deleted: false
    };
  }
  return rec;
}

// ===== ĐẨY OUTBOX LÊN CLOUD =====
async function processOutbox() {
  if (!sbReady || !navigator.onLine) { updateSyncStatus(); return; }
  const items = await db.outbox.orderBy('id').limit(50).toArray();
  if (items.length === 0) { updateSyncStatus(); return; }

  for (const item of items) {
    try {
      const payload = JSON.parse(item.payload);
      if (item.op === 'delete') {
        const { error } = await sb.from(item.table_name).update({ deleted: true, updated_at: new Date().toISOString() }).eq('uuid', payload.uuid);
        if (error) throw error;
      } else if (item.table_name === 'app_settings') {
        const { error } = await sb.from('app_settings').upsert({ key: payload.key, value: String(payload.value), updated_at: new Date().toISOString() });
        if (error) throw error;
      } else {
        const cloudRec = await toCloud(item.table_name, payload);
        if (!cloudRec.uuid) { await db.outbox.delete(item.id); continue; }
        const { error } = await sb.from(item.table_name).upsert(cloudRec);
        if (error) throw error;
      }
      await db.outbox.delete(item.id);
    } catch (e) {
      const retries = (outboxRetryCount.get(item.id) || 0) + 1;
      outboxRetryCount.set(item.id, retries);
      console.error('push fail', item.table_name, e, `(lần ${retries}/3)`);
      if (retries >= 3) {
        console.error('Outbox item bỏ qua sau 3 lần lỗi:', item);
        await db.outbox.delete(item.id);
        outboxRetryCount.delete(item.id);
        if (typeof showToast === 'function') showToast('Bỏ qua 1 bản ghi lỗi đồng bộ', 'warning');
        continue;
      }
      updateSyncStatus('error');
      return; // dừng, thử lại lần sau
    }
  }
  // còn nữa thì đẩy tiếp
  const remaining = await db.outbox.count();
  if (remaining > 0) processOutbox();
  else updateSyncStatus();
}

// ===== KÉO DỮ LIỆU CLOUD VỀ & MERGE =====
async function pullAll(showResult) {
  if (!sbReady) return;
  pulling = true;
  try {
    // 1. Customers trước (orders cần map customer_uuid -> id local)
    const { data: cloudCustomers, error: e1 } = await sb.from('customers').select('*');
    if (e1) throw e1;
    const uuidToLocalId = {};
    for (const cc of (cloudCustomers || [])) {
      const local = await db.customers.where('uuid').equals(cc.uuid).first();
      if (cc.deleted) { if (local) await db.customers.delete(local.id); continue; }
      if (!local) {
        const id = await db.customers.add({
          uuid: cc.uuid, name: cc.name, phone: cc.phone, email: cc.email || '', zalo: cc.zalo, social: cc.social,
          source: cc.source, note: cc.note, created_at: cc.created_at, updated_at: cc.updated_at
        });
        uuidToLocalId[cc.uuid] = id;
      } else {
        if (new Date(cc.updated_at) > new Date(local.updated_at || 0)) {
          await db.customers.update(local.id, { name: cc.name, phone: cc.phone, email: cc.email || '', zalo: cc.zalo, social: cc.social, source: cc.source, note: cc.note, updated_at: cc.updated_at });
        }
        uuidToLocalId[cc.uuid] = local.id;
      }
    }

    // 2. Orders
    const { data: cloudOrders, error: e2 } = await sb.from('orders').select('*');
    if (e2) throw e2;
    for (const co of (cloudOrders || [])) {
      const local = await db.orders.where('uuid').equals(co.uuid).first();
      if (co.deleted) { if (local) await db.orders.delete(local.id); continue; }
      const fields = {
        order_code: co.order_code, customer_id: uuidToLocalId[co.customer_uuid] || (local ? local.customer_id : null),
        show_day: co.show_day, ticket_tier: co.ticket_tier, quantity: co.quantity,
        unit_price: co.unit_price, total: co.total, deposit_amount: co.deposit_amount,
        status: co.status, delivery_method: co.delivery_method, ctv: co.ctv, seat_number: co.seat_number || '', ticket_source: co.ticket_source || '', combo_info: co.combo_info || '', payment_proof: co.payment_proof || '', note: co.note,
        created_at: co.created_at, updated_at: co.updated_at
      };
      if (!local) await db.orders.add({ uuid: co.uuid, payment_proof: '', ...fields });
      else if (new Date(co.updated_at) > new Date(local.updated_at || 0)) await db.orders.update(local.id, fields);
    }

    // 3. Inventory
    const { data: cloudInv, error: e3 } = await sb.from('inventory').select('*');
    if (e3) throw e3;
    for (const ci of (cloudInv || [])) {
      const local = await db.inventory.where('uuid').equals(ci.uuid).first();
      if (ci.deleted) { if (local) await db.inventory.delete(local.id); continue; }
      if (!local) await db.inventory.add({ uuid: ci.uuid, show_day: ci.show_day, ticket_tier: ci.ticket_tier, total_stock: ci.total_stock, cost_price: ci.cost_price });
      else await db.inventory.update(local.id, { total_stock: ci.total_stock, cost_price: ci.cost_price });
    }

    // 4. Resales
    const { data: cloudRes, error: e4 } = await sb.from('resales').select('*');
    if (e4) throw e4;
    for (const cr of (cloudRes || [])) {
      const local = await db.resales.where('uuid').equals(cr.uuid).first();
      if (cr.deleted) { if (local) await db.resales.delete(local.id); continue; }
      const fields = {
        order_code: cr.order_code, customer_name: cr.customer_name, customer_phone: cr.customer_phone,
        show_day: cr.show_day, ticket_tier: cr.ticket_tier, quantity: cr.quantity,
        original_price: cr.original_price, asking_price: cr.asking_price, service_fee: cr.service_fee,
        reason: cr.reason, seat_number: cr.seat_number || '', note: cr.note, status: cr.status, created_at: cr.created_at, updated_at: cr.updated_at
      };
      if (!local) await db.resales.add({ uuid: cr.uuid, order_id: null, ...fields });
      else if (new Date(cr.updated_at) > new Date(local.updated_at || 0)) await db.resales.update(local.id, fields);
    }

    // 5. Settings dùng chung (hạng vé, tên shop, orderCounter...)
    const { data: cloudSettings, error: e5 } = await sb.from('app_settings').select('*');
    if (e5) throw e5;
    for (const cs of (cloudSettings || [])) {
      if (SETTINGS_NO_SYNC.includes(cs.key)) continue;
      const local = await db.settings.get(cs.key);
      if (!local) await db.settings.put({ key: cs.key, value: cs.value });
      else if (cs.key === 'orderCounter') {
        // counter: luôn lấy MAX để không trùng mã giữa các máy
        const maxVal = Math.max(parseInt(local.value) || 0, parseInt(cs.value) || 0);
        await db.settings.put({ key: 'orderCounter', value: String(maxVal) });
      } else if (local.value !== cs.value) {
        await db.settings.put({ key: cs.key, value: cs.value });
      }
    }

    if (typeof refreshAll === 'function') await refreshAll();
    if (typeof loadSettings === 'function') await loadSettings();
    if (showResult) showToast('Đã đồng bộ xong với cloud!', 'success');
  } catch (e) {
    console.error('pull fail', e);
    if (showResult) showToast('Lỗi đồng bộ: ' + (e.message || e), 'error');
    updateSyncStatus('error');
  } finally {
    pulling = false;
    updateSyncStatus();
  }
}

// ===== LẦN ĐẦU: backfill uuid + đẩy toàn bộ dữ liệu local lên =====
async function firstSyncUpload() {
  for (const tableName of SYNC_TABLES) {
    const rows = await db[tableName].toArray();
    for (const r of rows) {
      if (!r.uuid) {
        r.uuid = genUUID();
        pulling = true; // tránh hook enqueue 2 lần
        await db[tableName].update(r.id, { uuid: r.uuid });
        pulling = false;
      }
      await enqueue(tableName, 'upsert', r);
    }
  }
  const allSettings = await db.settings.toArray();
  for (const s of allSettings) {
    if (!SETTINGS_NO_SYNC.includes(s.key)) await enqueue('app_settings', 'upsert', { key: s.key, value: s.value });
  }
}

// ===== KẾT NỐI =====
async function connectSupabase(silent) {
  let url = (await db.settings.get('supabaseUrl'))?.value;
  let key = (await db.settings.get('supabaseKey'))?.value;
  const email = (await db.settings.get('supabaseEmail'))?.value;
  const password = (await db.settings.get('supabasePassword'))?.value;

  // Dùng defaults nếu settings bị mất (do xóa cache)
  if (!url) { url = DEFAULT_SUPABASE_URL; await db.settings.put({ key: 'supabaseUrl', value: url }); }
  if (!key) { key = DEFAULT_SUPABASE_KEY; await db.settings.put({ key: 'supabaseKey', value: key }); }

  if (!email || !password) {
    sbReady = false; updateSyncStatus(); return false;
  }
  if (typeof supabase === 'undefined') {
    if (!silent) showToast('Chưa tải được thư viện Supabase (kiểm tra mạng)', 'error');
    return false;
  }
  try {
    sb = supabase.createClient(url, key);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    sbReady = true;
    updateSyncStatus();

    // === REALTIME: nhận thông báo tức thời khi thiết bị khác tạo/sửa đơn ===
    try {
      sb.channel('crm-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
          if (pulling) return;
          const evt = payload.eventType;
          const data = payload.new || payload.old;
          const code = data?.order_code || '';

          await pullAll(false);

          if (evt === 'INSERT') {
            showToast('📬 Có đơn hàng mới: ' + code, 'info');
          } else if (evt === 'UPDATE') {
            showToast('🔄 Đơn ' + code + ' vừa được cập nhật', 'info');
          }

          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('BigBang CRM', {
              body: evt === 'INSERT' ? 'Đơn mới: ' + code : 'Cập nhật: ' + code,
              icon: 'icon-192.png'
            });
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, async (payload) => {
          if (pulling) return;
          await pullAll(false);
          const evt = payload.eventType;
          const data = payload.new || payload.old;
          const name = data?.name || '';
          if (evt === 'UPDATE') {
            showToast('👤 Thông tin khách ' + name + ' vừa được cập nhật', 'info');
          }
        })
        .subscribe();

      // Xin quyền notification (chỉ hỏi 1 lần)
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch (rtErr) {
      console.warn('Realtime subscription failed:', rtErr);
    }

    return true;
  } catch (e) {
    sbReady = false;
    if (!silent) showToast('Đăng nhập Supabase thất bại: ' + (e.message || e), 'error');
    updateSyncStatus('error');
    return false;
  }
}

// Nút "Kết nối & đồng bộ" trong Cài đặt
async function setupSupabase() {
  // URL và Key đã hardcode sẵn — chỉ cần email + mật khẩu
  const url = DEFAULT_SUPABASE_URL;
  const key = DEFAULT_SUPABASE_KEY;
  const email = document.getElementById('sb-email').value.trim();
  const password = document.getElementById('sb-password').value;
  if (!email || !password) {
    showToast('Điền email và mật khẩu Supabase để kết nối', 'error');
    return;
  }
  await db.settings.put({ key: 'supabaseUrl', value: url });
  await db.settings.put({ key: 'supabaseKey', value: key });
  await db.settings.put({ key: 'supabaseEmail', value: email });
  await db.settings.put({ key: 'supabasePassword', value: password });

  showToast('Đang kết nối...', 'info');
  const ok = await connectSupabase(false);
  if (!ok) return;

  // Backfill UUID cho tất cả record local thiếu uuid (quan trọng: đảm bảo mọi record đều sync được)
  let needsUpload = false;
  for (const tableName of SYNC_TABLES) {
    const rows = await db[tableName].toArray();
    for (const r of rows) {
      if (!r.uuid) {
        r.uuid = genUUID();
        pulling = true;
        await db[tableName].update(r.id, { uuid: r.uuid });
        pulling = false;
        needsUpload = true;
      }
    }
  }

  // Cloud trống mà local có dữ liệu => đẩy toàn bộ lên (lần đầu)
  const { count } = await sb.from('orders').select('uuid', { count: 'exact', head: true });
  const localCount = await db.orders.count();
  if ((count || 0) === 0 && localCount > 0) {
    showToast('Lần đầu: đang tải dữ liệu local lên cloud...', 'info');
    await firstSyncUpload();
    await processOutbox();
  } else if (needsUpload) {
    // Có record mới được gán UUID => đẩy lên cloud
    showToast('Đang đồng bộ dữ liệu thiếu lên cloud...', 'info');
    await firstSyncUpload();
    await processOutbox();
  }
  await pullAll(false);
  showToast('✅ Đã kết nối Supabase — dữ liệu giờ an toàn trên cloud!', 'success');
}

async function manualSync() {
  if (!sbReady) {
    const ok = await connectSupabase(false);
    if (!ok) { showToast('Chưa cấu hình Supabase — xem mục Đồng bộ cloud trong Cài đặt', 'warning'); return; }
  }
  showToast('Đang đồng bộ...', 'info');
  await processOutbox();
  await pullAll(true);
}

async function disconnectSupabase() {
  showConfirm('Ngắt kết nối cloud? Dữ liệu trên cloud vẫn còn, app quay về chế độ local.', async () => {
    for (const k of ['supabaseUrl', 'supabaseKey', 'supabaseEmail', 'supabasePassword']) {
      await db.settings.delete(k);
    }
    sbReady = false; sb = null;
    updateSyncStatus();
    showToast('Đã ngắt kết nối cloud', 'info');
  });
}

// ===== TRẠNG THÁI ĐỒNG BỘ (chấm màu trên header) =====
async function updateSyncStatus(forced) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-status-text');
  if (!dot) return;
  const pending = await db.outbox.count();
  let state, text;
  if (forced === 'error') { state = 'error'; text = 'Lỗi đồng bộ — sẽ tự thử lại'; }
  else if (!sbReady) {
    const hasCfg = (await db.settings.get('supabaseUrl'))?.value;
    state = hasCfg ? 'offline' : 'local';
    text = hasCfg ? 'Mất kết nối cloud — dữ liệu lưu tạm, sẽ tự đẩy lên khi có mạng' : 'Chế độ local (chưa bật đồng bộ cloud)';
  }
  else if (!navigator.onLine) { state = 'offline'; text = `Offline — ${pending} thay đổi chờ đẩy lên`; }
  else if (pending > 0) { state = 'pending'; text = `Đang đồng bộ ${pending} thay đổi...`; }
  else { state = 'synced'; text = 'Đã đồng bộ với cloud'; }
  dot.dataset.state = state;
  dot.title = text;
  if (label) label.textContent = text;
}

// ===== KHỞI ĐỘNG =====
window.uploadPaymentProofToSupabase = async function(file, orderCode) {
  if (!sbReady || !sb) throw new Error('Chưa kết nối Supabase, không thể upload ảnh trực tiếp!');
  
  const ext = file.name.split('.').pop();
  const fileName = `${orderCode}_${Date.now()}.${ext}`;
  const { data, error } = await sb.storage.from('payment_proofs').upload(fileName, file, {
    cacheControl: '3600',
    upsert: false
  });
  
  if (error) throw error;
  
  const { data: { publicUrl } } = sb.storage.from('payment_proofs').getPublicUrl(fileName);
  return publicUrl;
};

window.addEventListener('online', () => { updateSyncStatus(); processOutbox(); pullAll(false); });
window.addEventListener('offline', updateSyncStatus);
setInterval(() => { if (sbReady) { processOutbox(); pullAll(false); } }, 30000);

document.addEventListener('DOMContentLoaded', async () => {
  // Điền form cài đặt nếu đã lưu
  setTimeout(async () => {
    const url = (await db.settings.get('supabaseUrl'))?.value || '';
    const key = (await db.settings.get('supabaseKey'))?.value || '';
    const email = (await db.settings.get('supabaseEmail'))?.value || '';
    if (document.getElementById('sb-url')) {
      document.getElementById('sb-url').value = url;
      document.getElementById('sb-key').value = key;
      document.getElementById('sb-email').value = email;
    }
    const ok = await connectSupabase(true);
    if (ok) {
      // Auto-backfill UUID cho record cũ thiếu uuid
      let needsUpload = false;
      for (const tbl of SYNC_TABLES) {
        const rows = await db[tbl].toArray();
        for (const r of rows) {
          if (!r.uuid) {
            pulling = true;
            await db[tbl].update(r.id, { uuid: genUUID() });
            pulling = false;
            needsUpload = true;
          }
        }
      }
      if (needsUpload) {
        await firstSyncUpload();
      }
      await processOutbox();
      await pullAll(false);
    }
  }, 300);

  // Service Worker đã vô hiệu hóa theo quyết định HANDOFF.md (cache cứng đầu)
  // index.html đã unregister toàn bộ SW on load — không đăng ký lại ở đây
});
