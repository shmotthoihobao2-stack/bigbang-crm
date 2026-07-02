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
// ===== DB v5: bảng history (snapshot bản cũ trước khi bị ghi đè -> khôi phục được, chống mất dữ liệu) =====
db.version(5).stores({
  customers: '++id, uuid, name, phone, email, zalo, social, source, note, created_at',
  orders: '++id, uuid, order_code, customer_id, show_day, ticket_tier, quantity, unit_price, total, deposit_amount, status, payment_proof, delivery_method, ctv, note, created_at, updated_at',
  inventory: '++id, uuid, show_day, ticket_tier, total_stock, cost_price',
  settings: 'key',
  resales: '++id, uuid, order_id, customer_name, status, created_at',
  outbox: '++id, table_name, created_at',
  history: '++id, table_name, uuid, replaced_at'
});

// ===== SUPABASE DEFAULTS (hardcode để không mất kết nối khi xóa cache) =====
const DEFAULT_SUPABASE_URL = 'https://satcrqkyxrrioctncokv.supabase.co';
const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhdGNycWt5eHJyaW9jdG5jb2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNzg5MDMsImV4cCI6MjA5Njc1NDkwM30.dpMVDMnX6wvmaUfAmu0NxYVqXE-sbSYnUi9Ufz4-Ce0';

// ===== STATE =====
let sb = null;                 // supabase client
let sbReady = false;           // đã đăng nhập thành công
let _realtimeChannel = null;   // giữ ref channel realtime để đóng đúng lúc (chống leak + nhận event N lần)
let syncTimer = null;
let pulling = 0;               // >0 => đang pull/backfill => hooks không enqueue. Counter để pullAll & reconcile không stomp cờ nhau.
const SYNC_TABLES = ['customers', 'orders', 'inventory', 'resales'];
// 'password' = hash mật khẩu đăng nhập app: KHÔNG sync (là credential + mã hóa supabasePassword là per-device;
// nếu sync, đổi pass máy A -> máy B kéo hash mới nhưng key cũ -> giải mã supabasePassword FAIL -> mất cloud).
const SETTINGS_NO_SYNC = ['password', 'supabaseUrl', 'supabaseKey', 'supabaseEmail', 'supabasePassword', 'supabasePasswordEnc', 'lastBackup'];
const MAX_OUTBOX_RETRIES = 5; // số lần lỗi tối đa cho 1 item trước khi bỏ qua (lưu bền trong record outbox)
const OUTBOX_BATCH = 50;      // số item xử lý mỗi vòng processOutbox (dùng 1 chỗ -> không lệch logic đệ quy)

function genUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ===== ENCRYPT supabasePassword trong IndexedDB (chống lộ qua DevTools/extension) =====
let _sessionKey = null;
async function _deriveKey(hashHex) {
  const raw = new TextEncoder().encode(hashHex);
  const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('bigbang-crm-v1'), iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function _encryptPwd(plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _sessionKey, new TextEncoder().encode(plain));
  return btoa(String.fromCharCode(...iv)) + ':' + btoa(String.fromCharCode(...new Uint8Array(ct)));
}
async function _decryptPwd(enc) {
  const [ivB64, ctB64] = enc.split(':');
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _sessionKey, ct);
  return new TextDecoder().decode(dec);
}
// Gọi từ app.js ngay sau khi login thành công — truyền vào sha256 hash của app password
window.setSessionKey = async function(appPasswordHash) {
  try { _sessionKey = await _deriveKey(appPasswordHash); } catch (e) { console.warn('setSessionKey', e); }
};
window.clearSessionKey = function() { _sessionKey = null; };
// Gọi từ changePassword: giải mã supabasePassword bằng key CŨ, đổi sang key MỚI, mã hóa lại.
// Thiếu bước này: đổi mật khẩu app -> mở lại app -> giải mã supabasePassword FAIL -> mất kết nối cloud.
window.rekeyAfterPasswordChange = async function(newAppPasswordHash) {
  let plain = null;
  try {
    const enc = (await db.settings.get('supabasePasswordEnc'))?.value;
    if (enc && _sessionKey) plain = await _decryptPwd(enc);
  } catch (e) { /* key cũ hỏng -> thử plaintext bên dưới */ }
  if (!plain) plain = (await db.settings.get('supabasePassword'))?.value || null;
  try { _sessionKey = await _deriveKey(newAppPasswordHash); } catch (e) { console.warn('rekey derive', e); }
  if (plain && _sessionKey) {
    try {
      await db.settings.put({ key: 'supabasePasswordEnc', value: await _encryptPwd(plain) });
      await db.settings.delete('supabasePassword');
    } catch (e) { console.warn('rekey encrypt', e); }
  }
};

// ===== HOOKS: tự bắt mọi thay đổi, không cần sửa code cũ =====
SYNC_TABLES.forEach(tableName => {
  db[tableName].hook('creating', function (primKey, obj) {
    if (!obj.uuid) obj.uuid = genUUID();
    // Luôn đảm bảo có updated_at -> last-write-wins so giờ THẬT, không bị toCloud gán giờ-sync giả
    if (!obj.updated_at) obj.updated_at = obj.created_at || new Date().toISOString();
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

// Gộp nhiều realtime event sát nhau thành 1 lần pullAll (chống lag giật khi có chùm thay đổi)
let _rtPullTimer = null;
function debouncedRealtimePull() {
  clearTimeout(_rtPullTimer);
  _rtPullTimer = setTimeout(() => {
    if (!sbReady) return;
    if (!pulling) pullAll(false);
    else debouncedRealtimePull();   // đang pull -> hoãn thêm, KHÔNG bỏ qua (kẻo mất update của máy kia)
  }, 800);
}

// ===== REALTIME: subscribe + TỰ NỐI LẠI khi channel chết =====
// Trước đây chỉ subscribe 1 lần trong catch; channel chết (timeout/lỗi) là mất realtime âm thầm,
// chỉ còn poll 30s. Giờ theo dõi status + re-subscribe backoff (2s -> cap 30s).
let _realtimeAlive = false;
let _rtRetryTimer = null;
let _rtBackoff = 2000;
let _rtGen = 0;   // generation: vô hiệu callback của channel cũ (chống re-subscribe loop khi removeChannel bắn CLOSED)

async function subscribeRealtime() {
  if (!sb || !sbReady) return;
  clearTimeout(_rtRetryTimer);
  const myGen = ++_rtGen;
  // Đóng channel cũ nếu còn (connect lại sau login/logout) -> tránh xử lý event N lần + leak
  if (_realtimeChannel) { try { await sb.removeChannel(_realtimeChannel); } catch (e) {} _realtimeChannel = null; }

  _realtimeChannel = sb.channel('crm-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
      if (pulling) return;
      const evt = payload.eventType;
      const data = payload.new || payload.old;
      const code = data?.order_code || '';
      debouncedRealtimePull();
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
      debouncedRealtimePull();
      const evt = payload.eventType;
      const data = payload.new || payload.old;
      const name = data?.name || '';
      if (evt === 'UPDATE') {
        showToast('👤 Thông tin khách ' + name + ' vừa được cập nhật', 'info');
      }
    })
    .subscribe((status) => {
      if (myGen !== _rtGen) return; // callback từ channel cũ (đã bị thay) -> bỏ qua
      if (status === 'SUBSCRIBED') {
        _realtimeAlive = true;
        _rtBackoff = 2000; // nối lại thành công -> reset backoff
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        _realtimeAlive = false;
        // Chỉ tự nối lại khi vẫn đang đăng nhập & online (tránh spin lúc logout/offline)
        if (sbReady && navigator.onLine) {
          clearTimeout(_rtRetryTimer);
          _rtRetryTimer = setTimeout(subscribeRealtime, _rtBackoff);
          _rtBackoff = Math.min(_rtBackoff * 2, 30000);
        }
      }
    });

  // Xin quyền notification (chỉ hỏi 1 lần)
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ===== CHUYỂN ĐỔI RECORD LOCAL -> CLOUD =====
async function toCloud(tableName, rec) {
  if (tableName === 'customers') {
    return {
      uuid: rec.uuid, name: rec.name || '', phone: rec.phone || '', email: rec.email || '', zalo: rec.zalo || '',
      social: rec.social || '', source: rec.source || '', note: rec.note || '',
      created_at: rec.created_at || new Date().toISOString(),
      updated_at: rec.updated_at || rec.created_at || new Date(0).toISOString(), deleted: !!rec.deleted_at
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
      unit_price: rec.unit_price || 0, cost_price: rec.cost_price || 0, total: rec.total || 0, deposit_amount: rec.deposit_amount || 0,
      status: rec.status, delivery_method: rec.delivery_method || '', ctv: rec.ctv || '',
      seat_number: rec.seat_number || '',
      ticket_source: rec.ticket_source || '',
      combo_info: rec.combo_info || '',
      payment_proof: rec.payment_proof || '',
      note: rec.note || '', created_at: rec.created_at || new Date().toISOString(),
      updated_at: rec.updated_at || rec.created_at || new Date(0).toISOString(), deleted: !!rec.deleted_at
    };
  }
  if (tableName === 'inventory') {
    return {
      uuid: rec.uuid, show_day: rec.show_day, ticket_tier: rec.ticket_tier,
      total_stock: rec.total_stock || 0, cost_price: rec.cost_price || 0,
      updated_at: rec.updated_at || rec.created_at || new Date(0).toISOString(), deleted: !!rec.deleted_at
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
      updated_at: rec.updated_at || rec.created_at || new Date(0).toISOString(), deleted: !!rec.deleted_at
    };
  }
  return rec;
}

// ===== ĐẨY OUTBOX LÊN CLOUD =====
async function processOutbox() {
  if (!sbReady || !navigator.onLine) { updateSyncStatus(); return; }
  // Bỏ qua item "parked" (đã lỗi quá nhiều) ở vòng tự động — chỉ thử lại khi reconcile/bấm tay.
  const items = await db.outbox.orderBy('id').filter(i => !i.parked).limit(OUTBOX_BATCH).toArray();
  if (items.length === 0) { updateSyncStatus(); return; }

  let progressed = 0; // số item đã rời hàng đợi (thành công hoặc bị loại) — để chặn đệ quy vô hạn
  let hadError = false;
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
        if (!cloudRec.uuid) { await db.outbox.delete(item.id); progressed++; continue; }
        const { error } = await sb.from(item.table_name).upsert(cloudRec);
        if (error) throw error;
      }
      await db.outbox.delete(item.id);
      progressed++;
    } catch (e) {
      const retries = (item.retries || 0) + 1; // đếm bền trong record -> KHÔNG reset khi F5
      const msg = (e && e.message) ? e.message : String(e);
      console.error('push fail', item.table_name, msg, `(lần ${retries}/${MAX_OUTBOX_RETRIES})`);
      if (retries >= MAX_OUTBOX_RETRIES) {
        // KHÔNG xóa (chống mất dữ liệu) — "park" lại để khỏi thử liên tục; reconcile/bấm tay sẽ thử lại.
        console.error('Outbox item parked sau nhiều lần lỗi:', item, msg);
        await db.outbox.update(item.id, { retries, last_error: msg, parked: 1 });
        if (typeof showToast === 'function') showToast('1 bản ghi chưa đồng bộ được — bấm "Đồng bộ lại toàn bộ" để thử tiếp', 'warning');
      } else {
        await db.outbox.update(item.id, { retries, last_error: msg });
      }
      hadError = true;
      // KHÔNG return: item lỗi không được chặn các item phía sau (chống head-of-line blocking)
    }
  }
  updateSyncStatus(hadError ? 'error' : undefined);
  // Còn item chưa parked & vừa có tiến triển & batch đầy => xử lý tiếp. Nếu cả batch đều kẹt thì dừng,
  // chờ interval/reconcile thử lại (tránh đệ quy vô hạn với item lỗi).
  const remaining = await db.outbox.filter(i => !i.parked).count();
  if (remaining > 0 && progressed > 0 && items.length === OUTBOX_BATCH) processOutbox();
}

// ===== RECONCILE: lưới an toàn — đảm bảo MỌI record local đều lên cloud =====
// So local vs cloud theo uuid+updated_at; đẩy lên cloud những gì local thiếu/mới hơn.
// Chống mọi kiểu "kẹt": hook lỡ enqueue (pulling race), outbox bị mất, record tạo trước khi bật sync.
// Chống TRÙNG order_code: CHỈ phát hiện + cảnh báo, TUYỆT ĐỐI KHÔNG tự đổi mã.
// Vì sao không tự đổi:
//   1) order_code in trên bill + dùng để khách tra cứu (tracuu.html). Tự đổi = khách nhập mã cũ không ra đơn.
//   2) Đổi mã theo counter LOCAL, chạy song song trên nhiều máy, KHÔNG hội tụ: mã mới máy này đẻ trùng ở máy kia
//      -> đổi tiếp -> số đơn nhảy vô tận (BB-0004→0009→0010...) + realtime bão hoà -> lag giật.
//   uuid mới là khóa thật; trùng mã chỉ là phiền hiển thị -> để chủ shop tự sửa tay 1 đơn.
let _dupWarnedKey = '';
async function dedupeOrderCodes() {
  const all = (await db.orders.toArray()).filter(o => !o.deleted_at && o.order_code);
  const byCode = {};
  for (const o of all) { (byCode[o.order_code] = byCode[o.order_code] || []).push(o); }
  const dups = Object.keys(byCode).filter(c => byCode[c].length > 1).sort();
  const key = dups.join(',');
  if (dups.length && key !== _dupWarnedKey) {   // cảnh báo 1 lần cho mỗi tập mã trùng (không spam mỗi 3 phút)
    _dupWarnedKey = key;
    console.warn('Mã đơn trùng (không tự đổi):', dups);
    if (typeof showToast === 'function') showToast(`⚠️ Mã đơn trùng: ${dups.join(', ')}. Vào sửa tay 1 đơn — hệ thống KHÔNG tự đổi để khỏi hỏng mã tra cứu của khách.`, 'warning');
  }
}

let reconciling = false;
async function reconcile(forceAll = false) {
  if (!sbReady || !navigator.onLine || reconciling || pulling) return; // không chồng lên pullAll đang ghi DB
  reconciling = true;
  try {
    // CHỈ mở lại item "park" khi user CHỦ ĐỘNG bấm "Đồng bộ lại toàn bộ" (forceAll).
    // Tránh: reconcile định kỳ 3 phút un-park liên tục -> item lỗi vĩnh viễn bị thử lại bão hòa.
    if (forceAll) await db.outbox.toCollection().modify(i => { if (i.parked) { i.parked = 0; i.retries = 0; } });
    await dedupeOrderCodes(); // xử lý trùng mã trước khi đẩy lên

    for (const t of SYNC_TABLES) {
      let cloudRows = [];
      try {
        const { data, error } = await sb.from(t).select('uuid,updated_at,deleted');
        if (error) throw error;
        cloudRows = data || [];
      } catch (e) { console.warn('reconcile fetch', t, e.message); continue; }
      const cloudMap = new Map(cloudRows.map(r => [r.uuid, r]));
      const locals = await db[t].toArray();
      for (const loc of locals) {
        if (!loc.uuid) {                       // backfill uuid cho record cũ
          loc.uuid = genUUID();
          pulling++;
          try { await db[t].update(loc.id, { uuid: loc.uuid }); } finally { pulling--; }
        }
        const cloud = cloudMap.get(loc.uuid);
        const locDeleted = !!loc.deleted_at;
        const cloudDeleted = cloud ? !!cloud.deleted : false;
        const localTime = new Date(loc.updated_at || 0).getTime();
        const cloudTime = cloud ? new Date(cloud.updated_at || 0).getTime() : -1;
        if (locDeleted) {
          if (!cloud || !cloudDeleted) await enqueue(t, 'delete', { uuid: loc.uuid });
        } else if (forceAll || !cloud || localTime > cloudTime) {
          await enqueue(t, 'upsert', loc);     // local thiếu trên cloud hoặc mới hơn -> đẩy lên
        }
      }
    }
    await processOutbox();
  } catch (e) {
    console.error('reconcile', e);
  } finally {
    reconciling = false;
  }
}
window.reconcileSync = reconcile; // cho nút "Đồng bộ lại toàn bộ" trong app.js gọi

// Lưu snapshot bản local CŨ trước khi bị bản cloud mới hơn ghi đè -> có thể khôi phục (chống mất dữ liệu)
async function snapshotHistory(table, oldRec, source) {
  try {
    if (!oldRec || !db.history) return;
    await db.history.add({
      table_name: table, uuid: oldRec.uuid || '', order_code: oldRec.order_code || oldRec.name || '',
      snapshot: JSON.stringify(oldRec), replaced_at: new Date().toISOString(), source: source || 'pull'
    });
  } catch (e) { /* history là phụ trợ, không bao giờ chặn sync */ }
}

// ===== KÉO DỮ LIỆU CLOUD VỀ & MERGE =====
async function pullAll(showResult) {
  if (!sbReady) return;
  pulling++;
  try {
    const nowIso = new Date().toISOString();
    // 1. Customers trước (orders cần map customer_uuid -> id local)
    const { data: cloudCustomers, error: e1 } = await sb.from('customers').select('*');
    if (e1) throw e1;
    const uuidToLocalId = {};
    for (const cc of (cloudCustomers || [])) {
      const local = await db.customers.where('uuid').equals(cc.uuid).first();
      if (cc.deleted) {  // SOFT-delete local (vào Thùng rác, khôi phục được) thay vì xóa cứng
        if (local) { uuidToLocalId[cc.uuid] = local.id; if (!local.deleted_at) await db.customers.update(local.id, { deleted_at: cc.updated_at || nowIso, updated_at: cc.updated_at || nowIso }); }
        continue;
      }
      if (!local) {
        const id = await db.customers.add({
          uuid: cc.uuid, name: cc.name, phone: cc.phone, email: cc.email || '', zalo: cc.zalo, social: cc.social,
          source: cc.source, note: cc.note, created_at: cc.created_at, updated_at: cc.updated_at
        });
        uuidToLocalId[cc.uuid] = id;
      } else {
        if (new Date(cc.updated_at) > new Date(local.updated_at || 0)) {
          await snapshotHistory('customers', local, 'pull');
          await db.customers.update(local.id, { name: cc.name, phone: cc.phone, email: cc.email || '', zalo: cc.zalo, social: cc.social, source: cc.source, note: cc.note, updated_at: cc.updated_at });
        }
        uuidToLocalId[cc.uuid] = local.id;
      }
    }

    // 2. Orders
    const { data: cloudOrders, error: e2 } = await sb.from('orders').select('*');
    if (e2) throw e2;
    const orderUuidToLocalId = {};
    for (const co of (cloudOrders || [])) {
      const local = await db.orders.where('uuid').equals(co.uuid).first();
      if (co.deleted) {
        if (local) { orderUuidToLocalId[co.uuid] = local.id; if (!local.deleted_at) await db.orders.update(local.id, { deleted_at: co.updated_at || nowIso, updated_at: co.updated_at || nowIso }); }
        continue;
      }
      const fields = {
        order_code: co.order_code, customer_id: uuidToLocalId[co.customer_uuid] || (local ? local.customer_id : null),
        show_day: co.show_day, ticket_tier: co.ticket_tier, quantity: co.quantity,
        unit_price: co.unit_price, cost_price: co.cost_price || 0, total: co.total, deposit_amount: co.deposit_amount,
        status: co.status, delivery_method: co.delivery_method, ctv: co.ctv, seat_number: co.seat_number || '', ticket_source: co.ticket_source || '', combo_info: co.combo_info || '', payment_proof: co.payment_proof || '', note: co.note,
        created_at: co.created_at, updated_at: co.updated_at
      };
      if (!local) { const id = await db.orders.add({ uuid: co.uuid, ...fields }); orderUuidToLocalId[co.uuid] = id; }
      else {
        orderUuidToLocalId[co.uuid] = local.id;
        if (new Date(co.updated_at) > new Date(local.updated_at || 0)) { await snapshotHistory('orders', local, 'pull'); await db.orders.update(local.id, fields); }
      }
    }

    // 3. Inventory (so timestamp như orders/customers để không đè mất chỉnh sửa tồn kho local)
    const { data: cloudInv, error: e3 } = await sb.from('inventory').select('*');
    if (e3) throw e3;
    for (const ci of (cloudInv || [])) {
      const local = await db.inventory.where('uuid').equals(ci.uuid).first();
      if (ci.deleted) { if (local && !local.deleted_at) await db.inventory.update(local.id, { deleted_at: ci.updated_at || nowIso, updated_at: ci.updated_at || nowIso }); continue; }
      const invFields = { show_day: ci.show_day, ticket_tier: ci.ticket_tier, total_stock: ci.total_stock, cost_price: ci.cost_price, updated_at: ci.updated_at };
      if (!local) await db.inventory.add({ uuid: ci.uuid, ...invFields });
      else if (new Date(ci.updated_at || 0) > new Date(local.updated_at || 0)) await db.inventory.update(local.id, invFields);
    }

    // 4. Resales (remap order_uuid -> order_id local; soft-delete; history)
    const { data: cloudRes, error: e4 } = await sb.from('resales').select('*');
    if (e4) throw e4;
    for (const cr of (cloudRes || [])) {
      const local = await db.resales.where('uuid').equals(cr.uuid).first();
      if (cr.deleted) { if (local && !local.deleted_at) await db.resales.update(local.id, { deleted_at: cr.updated_at || nowIso, updated_at: cr.updated_at || nowIso }); continue; }
      const fields = {
        order_id: orderUuidToLocalId[cr.order_uuid] || (local ? local.order_id : null),
        order_code: cr.order_code, customer_name: cr.customer_name, customer_phone: cr.customer_phone,
        show_day: cr.show_day, ticket_tier: cr.ticket_tier, quantity: cr.quantity,
        original_price: cr.original_price, asking_price: cr.asking_price, service_fee: cr.service_fee,
        reason: cr.reason, seat_number: cr.seat_number || '', note: cr.note, status: cr.status, created_at: cr.created_at, updated_at: cr.updated_at
      };
      if (!local) await db.resales.add({ uuid: cr.uuid, ...fields });
      else if (new Date(cr.updated_at) > new Date(local.updated_at || 0)) { await snapshotHistory('resales', local, 'pull'); await db.resales.update(local.id, fields); }
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
    pulling--;
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
        pulling++; // tránh hook enqueue 2 lần
        try { await db[tableName].update(r.id, { uuid: r.uuid }); } finally { pulling--; }
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
  // Đã kết nối rồi: chỉ auto-migrate plaintext → encrypted nếu session key có sẵn, rồi return.
  if (sbReady) {
    if (_sessionKey) {
      const _old = (await db.settings.get('supabasePassword'))?.value;
      if (_old) {
        try { await db.settings.put({ key: 'supabasePasswordEnc', value: await _encryptPwd(_old) }); await db.settings.delete('supabasePassword'); } catch (e) {}
      }
    }
    return true;
  }

  let url = (await db.settings.get('supabaseUrl'))?.value;
  let key = (await db.settings.get('supabaseKey'))?.value;
  const email = (await db.settings.get('supabaseEmail'))?.value;

  // Đọc password: ưu tiên bản encrypted, fallback plaintext cũ (migration path)
  let password = null;
  const _encEntry = (await db.settings.get('supabasePasswordEnc'))?.value;
  if (_encEntry && _sessionKey) {
    try { password = await _decryptPwd(_encEntry); } catch (e) {}
  }
  if (!password) password = (await db.settings.get('supabasePassword'))?.value;

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

    // Auto-migrate: nếu vẫn còn plaintext → encrypt ngay và xóa
    if (_sessionKey) {
      const _oldPwd = (await db.settings.get('supabasePassword'))?.value;
      if (_oldPwd) {
        try { await db.settings.put({ key: 'supabasePasswordEnc', value: await _encryptPwd(_oldPwd) }); await db.settings.delete('supabasePassword'); } catch (e) {}
      }
    }

    // === REALTIME: nhận thông báo tức thời + tự nối lại khi channel chết ===
    try {
      await subscribeRealtime();
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
  if (typeof supabase === 'undefined') {
    showToast('Chưa tải được thư viện Supabase (kiểm tra mạng)', 'error');
    return;
  }

  showToast('Đang kết nối...', 'info');
  // VALIDATE TRƯỚC khi lưu: đăng nhập thử; sai -> KHÔNG ghi creds vào DB.
  // (Trước đây lưu ngay -> nhập sai vẫn kẹt trong DB, mỗi lần mở app tự đăng nhập sai + lỗi im lặng.)
  try {
    const testClient = supabase.createClient(url, key);
    const { error } = await testClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (e) {
    showToast('Đăng nhập Supabase thất bại: ' + (e.message || e) + ' — chưa lưu', 'error');
    return;
  }

  // Xác thực OK -> giờ mới lưu creds
  await db.settings.put({ key: 'supabaseUrl', value: url });
  await db.settings.put({ key: 'supabaseKey', value: key });
  await db.settings.put({ key: 'supabaseEmail', value: email });
  if (_sessionKey) {
    await db.settings.put({ key: 'supabasePasswordEnc', value: await _encryptPwd(password) });
    await db.settings.delete('supabasePassword');
  } else {
    await db.settings.put({ key: 'supabasePassword', value: password });
  }

  const ok = await connectSupabase(false);
  if (!ok) return;

  // Backfill UUID cho tất cả record local thiếu uuid (quan trọng: đảm bảo mọi record đều sync được)
  let needsUpload = false;
  for (const tableName of SYNC_TABLES) {
    const rows = await db[tableName].toArray();
    for (const r of rows) {
      if (!r.uuid) {
        r.uuid = genUUID();
        pulling++;
        try { await db[tableName].update(r.id, { uuid: r.uuid }); } finally { pulling--; }
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

// Đẩy LẠI toàn bộ dữ liệu máy này lên cloud (khôi phục đơn kẹt như BB-0004). force=true => enqueue mọi record.
async function forceSyncAll() {
  if (!sbReady) {
    const ok = await connectSupabase(false);
    if (!ok) { showToast('Chưa cấu hình Supabase — xem mục Đồng bộ cloud trong Cài đặt', 'warning'); return; }
  }
  showToast('Đang đẩy lại toàn bộ dữ liệu lên cloud...', 'info');
  await pullAll(false);       // kéo cloud về trước để biết cái gì đã có
  await reconcile(true);      // force: enqueue mọi record local còn thiếu/khác
  const left = await db.outbox.filter(i => !i.parked).count();
  const parked = await db.outbox.filter(i => i.parked).count();
  if (parked > 0) showToast(`${parked} bản ghi vẫn lỗi đồng bộ — kiểm tra mạng rồi bấm lại`, 'warning');
  else showToast(left > 0 ? `Còn ${left} thay đổi đang đẩy lên...` : 'Đã đồng bộ toàn bộ lên cloud! ✅', left > 0 ? 'info' : 'success');
}
window.forceSyncAll = forceSyncAll;

async function disconnectSupabase() {
  showConfirm('Ngắt kết nối cloud? Dữ liệu trên cloud vẫn còn, app quay về chế độ local.', async () => {
    for (const k of ['supabaseUrl', 'supabaseKey', 'supabaseEmail', 'supabasePassword', 'supabasePasswordEnc']) {
      await db.settings.delete(k);
    }
    clearTimeout(_rtRetryTimer); _realtimeAlive = false; _rtGen++;   // dừng + vô hiệu callback channel cũ
    if (_realtimeChannel && sb) { try { await sb.removeChannel(_realtimeChannel); } catch (e) {} }
    _realtimeChannel = null;
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
  const parked = await db.outbox.filter(i => i.parked).count();
  let state, text;
  if (parked > 0) { state = 'error'; text = `${parked} bản ghi chưa đồng bộ được — bấm "Đồng bộ lại toàn bộ" trong Cài đặt`; }
  else if (forced === 'error') { state = 'error'; text = 'Lỗi đồng bộ — sẽ tự thử lại'; }
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

  // Bucket payment_proofs giờ là PRIVATE -> KHÔNG dùng getPublicUrl nữa.
  // Lưu PATH (fileName) thay vì full URL; lúc xem mới sinh signed URL tạm.
  return fileName;
};

// Sinh signed URL tạm (1h) để xem ảnh chuyển khoản từ bucket private.
// Nuốt cả 2 dạng giá trị payment_proof: path MỚI ("BB-0001_123.jpg") lẫn full-URL CŨ (data legacy).
window.getSignedProofUrl = async function(stored) {
  if (!stored || !sb) return null;
  const path = stored.includes('/payment_proofs/')
    ? stored.split('/payment_proofs/')[1].split('?')[0]
    : stored;
  try {
    const { data, error } = await sb.storage.from('payment_proofs').createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
  } catch (e) { return null; }
};

window.addEventListener('online', async () => {
  updateSyncStatus();
  // Mạng vừa có lại -> mở khoá item từng "park" (có thể chỉ lỗi do mất mạng) để thử lại
  try { await db.outbox.toCollection().modify(i => { if (i.parked) { i.parked = 0; i.retries = 0; } }); } catch (e) {}
  await pullAll(false); await reconcile();   // tuần tự: pull xong (pulling về 0) rồi mới reconcile
});
window.addEventListener('offline', updateSyncStatus);
// Khi quay lại app (mở tab/khoá màn hình điện thoại) -> pull rồi reconcile để đẩy nốt thứ còn kẹt
document.addEventListener('visibilitychange', async () => { if (!document.hidden && sbReady) { await pullAll(false); await reconcile(); } });
setInterval(async () => { if (sbReady) { await processOutbox(); await pullAll(false); } }, 30000);
// Reconcile định kỳ (3 phút): lưới an toàn đảm bảo không record nào kẹt lại local
setInterval(() => { if (sbReady) reconcile(); }, 180000);

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
      // Kéo cloud về trước, rồi reconcile để đẩy MỌI record local còn thiếu/mới hơn lên cloud.
      // reconcile() tự backfill uuid + đảm bảo không record nào kẹt lại (thay cho backfill thủ công cũ).
      await pullAll(false);
      await reconcile();
    } else if (email) {
      // Đã có creds lưu nhưng kết nối load (silent) thất bại -> báo rõ, đừng để user tưởng đang sync.
      showToast('Chưa kết nối được cloud — đang chạy chế độ offline (dữ liệu vẫn lưu, sẽ tự đẩy khi có mạng)', 'warning');
    }
  }, 300);

  // Service Worker đã vô hiệu hóa theo quyết định HANDOFF.md (cache cứng đầu)
  // index.html đã unregister toàn bộ SW on load — không đăng ký lại ở đây
});
