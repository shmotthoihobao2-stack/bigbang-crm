/* ===================================================================
   BIGBANG CRM — app.js
   Mini-CRM quản lý bán vé Concert BigBang 2026
   =================================================================== */

// ===== DATABASE SETUP (Dexie.js / IndexedDB) =====
const db = new Dexie('BigBangCRM');
db.version(1).stores({
  customers: '++id, name, phone, zalo, social, source, note, created_at',
  orders: '++id, order_code, customer_id, show_day, ticket_tier, quantity, unit_price, total, deposit_amount, status, payment_proof, delivery_method, ctv, note, created_at, updated_at',
  inventory: '++id, show_day, ticket_tier, total_stock, cost_price',
  settings: 'key'
});
// v2: thêm bảng ký gửi pass vé (dữ liệu cũ giữ nguyên, Dexie tự migrate)
db.version(2).stores({
  customers: '++id, name, phone, zalo, social, source, note, created_at',
  orders: '++id, order_code, customer_id, show_day, ticket_tier, quantity, unit_price, total, deposit_amount, status, payment_proof, delivery_method, ctv, note, created_at, updated_at',
  inventory: '++id, show_day, ticket_tier, total_stock, cost_price',
  settings: 'key',
  resales: '++id, order_id, customer_name, status, created_at'
});
// v3 + v4: được định nghĩa trong sync.js (uuid, outbox, email)
// KHÔNG định nghĩa lại ở đây để tránh conflict Dexie schema

// ===== STATE =====
let currentTab = 'dashboard';
let currentStatusFilter = 'all';
let ordersPage = 0;         // trang hiện tại trong danh sách đơn hàng
const PAGE_SIZE = 50;       // số đơn mỗi trang
let confirmCallback = null;
let chartsInitialized = false;
let chartOrdersByDate = null;
let chartSource = null;
let chartTier = null;

// ===== DEFAULT SETTINGS =====
const DEFAULT_TIERS = ['VIP Soundcheck', 'VIP', 'CAT1', 'CAT2', 'CAT3'];
const DEFAULT_PASSWORD = 'bigbang2026';
const STATUSES = ['mới', 'đã cọc', 'đã thanh toán đủ', 'đã giao vé', 'hoàn cọc', 'hủy'];
const RESALE_STATUSES = ['chờ rao', 'đang rao', 'đã pass', 'hủy ký gửi'];
const RESALE_REASONS = ['không đi được', 'đổi hạng vé', 'khác'];
const ACTIVE_STATUSES = ['đã cọc', 'đã thanh toán đủ', 'đã giao vé']; // count toward "sold"

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // Init settings if first time
  const pwd = await db.settings.get('password');
  if (!pwd) {
    await db.settings.put({ key: 'password', value: await sha256(DEFAULT_PASSWORD) });
  } else if (pwd.value.length !== 64) {
    // Migration: mật khẩu plaintext cũ → tự hash lại 1 lần, user không cần làm gì
    await db.settings.put({ key: 'password', value: await sha256(pwd.value) });
  }
  const tiers = await db.settings.get('ticketTiers');
  if (!tiers) {
    await db.settings.put({ key: 'ticketTiers', value: JSON.stringify(DEFAULT_TIERS) });
  }
  const shopName = await db.settings.get('shopName');
  if (!shopName) {
    await db.settings.put({ key: 'shopName', value: 'BigBang Ticket VN' });
  }
  const ctvs = await db.settings.get('ctvList');
  if (!ctvs) {
    await db.settings.put({ key: 'ctvList', value: JSON.stringify([]) });
  }

  // Ẩn gợi ý mật khẩu mặc định nếu user đã đổi mật khẩu
  const curPwd = await db.settings.get('password');
  if (curPwd && curPwd.value !== await sha256(DEFAULT_PASSWORD)) {
    const hint = document.getElementById('default-pwd-hint');
    if (hint) hint.style.display = 'none';
  }

  // Check login
  const isLoggedIn = sessionStorage.getItem('bb_logged_in');
  if (isLoggedIn === 'true') {
    showApp();
  }

  // Enter key on login
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
});

// ===== AUTH =====
async function handleLogin() {
  const input = document.getElementById('login-password').value;
  const stored = await db.settings.get('password');
  const pwd = stored ? stored.value : await sha256(DEFAULT_PASSWORD);

  if (await sha256(input) === pwd) {
    sessionStorage.setItem('bb_logged_in', 'true');
    showApp();
  } else {
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = 'Sai mật khẩu!';
    document.getElementById('login-password').value = '';
    setTimeout(() => errorEl.textContent = '', 3000);
  }
}

function handleLogout() {
  sessionStorage.removeItem('bb_logged_in');
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-password').value = '';
}

async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  await loadSettings();
  await refreshAll();
}

// ===== PASSWORD =====
async function changePassword() {
  const newPwd = document.getElementById('new-password').value.trim();
  if (newPwd.length < 4) {
    showToast('Mật khẩu phải ít nhất 4 ký tự', 'error');
    return;
  }
  await db.settings.put({ key: 'password', value: await sha256(newPwd) });
  document.getElementById('new-password').value = '';
  showToast('Đã đổi mật khẩu thành công!', 'success');
}

// ===== SETTINGS =====
async function loadSettings() {
  // Load shop info
  const shopName = await db.settings.get('shopName');
  if (shopName) document.getElementById('setting-shop-name').value = shopName.value;
  const shopPhone = await db.settings.get('shopPhone');
  if (shopPhone) document.getElementById('setting-shop-phone').value = shopPhone.value;
  const shopZalo = await db.settings.get('shopZalo');
  if (shopZalo) document.getElementById('setting-shop-zalo').value = shopZalo.value;

  // Load tiers
  await renderTiers();
  // Load CTVs
  await renderCTVs();
}

async function saveSetting(key, value) {
  await db.settings.put({ key, value });
  showToast('Đã lưu!', 'success');
}

// ===== TIERS =====
async function getTiers() {
  const stored = await db.settings.get('ticketTiers');
  return stored ? JSON.parse(stored.value) : DEFAULT_TIERS;
}

async function renderTiers() {
  const tiers = await getTiers();
  const container = document.getElementById('tier-list');
  container.innerHTML = tiers.map(t => `
    <span class="tier-tag">
      ${esc(t)}
      <span class="remove-tier" data-name="${esc(t)}" onclick="removeTier(this.dataset.name)" title="Xóa">✕</span>
    </span>
  `).join('');

  // Update filter dropdown
  const filterTier = document.getElementById('filter-tier');
  const currentFilter = filterTier.value;
  filterTier.innerHTML = '<option value="">Tất cả hạng</option>' +
    tiers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  filterTier.value = currentFilter;

  // Update order form dropdown
  populateTierSelect('order-tier');
}

async function populateTierSelect(selectId) {
  const tiers = await getTiers();
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = '<option value="">-- Chọn hạng --</option>' +
    tiers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (current && tiers.includes(current)) select.value = current;
}

async function addTier() {
  const input = document.getElementById('new-tier-name');
  const name = input.value.trim();
  if (!name) return;

  const tiers = await getTiers();
  if (tiers.includes(name)) {
    showToast('Hạng vé đã tồn tại!', 'warning');
    return;
  }
  tiers.push(name);
  await db.settings.put({ key: 'ticketTiers', value: JSON.stringify(tiers) });
  input.value = '';
  await renderTiers();
  showToast(`Đã thêm hạng "${name}"`, 'success');
}

async function removeTier(name) {
  const tiers = await getTiers();
  const updated = tiers.filter(t => t !== name);
  await db.settings.put({ key: 'ticketTiers', value: JSON.stringify(updated) });
  // Dọn record tồn kho mồ côi của hạng đã xóa
  const orphans = await db.inventory.where('ticket_tier').equals(name).toArray();
  for (const o of orphans) await db.inventory.delete(o.id);
  await renderTiers();
  showToast(`Đã xóa hạng "${name}"`, 'info');
}

// ===== CTV =====
async function getCTVs() {
  const stored = await db.settings.get('ctvList');
  return stored ? JSON.parse(stored.value) : [];
}

async function renderCTVs() {
  const ctvs = await getCTVs();
  const container = document.getElementById('ctv-list');
  const orders = await db.orders.toArray();

  if (ctvs.length === 0) {
    container.innerHTML = '<p class="text-muted" style="font-size:0.85rem">Chưa có CTV nào</p>';
  } else {
    container.innerHTML = ctvs.map(name => {
      const ctvOrders = orders.filter(o => o.ctv === name && o.status !== 'hủy');
      const ctvRevenue = ctvOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      return `
        <div class="ctv-card">
          <div class="ctv-avatar">${esc(name.charAt(0).toUpperCase())}</div>
          <div class="ctv-info">
            <div class="ctv-name">${esc(name)}</div>
            <div class="ctv-stats">${ctvOrders.length} đơn — ${formatVND(ctvRevenue)}</div>
          </div>
          <button class="btn btn-sm btn-danger" data-name="${esc(name)}" onclick="removeCTV(this.dataset.name)">Xóa</button>
        </div>
      `;
    }).join('');
  }

  // Update CTV dropdown in order form
  populateCTVSelect();
}

function populateCTVSelect() {
  getCTVs().then(ctvs => {
    const select = document.getElementById('order-ctv');
    const current = select.value;
    select.innerHTML = '<option value="">-- Không --</option>' +
      ctvs.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (current) select.value = current;
  });
}

async function addCTV() {
  const input = document.getElementById('new-ctv-name');
  const name = input.value.trim();
  if (!name) return;

  const ctvs = await getCTVs();
  if (ctvs.includes(name)) {
    showToast('CTV đã tồn tại!', 'warning');
    return;
  }
  ctvs.push(name);
  await db.settings.put({ key: 'ctvList', value: JSON.stringify(ctvs) });
  input.value = '';
  await renderCTVs();
  showToast(`Đã thêm CTV "${name}"`, 'success');
}

async function removeCTV(name) {
  const ctvs = await getCTVs();
  const updated = ctvs.filter(c => c !== name);
  await db.settings.put({ key: 'ctvList', value: JSON.stringify(updated) });
  await renderCTVs();
  showToast(`Đã xóa CTV "${name}"`, 'info');
}

// ===== TAB SWITCHING =====
function switchTab(tab) {
  currentTab = tab;
  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tab);
  });
  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });
  // Show/hide FAB
  const fab = document.getElementById('fab-add');
  fab.style.display = (tab === 'orders' || tab === 'dashboard') ? 'flex' : 'none';

  // Refresh data on tab switch
  if (tab === 'dashboard') refreshDashboard();
  if (tab === 'orders') refreshOrders();
  if (tab === 'inventory') refreshInventory();
  if (tab === 'followup') refreshFollowup();
  if (tab === 'resale') refreshResales();
  if (tab === 'settings') renderCTVs();
}

// ===== REFRESH ALL =====
async function refreshAll() {
  await refreshDashboard();
  await refreshOrders();
  await refreshInventory();
  await refreshFollowup();
  await refreshResales();
}

// ===== SECURITY: escape HTML chống vỡ giao diện / injection =====
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Chỉ cho phép http/https/tel/mailto làm href — chặn javascript: scheme
function safeUrl(url) {
  if (!url) return '#';
  return /^(https?:\/\/|tel:|mailto:)/i.test(String(url).trim()) ? String(url).trim() : '#';
}

// SHA-256 hash dùng Web Crypto API (không cần thư viện)
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Format ô nhập tiền trực tiếp khi gõ (3500000 -> 3.500.000)
function formatMoneyInput(el) {
  const v = parseVND(el.value);
  el.value = v ? new Intl.NumberFormat('vi-VN').format(v) : '';
  calcTotal();
}

// Nút gọi / Zalo nhanh trên card đơn
function quickContactHTML(phone) {
  if (!phone) return '';
  const p = esc(phone);
  return `<span class="quick-actions" onclick="event.stopPropagation()"><a class="btn-mini" href="tel:${p}" title="Gọi">📞</a><a class="btn-mini" href="https://zalo.me/${p}" target="_blank" rel="noopener" title="Nhắn Zalo">💬</a></span>`;
}

// ===== FORMAT HELPERS =====
function formatVND(amount) {
  if (!amount || isNaN(amount)) return '0đ';
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

// Rút gọn tiền cho stat card: 1250000000 -> "1,25 tỷ", 35200000 -> "35,2tr"
function formatVNDShort(amount) {
  if (!amount || isNaN(amount)) return '0đ';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2).replace('.', ',').replace(/,?0+$/, '') + ' tỷ';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1).replace('.', ',').replace(/,0$/, '') + 'tr';
  return formatVND(amount);
}

function parseVND(str) {
  if (!str) return 0;
  return parseInt(str.toString().replace(/[^\d]/g, '')) || 0;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function showDayLabel(day) {
  if (day === 'day1') return 'Day 1 (24/10)';
  if (day === 'day2') return 'Day 2 (25/10)';
  if (day === 'both') return 'Cả 2 ngày';
  return day;
}

function maskName(name) {
  if (!name || name.length <= 2) return name;
  const parts = name.split(' ');
  if (parts.length === 1) {
    return name[0] + '*'.repeat(name.length - 1);
  }
  return parts.map((p, i) => i === parts.length - 1 ? p : p[0] + '*'.repeat(Math.max(0, p.length - 1))).join(' ');
}

function validatePhone(phone) {
  const cleaned = phone.replace(/[\s\-\.]/g, '');
  return /^0\d{9}$/.test(cleaned);
}

// ===== GENERATE ORDER CODE =====
async function generateOrderCode() {
  // Nếu đang online với cloud: lấy mã lớn nhất TRÊN CLOUD để 2 máy không trùng nhau
  if (typeof sbReady !== 'undefined' && sbReady && navigator.onLine) {
    try {
      const { data } = await sb.from('orders').select('order_code').order('order_code', { ascending: false }).limit(1);
      if (data && data.length) {
        const cloudMax = parseInt((data[0].order_code || '').replace('BB-', '')) || 0;
        const stored = await db.settings.get('orderCounter');
        const localMax = stored ? parseInt(stored.value) || 0 : 0;
        const num = Math.max(cloudMax, localMax) + 1;
        await db.settings.put({ key: 'orderCounter', value: String(num) });
        return 'BB-' + String(num).padStart(4, '0');
      }
    } catch (e) { /* offline/lỗi -> rơi xuống counter local */ }
  }
  // Counter riêng (chỉ tăng) => KHÔNG BAO GIỜ trùng mã đơn dù xóa/import
  const stored = await db.settings.get('orderCounter');
  let num;
  if (stored) {
    num = parseInt(stored.value) || 0;
  } else {
    const orders = await db.orders.toArray();
    num = orders.reduce((m, o) => {
      const n = parseInt((o.order_code || '').replace('BB-', '')) || 0;
      return Math.max(m, n);
    }, 0);
  }
  num += 1;
  await db.settings.put({ key: 'orderCounter', value: String(num) });
  return 'BB-' + String(num).padStart(4, '0');
}

// ===== CUSTOMER LOOKUP =====
let lookupTimeout = null;
async function lookupCustomer(phone) {
  clearTimeout(lookupTimeout);
  const badge = document.getElementById('phone-autofill-badge');
  badge.innerHTML = '';

  const cleaned = phone.replace(/[\s\-\.]/g, '');
  if (cleaned.length < 5) return;

  lookupTimeout = setTimeout(async () => {
    const customer = await db.customers.where('phone').equals(cleaned).first();
    if (customer) {
      document.getElementById('order-name').value = customer.name || '';
      document.getElementById('order-zalo').value = customer.zalo || '';
      document.getElementById('order-email').value = customer.email || '';
      document.getElementById('order-social').value = customer.social || '';
      if (customer.source) document.getElementById('order-source').value = customer.source;
      
      // Calculate total orders and revenue for this customer
      const orders = await db.orders.where('customer_id').equals(customer.id).toArray();
      const validOrders = orders.filter(o => !o.deleted_at && o.status !== 'hủy');
      
      if (validOrders.length > 0) {
        const totalAmount = validOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        badge.innerHTML = `<span class="autofill-badge" style="background:var(--accent-gold);color:#000;font-weight:600;padding:2px 8px;border-radius:12px;margin-left:8px;font-size:0.75rem;">🌟 VIP: ${validOrders.length} đơn (${formatVND(totalAmount)})</span>`;
      } else {
        badge.innerHTML = '<span class="autofill-badge">✓ Khách cũ</span>';
      }
    }
  }, 300);
}

// ===== CALC TOTAL =====
function calcTotal() {
  const qty = parseInt(document.getElementById('order-qty').value) || 0;
  const price = parseVND(document.getElementById('order-price').value);
  const total = qty * price;
  document.getElementById('order-total').value = formatVND(total);
}

// ===== CHECK INVENTORY WARNING =====
async function checkInventory() {
  const day = document.getElementById('order-day').value;
  const tier = document.getElementById('order-tier').value;
  const warningEl = document.getElementById('inventory-warning');
  const warningText = document.getElementById('inventory-warning-text');

  if (!day || !tier) {
    warningEl.classList.add('hidden');
    return;
  }

  const days = day === 'both' ? ['day1', 'day2'] : [day];

  // Đang SỬA đơn: trừ chính đơn này ra khỏi số đã bán (tránh cảnh báo sai)
  const editId = parseInt(document.getElementById('edit-order-id').value) || null;
  let editingOrder = null;
  if (editId) editingOrder = await db.orders.get(editId);

  for (const d of days) {
    const inv = await db.inventory.where({ show_day: d, ticket_tier: tier }).first();
    if (inv) {
      let sold = await countSold(d, tier);
      if (editingOrder && editingOrder.ticket_tier === tier && ACTIVE_STATUSES.includes(editingOrder.status)
          && (editingOrder.show_day === d || editingOrder.show_day === 'both')) {
        sold -= (editingOrder.quantity || 0);
      }
      const remaining = inv.total_stock - sold;
      if (remaining <= 0) {
        warningEl.classList.remove('hidden');
        warningText.textContent = `⚠️ ${showDayLabel(d)} — ${tier}: Đã hết vé! (${sold}/${inv.total_stock})`;
        return;
      } else if (remaining <= 3) {
        warningEl.classList.remove('hidden');
        warningText.textContent = `Còn lại ${remaining} vé ${tier} cho ${showDayLabel(d)}`;
        return;
      }
    }
  }
  warningEl.classList.add('hidden');
}

async function countSold(showDay, tier) {
  const orders = await db.orders
    .where('show_day').anyOf([showDay, 'both'])
    .toArray();
  return orders
    .filter(o => o.ticket_tier === tier && ACTIVE_STATUSES.includes(o.status) && !o.deleted_at)
    .reduce((sum, o) => sum + (o.quantity || 0), 0);
}
// Auto-suggest nguồn vé từ các đơn cũ
async function populateTicketSourceList() {
  const orders = await db.orders.toArray();
  const sources = [...new Set(orders.map(o => o.ticket_source).filter(s => s && s.trim()))];
  const dl = document.getElementById('ticket-source-list');
  if (dl) dl.innerHTML = sources.map(s => `<option value="${esc(s)}">`).join('');
}

// Auto-suggest combo từ các đơn cũ
async function populateComboList() {
  const orders = await db.orders.toArray();
  const combos = [...new Set(orders.map(o => o.combo_info).filter(s => s && s.trim()))];
  const dl = document.getElementById('combo-list');
  if (dl) dl.innerHTML = combos.map(s => `<option value="${esc(s)}">`).join('');
}

// ===== ORDER MODAL =====
function openOrderModal(orderId) {
  const modal = document.getElementById('order-modal');
  const title = document.getElementById('order-modal-title');
  const form = document.getElementById('order-form');

  // Reset form
  form.reset();
  document.getElementById('edit-order-id').value = '';
  document.getElementById('order-total').value = '';
  document.getElementById('phone-autofill-badge').innerHTML = '';
  document.getElementById('inventory-warning').classList.add('hidden');

  // Populate dropdowns
  populateTierSelect('order-tier');
  populateCTVSelect();
  populateTicketSourceList();
  populateComboList();

  if (orderId) {
    // Edit mode
    title.textContent = 'Chỉnh sửa đơn';
    loadOrderForEdit(orderId);
  } else {
    title.textContent = 'Thêm đơn mới';
  }

  modal.classList.add('active');
}

async function loadOrderForEdit(orderId) {
  const order = await db.orders.get(orderId);
  if (!order) return;

  const customer = await db.customers.get(order.customer_id);

  document.getElementById('edit-order-id').value = orderId;
  document.getElementById('order-phone').value = customer ? customer.phone : '';
  document.getElementById('order-name').value = customer ? customer.name : '';
  document.getElementById('order-zalo').value = customer ? customer.zalo : '';
  document.getElementById('order-email').value = customer ? (customer.email || '') : '';
  document.getElementById('order-social').value = customer ? customer.social : '';
  document.getElementById('order-source').value = customer ? customer.source : 'zalo';
  document.getElementById('order-day').value = order.show_day;

  // Chờ dropdown render xong rồi mới set value (fix race condition setTimeout)
  await populateTierSelect('order-tier');
  document.getElementById('order-tier').value = order.ticket_tier;

  document.getElementById('order-qty').value = order.quantity;
  document.getElementById('order-price').value = order.unit_price ? new Intl.NumberFormat('vi-VN').format(order.unit_price) : '';
  document.getElementById('order-total').value = formatVND(order.total);
  document.getElementById('order-deposit').value = order.deposit_amount ? new Intl.NumberFormat('vi-VN').format(order.deposit_amount) : '';
  document.getElementById('order-status').value = order.status;
  document.getElementById('order-delivery').value = order.delivery_method || 'giao tận tay';
  document.getElementById('order-note').value = order.note || '';
  document.getElementById('order-ctv').value = order.ctv || '';
  document.getElementById('order-seat').value = order.seat_number || '';
  document.getElementById('order-ticket-source').value = order.ticket_source || '';
  document.getElementById('order-combo').value = order.combo_info || '';
}

function closeOrderModal() {
  document.getElementById('order-modal').classList.remove('active');
}

// ===== UPLOAD PAYMENT PROOF =====
async function handleUploadProof(e, orderId, orderCode) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast('Đang tải ảnh lên...', 'info');
    
    // Gọi hàm từ sync.js
    if (typeof window.uploadPaymentProofToSupabase !== 'function') {
      throw new Error('Tính năng upload chưa sẵn sàng. Vui lòng F5 lại trang.');
    }
    
    const publicUrl = await window.uploadPaymentProofToSupabase(file, orderCode);
    
    // Lưu vào IndexedDB
    await db.orders.update(orderId, { 
      payment_proof: publicUrl,
      updated_at: new Date().toISOString()
    });
    
    showToast('Tải ảnh lên thành công!', 'success');
    
    // Tắt modal hiện tại & load lại
    document.getElementById('detail-modal').classList.remove('active');
    openDetailModal(orderId);
    
  } catch (err) {
    console.error('Upload error:', err);
    showToast('Lỗi tải ảnh: ' + err.message, 'error');
  }
}

// ===== GỬI VÉ QUA EMAIL (EmailJS) =====
async function sendTicketEmail(orderId) {
  const order = await db.orders.get(orderId);
  if (!order) { showToast('Không tìm thấy đơn hàng!', 'error'); return; }

  const customer = await db.customers.get(order.customer_id);
  if (!customer || !customer.email) {
    showToast('Khách hàng chưa có email! Sửa đơn để thêm.', 'error');
    return;
  }

  // Xác nhận trước khi gửi
  showConfirm(`Gửi email xác nhận đơn ${order.order_code} đến:\n📧 ${customer.email}\n\nBạn chắc chắn?`, async () => {
    try {
      const showDayText = order.show_day === 'day1' ? 'Day 1 — 24/10/2026' 
        : (order.show_day === 'day2' ? 'Day 2 — 25/10/2026' : 'Cả 2 ngày — 24 & 25/10/2026');
      
      const shopPhone = (await db.settings.get('shopPhone'))?.value || '';
      const seatInfo = order.seat_number ? `Số ghế: ${order.seat_number}` : '';

      const templateParams = {
        to_email: customer.email,
        customer_name: customer.name,
        order_code: order.order_code,
        show_day: showDayText,
        ticket_tier: order.ticket_tier,
        quantity: order.quantity,
        total: formatVND(order.total),
        deposit: formatVND(order.deposit_amount),
        status: order.status.toUpperCase(),
        seat_info: seatInfo,
        shop_phone: shopPhone
      };

      await emailjs.send('service_c2q6n7f', 'template_thvt726', templateParams);
      showToast(`✅ Đã gửi email đến ${customer.email}!`, 'success');
    } catch (err) {
      console.error('EmailJS error:', err);
      showToast(`Gửi email thất bại: ${err.text || err.message || 'Lỗi không xác định'}`, 'error');
    }
  });
}

// ===== COPY TIN NHẮN =====
async function copyMessageText(orderId) {
  const textArea = document.getElementById(`msg-content-${orderId}`);
  if (!textArea) return;
  const msg = textArea.value;
  
  try {
    await navigator.clipboard.writeText(msg);
    showToast('Đã copy tin nhắn!', 'success');
  } catch (e) {
    console.error(e);
    textArea.select();
    document.execCommand('copy');
    showToast('Đã copy tin nhắn!', 'success');
  }
}

// ===== DELETE ORDER =====
async function saveOrder(e) {
  e.preventDefault();

  const phone = document.getElementById('order-phone').value.replace(/[\s\-\.]/g, '');
  const name = document.getElementById('order-name').value.trim();
  const zalo = document.getElementById('order-zalo').value.trim();
  const email = document.getElementById('order-email').value.trim();
  const social = document.getElementById('order-social').value.trim();
  const source = document.getElementById('order-source').value;
  const showDay = document.getElementById('order-day').value;
  const tier = document.getElementById('order-tier').value;
  const qty = parseInt(document.getElementById('order-qty').value) || 1;
  const unitPrice = parseVND(document.getElementById('order-price').value);
  const deposit = parseVND(document.getElementById('order-deposit').value);
  const status = document.getElementById('order-status').value;
  const delivery = document.getElementById('order-delivery').value;
  const ctv = document.getElementById('order-ctv').value;
  const seatNumber = document.getElementById('order-seat').value.trim();
  const ticketSource = document.getElementById('order-ticket-source').value.trim();
  const comboInfo = document.getElementById('order-combo').value.trim();
  const note = document.getElementById('order-note').value.trim();
  const editId = document.getElementById('edit-order-id').value;

  // Validation
  if (!validatePhone(phone)) {
    showToast('SĐT không hợp lệ (10 số, bắt đầu bằng 0)', 'error');
    return;
  }
  if (!name) {
    showToast('Vui lòng nhập tên khách', 'error');
    return;
  }
  if (!showDay) {
    showToast('Vui lòng chọn ngày diễn', 'error');
    return;
  }
  if (!tier) {
    showToast('Vui lòng chọn hạng vé', 'error');
    return;
  }

  const total = qty * unitPrice;

  if (deposit > total && total > 0) {
    showToast(`Tiền cọc (${formatVND(deposit)}) lớn hơn tổng tiền (${formatVND(total)})!`, 'error');
    return;
  }

  // Save/update customer
  let customerId;
  let existingCustomer = await db.customers.where('phone').equals(phone).first();
  if (existingCustomer) {
    customerId = existingCustomer.id;
    await db.customers.update(customerId, { name, zalo, email, social, source, updated_at: new Date().toISOString() });
  } else {
    customerId = await db.customers.add({
      uuid: genUUID(), name, phone, zalo, email, social, source, note: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
  }

  const now = new Date().toISOString();

  if (editId) {
    // Update existing order
    await db.orders.update(parseInt(editId), {
      customer_id: customerId,
      show_day: showDay,
      ticket_tier: tier,
      quantity: qty,
      unit_price: unitPrice,
      total,
      deposit_amount: deposit,
      status,
      delivery_method: delivery,
      ctv,
      seat_number: seatNumber,
      ticket_source: ticketSource,
      combo_info: comboInfo,
      note,
      updated_at: now
    });
    showToast('Đã cập nhật đơn!', 'success');
  } else {
    // Create new order
    const orderCode = await generateOrderCode();
    await db.orders.add({
      uuid: genUUID(),
      order_code: orderCode,
      customer_id: customerId,
      show_day: showDay,
      ticket_tier: tier,
      quantity: qty,
      unit_price: unitPrice,
      total,
      deposit_amount: deposit,
      status,
      payment_proof: '',
      delivery_method: delivery,
      ctv,
      seat_number: seatNumber,
      ticket_source: ticketSource,
      combo_info: comboInfo,
      note,
      created_at: now,
      updated_at: now
    });
    showToast(`Đã tạo đơn ${orderCode}!`, 'success');
  }

  closeOrderModal();
  await refreshAll();
}

// ===== ORDER DETAIL MODAL =====
async function openDetailModal(orderId) {
  const order = await db.orders.get(orderId);
  if (!order) return;

  const customer = await db.customers.get(order.customer_id);
  const modal = document.getElementById('detail-modal');
  const title = document.getElementById('detail-modal-title');
  const body = document.getElementById('detail-modal-body');
  const actions = document.getElementById('detail-modal-actions');

  title.textContent = order.order_code;

  let vipHtml = '';
  if (customer) {
    const custOrders = await db.orders.where('customer_id').equals(customer.id).toArray();
    const validOrders = custOrders.filter(o => !o.deleted_at && o.status !== 'hủy');
    if (validOrders.length > 0) {
      const totalAmount = validOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      vipHtml = `<br><span style="display:inline-block;margin-top:4px;background:var(--accent-gold);color:#000;font-weight:600;padding:2px 8px;border-radius:12px;font-size:0.75rem;">🌟 Lịch sử: Đã mua ${validOrders.length} đơn (${formatVND(totalAmount)})</span>`;
    }
  }

  const custName = customer && customer.name ? customer.name : 'bạn';
  const showDayText = order.show_day === 'day1' ? '24/10' : (order.show_day === 'day2' ? '25/10' : 'Cả 2 ngày');
  const msgTemplate = `Quân chào bạn ${custName},\nQuân đã nhận được cọc ${formatVND(order.deposit_amount)} cho đơn vé ${order.quantity} x ${order.ticket_tier} ngày ${showDayText}.\nMã đơn của bạn là: ${order.order_code}.\nKhi nào có mã vé QR Quân sẽ báo bạn ngay nhé! Cám ơn bạn ạ!`;

  body.innerHTML = `
    <div style="margin-bottom:var(--space-md)">
      <span class="order-status" data-status="${order.status}" style="font-size:0.8rem">${order.status.toUpperCase()}</span>
    </div>
    <div class="card" style="margin-bottom:var(--space-md)">
      <div class="card-header">
        <span class="card-title">👤 Khách hàng</span>
        <div style="display:flex;gap:4px;align-items:center">
          ${customer ? quickContactHTML(customer.phone) : ''}
        </div>
      </div>
      <div class="order-info">
        <strong>${customer ? esc(customer.name) : 'N/A'}</strong><br>
        📱 ${customer ? esc(customer.phone) : 'N/A'}<br>
        ${customer && customer.zalo ? '💬 Zalo: ' + esc(customer.zalo) + '<br>' : ''}
        ${customer && customer.email ? '📧 Email: ' + esc(customer.email) + '<br>' : ''}
        ${customer && customer.social ? '🌐 <a href="' + safeUrl(customer.social) + '" target="_blank" rel="noopener" style="color:var(--accent-blue);text-decoration:underline" onclick="event.stopPropagation()">' + esc(customer.social) + '</a><br>' : ''}
        🏷️ Nguồn: ${customer ? esc(customer.source) : 'N/A'}
        ${vipHtml}
        
        <div style="margin-top:12px">
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">Mẫu tin nhắn chốt đơn:</div>
          <div style="position:relative">
            <textarea id="msg-content-${order.id}" style="width:100%;height:85px;background:var(--bg-tertiary);border:1px solid rgba(255,255,255,0.05);border-radius:6px;color:var(--text-secondary);padding:8px;font-size:0.8rem;resize:none" readonly>${esc(msgTemplate)}</textarea>
            <button class="btn btn-secondary" style="position:absolute;bottom:8px;right:8px;padding:4px 8px;font-size:0.7rem;background:var(--bg-secondary)" onclick="copyMessageText('${order.id}')">📋 Copy</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:var(--space-md)">
      <div class="card-header"><span class="card-title">🎫 Chi tiết vé</span></div>
      <div class="order-info">
        🗓️ ${showDayLabel(order.show_day)}<br>
        🎫 ${esc(order.ticket_tier)} × ${order.quantity}<br>
        ${order.seat_number ? '💺 Ghế: <strong>' + esc(order.seat_number) + '</strong><br>' : ''}
        ${order.ticket_source ? '📦 Nguồn vé: <strong>' + esc(order.ticket_source) + '</strong><br>' : ''}
        ${order.combo_info ? '✈️ Combo: <strong>' + esc(order.combo_info) + '</strong><br>' : ''}
        💰 Đơn giá: ${formatVND(order.unit_price)}<br>
        <strong>💎 Tổng: ${formatVND(order.total)}</strong><br>
        🏦 Đã cọc: ${formatVND(order.deposit_amount)}<br>
        ${order.total && order.deposit_amount ? '📊 Còn thiếu: ' + formatVND(order.total - order.deposit_amount) + '<br>' : ''}
        🚚 ${esc(order.delivery_method) || 'N/A'}<br>
        ${order.ctv ? '👤 CTV: ' + esc(order.ctv) + '<br>' : ''}
        ${order.note ? '📝 ' + esc(order.note) + '<br>' : ''}
      </div>
    </div>
    <div class="card" style="margin-bottom:var(--space-md)">
      <div class="card-header"><span class="card-title">📸 Ủy nhiệm chi (Bill)</span></div>
      <div class="order-info" style="text-align:center">
        ${order.payment_proof ? `<a href="${esc(order.payment_proof)}" target="_blank" rel="noopener"><img src="${esc(order.payment_proof)}" style="max-width:100%;max-height:150px;border-radius:8px;margin-bottom:8px;object-fit:contain;background:rgba(0,0,0,0.2)"></a>` : '<p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:8px">Chưa có ảnh Ủy nhiệm chi</p>'}
        <div>
          <button class="btn btn-secondary" style="font-size:0.75rem;padding:6px 12px" onclick="document.getElementById('upload-proof-${order.id}').click()">
            ${order.payment_proof ? 'Thay ảnh khác' : 'Tải ảnh lên'}
          </button>
          <input type="file" id="upload-proof-${order.id}" accept="image/*" style="display:none" onchange="handleUploadProof(event, ${order.id}, '${order.order_code}')">
        </div>
      </div>
    </div>
    <div class="text-muted" style="font-size:0.72rem">
      Tạo: ${formatDate(order.created_at)}<br>
      Cập nhật: ${formatDate(order.updated_at)}
    </div>
  `;

  // Status change buttons
  const statusButtons = STATUSES.filter(s => s !== order.status).map(s => {
    let btnClass = 'btn-secondary';
    if (s === 'đã cọc') btnClass = 'btn-secondary';
    if (s === 'đã thanh toán đủ') btnClass = 'btn-primary';
    if (s === 'hủy' || s === 'hoàn cọc') btnClass = 'btn-danger';
    return `<button class="btn btn-sm ${btnClass}" onclick="changeOrderStatus(${orderId}, '${s}')" style="font-size:0.7rem">${s}</button>`;
  }).join('');

  const deleteBtn = (order.status === 'hủy' || order.status === 'hoàn cọc') 
    ? `<button class="btn btn-danger" onclick="deleteOrder(${orderId})">🗑️ Xóa</button>` 
    : '';

  const emailBtn = (customer && customer.email) 
    ? `<button class="btn btn-primary" onclick="sendTicketEmail(${orderId})" style="background:linear-gradient(135deg,#667eea,#764ba2)">📧 Gửi vé Email</button>` 
    : `<button class="btn btn-secondary" onclick="showToast('Khách chưa có email. Sửa đơn để thêm email.','error')" style="opacity:0.5">📧 Chưa có email</button>`;

  actions.innerHTML = `
    <button class="btn btn-secondary" onclick="closeDetailModal()">Đóng</button>
    <button class="btn btn-secondary" onclick="closeDetailModal();openOrderModal(${orderId})">✏️ Sửa</button>
    <button class="btn btn-gold" onclick="generateBill(${orderId})">📃 Bill</button>
    ${emailBtn}
    <button class="btn btn-secondary" onclick="showOrderHistory('${order.uuid || ''}', ${orderId})">🕘 Lịch sử</button>
    ${deleteBtn}
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;width:100%">
      <span style="font-size:0.7rem;color:var(--text-muted);width:100%;margin-bottom:4px">Đổi trạng thái:</span>
      ${statusButtons}
    </div>
  `;

  modal.classList.add('active');
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.remove('active');
}

// Xem lịch sử các bản đã bị ghi đè (do đồng bộ) của 1 đơn -> có thể khôi phục (chống mất dữ liệu)
async function showOrderHistory(uuid, orderId) {
  const body = document.getElementById('detail-modal-body');
  if (!uuid || !db.history) { showToast('Đơn này chưa có lịch sử thay đổi.', 'info'); return; }
  const rows = (await db.history.where('uuid').equals(uuid).toArray())
    .filter(h => h.table_name === 'orders')
    .sort((a, b) => new Date(b.replaced_at) - new Date(a.replaced_at));
  if (rows.length === 0) { showToast('Đơn này chưa có bản cũ nào (chưa từng bị ghi đè khi đồng bộ).', 'info'); return; }
  const list = rows.slice(0, 20).map(h => {
    let snap = {}; try { snap = JSON.parse(h.snapshot); } catch (e) {}
    return `<div style="border:1px solid var(--border-light);border-radius:8px;padding:8px;margin-bottom:6px;font-size:0.78rem">
      <div style="color:var(--text-muted);font-size:0.7rem">Bản lúc: ${formatDate(snap.updated_at || h.replaced_at)} · lưu khi ${h.source === 'pull' ? 'đồng bộ về' : h.source}</div>
      <div>Trạng thái: <b>${esc(snap.status || '')}</b> · SL ${snap.quantity || ''} · ${esc(snap.ticket_tier || '')} · Cọc ${formatVND(snap.deposit_amount || 0)}</div>
      ${snap.note ? '<div>Ghi chú: ' + esc(snap.note) + '</div>' : ''}
      <button class="btn btn-sm btn-secondary" style="font-size:0.7rem;margin-top:4px" onclick="restoreFromHistory(${h.id}, ${orderId})">↩️ Khôi phục bản này</button>
    </div>`;
  }).join('');
  body.insertAdjacentHTML('afterbegin',
    `<div id="order-history-panel" class="card" style="margin-bottom:var(--space-md);border:1px solid var(--accent-gold)">
       <div class="card-header"><span class="card-title">🕘 Lịch sử thay đổi (${rows.length})</span>
         <button class="btn btn-sm btn-secondary" style="font-size:0.7rem" onclick="document.getElementById('order-history-panel').remove()">Đóng</button>
       </div>
       <div style="padding:4px">${list}</div>
     </div>`);
}

// Khôi phục đơn về 1 bản cũ trong lịch sử (đặt updated_at = now để bản này thắng LWW và đẩy lên cloud)
async function restoreFromHistory(historyId, orderId) {
  const h = await db.history.get(historyId);
  if (!h) { showToast('Không tìm thấy bản lịch sử.', 'error'); return; }
  let snap = {}; try { snap = JSON.parse(h.snapshot); } catch (e) {}
  showConfirm('Khôi phục đơn về bản này? Bản hiện tại sẽ được lưu vào lịch sử trước khi ghi đè.', async () => {
    const current = await db.orders.get(orderId);
    if (current && db.history) {
      await db.history.add({ table_name: 'orders', uuid: current.uuid || '', order_code: current.order_code || '', snapshot: JSON.stringify(current), replaced_at: new Date().toISOString(), source: 'restore' });
    }
    const { id, uuid, created_at, ...rest } = snap; // giữ id/uuid/created_at hiện tại, chỉ phục nội dung
    await db.orders.update(orderId, { ...rest, updated_at: new Date().toISOString() });
    closeDetailModal();
    await refreshAll();
    showToast('Đã khôi phục đơn về bản cũ!', 'success');
  });
}

async function deleteOrder(orderId) {
  showConfirm('Xóa đơn này vào Thùng rác? Anh có thể khôi phục trong vòng 30 ngày.', async () => {
    await db.orders.update(orderId, {
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    closeDetailModal();
    await refreshAll();
    showToast('Đã chuyển vào Thùng rác! Vào Cài đặt để khôi phục.', 'success');
  });
}

// ===== THÙNG RÁC =====
async function refreshTrash() {
  const allOrders = await db.orders.toArray();
  const trashed = allOrders.filter(o => o.deleted_at);
  const customers = await db.customers.toArray();
  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  const container = document.getElementById('trash-list');
  if (!container) return;

  if (trashed.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px">🌟 Thùng rác trống!</p>';
    return;
  }

  // Tự dọn: xóa vĩnh viễn đơn quá 30 ngày
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  for (const t of trashed) {
    if (now - new Date(t.deleted_at).getTime() > THIRTY_DAYS) {
      await db.orders.delete(t.id);
    }
  }

  const stillTrashed = trashed.filter(t => now - new Date(t.deleted_at).getTime() <= THIRTY_DAYS);

  container.innerHTML = stillTrashed.map(o => {
    const c = customerMap[o.customer_id];
    const daysLeft = Math.ceil((THIRTY_DAYS - (now - new Date(o.deleted_at).getTime())) / (24*60*60*1000));
    return `
      <div class="card" style="margin-bottom:8px;opacity:0.8;border-left:3px solid var(--accent-red)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${esc(o.order_code)}</strong> — ${c ? esc(c.name) : 'N/A'}<br>
            <span class="text-muted" style="font-size:0.75rem">${esc(o.ticket_tier)} × ${o.quantity} | ${formatVND(o.total)} | Còn ${daysLeft} ngày</span>
          </div>
          <button class="btn btn-sm btn-gold" onclick="restoreOrder(${o.id})">\u21A9\uFE0F Khôi phục</button>
        </div>
      </div>
    `;
  }).join('');
}

async function restoreOrder(orderId) {
  await db.orders.update(orderId, {
    deleted_at: null,
    status: 'hủy',
    updated_at: new Date().toISOString()
  });
  await refreshTrash();
  await refreshAll();
  showToast('Đã khôi phục đơn hàng! (Trạng thái: Hủy — anh đổi lại nếu cần)', 'success');
}

async function emptyTrash() {
  showConfirm('Xóa VĨNH VIỄN tất cả đơn trong thùng rác? Không thể hoàn tác!', async () => {
    const allOrders = await db.orders.toArray();
    const trashed = allOrders.filter(o => o.deleted_at);
    for (const t of trashed) {
      await db.orders.delete(t.id);
    }
    await refreshTrash();
    showToast('Đã dọn sạch thùng rác!', 'success');
  });
}

async function changeOrderStatus(orderId, newStatus) {
  await db.orders.update(orderId, {
    status: newStatus,
    updated_at: new Date().toISOString()
  });
  showToast(`Đã đổi trạng thái → ${newStatus}`, 'success');
  closeDetailModal();
  await refreshAll();
}

// ===== ORDERS LIST =====
async function refreshOrders() {
  const allOrders = await db.orders.orderBy('id').reverse().toArray();
  const orders = allOrders.filter(o => !o.deleted_at); // Ẩn đơn trong thùng rác
  const search = (document.getElementById('order-search')?.value || '').toLowerCase().trim();
  const filterDay = document.getElementById('filter-day')?.value || '';
  const filterTier = document.getElementById('filter-tier')?.value || '';

  // Count by status
  const counts = {};
  STATUSES.forEach(s => counts[s] = 0);
  orders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });

  document.getElementById('count-all').textContent = orders.length;
  STATUSES.forEach(s => {
    const el = document.getElementById(`count-${s}`);
    if (el) el.textContent = counts[s];
  });

  // Get customers for search
  const customers = await db.customers.toArray();
  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  // Filter
  let filtered = orders;

  if (currentStatusFilter !== 'all') {
    filtered = filtered.filter(o => o.status === currentStatusFilter);
  }
  if (filterDay) {
    filtered = filtered.filter(o => o.show_day === filterDay);
  }
  if (filterTier) {
    filtered = filtered.filter(o => o.ticket_tier === filterTier);
  }
  if (search) {
    filtered = filtered.filter(o => {
      const c = customerMap[o.customer_id];
      const nameMatch = c && c.name && c.name.toLowerCase().includes(search);
      const phoneMatch = c && c.phone && c.phone.includes(search);
      const codeMatch = o.order_code && o.order_code.toLowerCase().includes(search);
      return nameMatch || phoneMatch || codeMatch;
    });
  }

  // Render (phân trang)
  const container = document.getElementById('orders-list');
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <p class="empty-text">${orders.length === 0 ? 'Chưa có đơn hàng nào' : 'Không tìm thấy đơn phù hợp'}</p>
        ${orders.length === 0 ? '<button class="btn btn-gold" onclick="openOrderModal()">Thêm đơn đầu tiên</button>' : ''}
      </div>
    `;
    return;
  }

  const totalFiltered = filtered.length;
  const visible = filtered.slice(0, (ordersPage + 1) * PAGE_SIZE);

  container.innerHTML = visible.map(order => {
    const c = customerMap[order.customer_id];
    return `
      <div class="order-card" onclick="openDetailModal(${order.id})">
        <div class="order-card-header">
          <span class="order-code">${order.order_code}</span>
          <span style="display:flex;align-items:center;gap:6px">${c ? quickContactHTML(c.phone) : ''}<span class="order-status" data-status="${order.status}">${order.status}</span></span>
        </div>
        <div class="order-card-body">
          <div class="order-info">
            <strong>${c ? esc(c.name) : 'N/A'}</strong> · ${c ? esc(c.phone) : ''}
            ${c && c.social ? '<br><a href="' + safeUrl(c.social) + '" target="_blank" rel="noopener" style="color:var(--accent-blue);font-size:0.75rem" onclick="event.stopPropagation()">🌐 Facebook</a>' : ''}<br>
            ${showDayLabel(order.show_day)} · ${esc(order.ticket_tier)} × ${order.quantity}
            ${order.seat_number ? '<br><span style="color:var(--text-gold)">💺 ' + esc(order.seat_number) + '</span>' : ''}
            ${order.ticket_source ? '<br><span style="color:var(--accent-blue)">📦 ' + esc(order.ticket_source) + '</span>' : ''}
            ${order.combo_info ? '<br><span style="color:#ff9800">✈️ ' + esc(order.combo_info) + '</span>' : ''}
            ${order.ctv ? '<br><span style="color:var(--accent-purple)">👤 ' + esc(order.ctv) + '</span>' : ''}
          </div>
          <div class="order-amount">
            <div class="total">${formatVND(order.total)}</div>
            ${order.deposit_amount ? '<div class="deposit">Cọc: ' + formatVND(order.deposit_amount) + '</div>' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (totalFiltered > visible.length) {
    container.innerHTML += `
      <div style="text-align:center;padding:16px 0 8px">
        <button class="btn btn-secondary" onclick="loadMoreOrders()" style="min-width:180px">
          Tải thêm ${Math.min(PAGE_SIZE, totalFiltered - visible.length)} đơn
        </button>
        <div style="color:var(--text-muted);font-size:0.75rem;margin-top:6px">
          Đang hiển thị ${visible.length}/${totalFiltered} đơn
        </div>
      </div>
    `;
  }
}

function setStatusFilter(status) {
  currentStatusFilter = status;
  document.querySelectorAll('#order-filters .filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === status);
  });
  filterOrders();
}

let filterTimeout = null;
function filterOrders() {
  clearTimeout(filterTimeout);
  ordersPage = 0; // reset về trang đầu khi filter/search thay đổi
  filterTimeout = setTimeout(refreshOrders, 200);
}

function loadMoreOrders() {
  ordersPage++;
  refreshOrders();
}

// ===== INVENTORY =====
async function refreshInventory() {
  const tiers = await getTiers();
  const days = ['day1', 'day2'];
  const warnings = [];

  for (const day of days) {
    const containerId = `inventory-${day}`;
    const container = document.getElementById(containerId);
    // Keep header
    const headerHTML = container.querySelector('.inventory-row.header')?.outerHTML || '';

    let rows = '';
    for (const tier of tiers) {
      const inv = await db.inventory.where({ show_day: day, ticket_tier: tier }).first();
      const totalStock = inv ? inv.total_stock : 0;
      const sold = await countSold(day, tier);
      const remaining = totalStock - sold;
      const costPrice = inv ? inv.cost_price : 0;

      const isDanger = remaining <= 0 && totalStock > 0;
      const isWarning = remaining < 0;

      if (isWarning) {
        warnings.push(`${showDayLabel(day)} — ${tier}: Bán vượt ${Math.abs(remaining)} vé!`);
      }

      // Lấy danh sách ghế đã bán cho hạng này
      const activeOrders = await db.orders.where('ticket_tier').equals(tier).toArray();
      const seatList = activeOrders
        .filter(o => ACTIVE_STATUSES.includes(o.status) && o.seat_number && (o.show_day === day || o.show_day === 'both'))
        .map(o => o.seat_number)
        .filter(s => s.trim());
      const seatHTML = seatList.length > 0
        ? `<div style="grid-column:1/-1;padding:2px 0 6px;font-size:0.73rem">
             <span style="color:var(--text-muted)">💺 Đã bán:</span>
             <span style="color:var(--status-refund)">${seatList.map(s => esc(s)).join(' · ')}</span>
           </div>`
        : '';

      rows += `
        <div class="inventory-row">
          <div>
            <span class="inventory-tier">${esc(tier)}</span>
            ${costPrice ? '<span class="inventory-day-label">Giá nhập: ' + formatVND(costPrice) + '</span>' : ''}
          </div>
          <div>
            <span class="inventory-number">${totalStock}</span>
            <span class="inventory-sub">tổng</span>
          </div>
          <div>
            <span class="inventory-number sold">${sold}</span>
            <span class="inventory-sub">đã bán</span>
          </div>
          <div>
            <span class="inventory-number ${isDanger ? 'danger' : 'remaining'}">${remaining}</span>
            <span class="inventory-sub">còn lại</span>
          </div>
          ${seatHTML}
        </div>
      `;
    }

    container.innerHTML = headerHTML + rows;
  }

  // Warnings
  const warningsEl = document.getElementById('overstock-warnings');
  if (warnings.length > 0) {
    warningsEl.innerHTML = warnings.map(w => `
      <div class="overstock-warning">
        <span class="warn-icon">🚨</span>
        <span class="warn-text">${w}</span>
      </div>
    `).join('');
  } else {
    warningsEl.innerHTML = '';
  }
}

// ===== INVENTORY MODAL =====
async function openInventoryModal() {
  const tiers = await getTiers();
  const days = ['day1', 'day2'];
  const modal = document.getElementById('inventory-modal');
  const body = document.getElementById('inventory-form-body');

  let html = '';
  for (const day of days) {
    html += `<h4 style="margin:var(--space-md) 0 var(--space-sm);color:var(--text-gold)">${showDayLabel(day)}</h4>`;
    for (const tier of tiers) {
      const inv = await db.inventory.where({ show_day: day, ticket_tier: tier }).first();
      const totalStock = inv ? inv.total_stock : 0;
      const costPrice = inv ? inv.cost_price : 0;



      html += `
        <div class="form-row" style="margin-bottom:var(--space-sm)">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">${esc(tier)} — Tổng vé</label>
            <input type="number" class="form-input inv-stock" data-day="${day}" data-tier="${esc(tier)}" value="${totalStock}" min="0">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">${esc(tier)} — Giá nhập</label>
            <input type="text" class="form-input inv-cost" data-day="${day}" data-tier="${esc(tier)}" value="${costPrice ? new Intl.NumberFormat('vi-VN').format(costPrice) : ''}" placeholder="0" inputmode="numeric" oninput="this.value = parseVND(this.value) ? new Intl.NumberFormat('vi-VN').format(parseVND(this.value)) : ''">
          </div>
        </div>
      `;
    }
  }

  body.innerHTML = html;
  modal.classList.add('active');
}

function closeInventoryModal() {
  document.getElementById('inventory-modal').classList.remove('active');
}

async function saveInventory() {
  const stockInputs = document.querySelectorAll('.inv-stock');
  const costInputs = document.querySelectorAll('.inv-cost');


  for (let i = 0; i < stockInputs.length; i++) {
    const day = stockInputs[i].dataset.day;
    const tier = stockInputs[i].dataset.tier;
    const stock = parseInt(stockInputs[i].value) || 0;
    const cost = parseVND(costInputs[i].value);

    const existing = await db.inventory.where({ show_day: day, ticket_tier: tier }).first();
    if (existing) {
      await db.inventory.update(existing.id, { total_stock: stock, cost_price: cost, updated_at: new Date().toISOString() });
    } else {
      await db.inventory.add({ uuid: genUUID(), show_day: day, ticket_tier: tier, total_stock: stock, cost_price: cost, updated_at: new Date().toISOString() });
    }
  }

  closeInventoryModal();
  await refreshInventory();
  showToast('Đã cập nhật tồn kho!', 'success');
}

// ===== FOLLOW-UP =====
async function refreshFollowup() {
  const orders = (await db.orders.toArray()).filter(o => !o.deleted_at);
  const customers = await db.customers.toArray();
  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  const now = new Date();
  const h24ago = new Date(now - 24 * 60 * 60 * 1000);
  const showDate1 = new Date('2026-10-24');
  const showDate2 = new Date('2026-10-25');
  const daysUntilShow = Math.min(
    Math.ceil((showDate1 - now) / (1000 * 60 * 60 * 24)),
    Math.ceil((showDate2 - now) / (1000 * 60 * 60 * 24))
  );

  // Đơn mới > 24h
  const newOver24h = orders.filter(o =>
    o.status === 'mới' && new Date(o.created_at) < h24ago
  );

  // Đã cọc chưa TT đủ (gần show: < 14 ngày)
  const unpaid = orders.filter(o =>
    o.status === 'đã cọc' && daysUntilShow <= 14
  );

  // Update badge
  const totalFollowup = newOver24h.length + unpaid.length;
  const badge = document.getElementById('followup-badge');
  if (totalFollowup > 0) {
    badge.textContent = totalFollowup;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Render new > 24h
  const container1 = document.getElementById('followup-new-24h');
  if (newOver24h.length === 0) {
    container1.innerHTML = '<div class="followup-empty"><span class="empty-icon">✅</span>Không có đơn nào cần xử lý</div>';
  } else {
    container1.innerHTML = newOver24h.map(order => {
      const c = customerMap[order.customer_id];
      const hoursAgo = Math.round((now - new Date(order.created_at)) / (1000 * 60 * 60));
      return `
        <div class="order-card" onclick="openDetailModal(${order.id})">
          <div class="order-card-header">
            <span class="order-code">${order.order_code}</span>
            <span style="display:flex;align-items:center;gap:6px">${c ? quickContactHTML(c.phone) : ''}<span style="color:var(--status-refund);font-size:0.75rem">⏰ ${hoursAgo}h trước</span></span>
          </div>
          <div class="order-card-body">
            <div class="order-info">
              <strong>${c ? esc(c.name) : 'N/A'}</strong> · ${c ? esc(c.phone) : ''}<br>
              ${showDayLabel(order.show_day)} · ${esc(order.ticket_tier)} × ${order.quantity}
              ${order.seat_number ? '<br><span style="color:var(--text-gold)">💺 ' + esc(order.seat_number) + '</span>' : ''}
            </div>
            <div class="order-amount">
              <div class="total">${formatVND(order.total)}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render unpaid
  const container2 = document.getElementById('followup-unpaid');
  if (unpaid.length === 0) {
    container2.innerHTML = '<div class="followup-empty"><span class="empty-icon">✅</span>Không có đơn nào cần xử lý</div>';
  } else {
    container2.innerHTML = unpaid.map(order => {
      const c = customerMap[order.customer_id];
      const remaining = (order.total || 0) - (order.deposit_amount || 0);
      return `
        <div class="order-card" onclick="openDetailModal(${order.id})">
          <div class="order-card-header">
            <span class="order-code">${order.order_code}</span>
            <span style="display:flex;align-items:center;gap:6px">${c ? quickContactHTML(c.phone) : ''}<span style="color:var(--status-deposit);font-size:0.75rem">💳 Thiếu ${formatVND(remaining)}</span></span>
          </div>
          <div class="order-card-body">
            <div class="order-info">
              <strong>${c ? esc(c.name) : 'N/A'}</strong> · ${c ? esc(c.phone) : ''}<br>
              ${showDayLabel(order.show_day)} · ${esc(order.ticket_tier)} × ${order.quantity}
              ${order.seat_number ? '<br><span style="color:var(--text-gold)">💺 ' + esc(order.seat_number) + '</span>' : ''}
            </div>
            <div class="order-amount">
              <div class="total">${formatVND(order.total)}</div>
              <div class="deposit">Đã cọc: ${formatVND(order.deposit_amount)}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ===== DASHBOARD =====
async function refreshDashboard() {
  const allOrders = await db.orders.toArray();
  const orders = allOrders.filter(o => !o.deleted_at);
  const customers = await db.customers.toArray();
  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  // Đơn ĐÃ CHỐT = đã cọc trở lên. Đơn 'mới' (khách hỏi, chưa cọc) KHÔNG tính vào doanh thu.
  const confirmedOrders = orders.filter(o => ACTIVE_STATUSES.includes(o.status));
  const pipelineOrders = orders.filter(o => o.status === 'mới');

  const totalOrders = confirmedOrders.length;
  const totalRevenue = confirmedOrders.reduce((s, o) => s + (o.total || 0), 0);

  // Tiền THỰC đã thu: đơn TT đủ / đã giao => full; đơn mới cọc => phần cọc
  const totalReceived = confirmedOrders.reduce((s, o) => {
    if (o.status === 'đã thanh toán đủ' || o.status === 'đã giao vé') return s + (o.total || 0);
    return s + (o.deposit_amount || 0);
  }, 0);
  const totalRemaining = totalRevenue - totalReceived;

  // Chi phí vốn: đơn 'cả 2 ngày' = vé Day1 + vé Day2 (đúng cả giá nhập từng ngày)
  let totalCost = 0;
  for (const order of confirmedOrders) {
    const days = order.show_day === 'both' ? ['day1', 'day2'] : [order.show_day];
    for (const d of days) {
      const inv = await db.inventory.where({ show_day: d, ticket_tier: order.ticket_tier }).first();
      if (inv && inv.cost_price) {
        totalCost += inv.cost_price * (order.quantity || 0);
      }
    }
  }
  const profit = totalRevenue - totalCost;

  document.getElementById('stat-total-orders').textContent = totalOrders;
  const pipelineEl = document.getElementById('stat-pipeline-note');
  if (pipelineEl) pipelineEl.textContent = pipelineOrders.length > 0 ? `+${pipelineOrders.length} đơn mới chờ chốt` : '';
  const setMoney = (id, val) => {
    const el = document.getElementById(id);
    el.textContent = formatVNDShort(val);
    el.title = formatVND(val); // giữ số đầy đủ khi rê chuột / chạm giữ
  };
  setMoney('stat-revenue', totalRevenue);
  setMoney('stat-deposit', totalReceived);
  setMoney('stat-remaining', totalRemaining);
  setMoney('stat-profit', profit);

  renderCountdown();

  // Charts
  renderCharts(orders, customers, customerMap);

  // Nhắc backup nếu quá 24h
  updateBackupBanner();
}

function renderCharts(orders, customers, customerMap) {
  const activeOrders = orders.filter(o => o.status !== 'hủy' && o.status !== 'hoàn cọc');

  // Chart 1: Revenue by date
  const dateMap = {};
  activeOrders.forEach(o => {
    const d = formatDateShort(o.created_at);
    dateMap[d] = (dateMap[d] || 0) + (o.total || 0);
  });
  const dateLabels = Object.keys(dateMap).sort();
  const dateData = dateLabels.map(d => dateMap[d]);

  const ctx1 = document.getElementById('chart-orders-by-date');
  if (chartOrdersByDate) chartOrdersByDate.destroy();
  chartOrdersByDate = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: dateLabels.length ? dateLabels : ['Chưa có dữ liệu'],
      datasets: [{
        label: 'Doanh thu',
        data: dateData.length ? dateData : [0],
        backgroundColor: 'rgba(240, 192, 64, 0.2)',
        borderColor: '#f0c040',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointBackgroundColor: '#f0c040'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return 'Doanh thu: ' + new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(context.raw);
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#a0a0c0', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { 
          ticks: { 
            color: '#a0a0c0', 
            callback: function(value) {
              if (value >= 1000000) return (value / 1000000) + 'Tr';
              return value;
            }
          }, 
          grid: { color: 'rgba(255,255,255,0.05)' }, 
          beginAtZero: true 
        }
      }
    }
  });



  // Chart 3: Tier distribution
  const tierMap = {};
  activeOrders.forEach(o => {
    tierMap[o.ticket_tier] = (tierMap[o.ticket_tier] || 0) + o.quantity;
  });
  const tierLabels = Object.keys(tierMap);
  const tierData = tierLabels.map(t => tierMap[t]);

  const ctx3 = document.getElementById('chart-tier');
  if (chartTier) chartTier.destroy();
  chartTier = new Chart(ctx3, {
    type: 'polarArea',
    data: {
      labels: tierLabels.length ? tierLabels : ['Chưa có dữ liệu'],
      datasets: [{
        data: tierData.length ? tierData : [1],
        backgroundColor: ['rgba(240,192,64,0.5)', 'rgba(79,195,247,0.5)', 'rgba(206,147,216,0.5)', 'rgba(102,187,106,0.5)', 'rgba(255,167,38,0.5)', 'rgba(244,143,177,0.5)'],
        borderColor: '#1a1a2e',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#a0a0c0', padding: 12, usePointStyle: true, font: { size: 12 } }
        }
      },
      scales: {
        r: {
          ticks: { display: false },
          grid: { color: 'rgba(255,255,255,0.08)' }
        }
      }
    }
  });
}

// ===== BILL GENERATION =====
async function generateBill(orderId) {
  const order = await db.orders.get(orderId);
  if (!order) return;

  const customer = await db.customers.get(order.customer_id);
  const shopName = (await db.settings.get('shopName'))?.value || 'BigBang Ticket VN';
  const shopPhone = (await db.settings.get('shopPhone'))?.value || '';

  const billHTML = `
    <div class="bill-preview" id="bill-to-capture">
      <div class="bill-header">
        <div class="bill-logo">👑</div>
        <div class="bill-shop-name">${esc(shopName)}</div>
        <div class="bill-title">Xác nhận đơn hàng</div>
      </div>
      <div class="bill-body">
        <div class="bill-row">
          <span class="label">Mã đơn</span>
          <span class="value" style="font-weight:800;color:#c49b1a">${order.order_code}</span>
        </div>
        <div class="bill-row">
          <span class="label">Khách hàng</span>
          <span class="value">${customer ? esc(maskName(customer.name)) : 'N/A'}</span>
        </div>
        <div class="bill-row">
          <span class="label">Ngày diễn</span>
          <span class="value">${showDayLabel(order.show_day)}</span>
        </div>
        <div class="bill-row">
          <span class="label">Hạng vé</span>
          <span class="value">${esc(order.ticket_tier)}</span>
        </div>
        <div class="bill-row">
          <span class="label">Số lượng</span>
          <span class="value">${order.quantity}</span>
        </div>
        ${order.seat_number ? `
        <div class="bill-row">
          <span class="label">Số ghế</span>
          <span class="value" style="color:#4fc3f7;font-weight:800">${esc(order.seat_number)}</span>
        </div>` : ''}
        <div class="bill-row">
          <span class="label">Đơn giá</span>
          <span class="value">${formatVND(order.unit_price)}</span>
        </div>
        <div class="bill-total">
          <span>Tổng cộng</span>
          <span>${formatVND(order.total)}</span>
        </div>
        ${order.deposit_amount ? `
        <div class="bill-row" style="border:none">
          <span class="label">Đã cọc</span>
          <span class="value" style="color:#66bb6a">${formatVND(order.deposit_amount)}</span>
        </div>
        <div class="bill-row" style="border:none">
          <span class="label">Còn lại</span>
          <span class="value" style="color:#ef5350">${formatVND(order.total - order.deposit_amount)}</span>
        </div>
        ` : ''}
        <div class="bill-row" style="border:none">
          <span class="label">Hình thức giao</span>
          <span class="value">${esc(order.delivery_method) || 'N/A'}</span>
        </div>
      </div>
      <div class="bill-footer">
        ${order.combo_info ? '<div style="text-align:center;margin-bottom:8px;color:#ff9800;font-weight:700">✈️ ' + esc(order.combo_info) + '</div>' : ''}
        <div id="bill-qr-container" style="text-align:center;margin-bottom:10px"></div>
        <strong>Vui lòng giữ mã đơn để đối chiếu khi nhận vé</strong><br>
        Concert BIGBANG 2026 — SVĐ Mỹ Đình, Hà Nội<br>
        ${shopPhone ? '📱 ' + esc(shopPhone) : ''}<br>
        <span style="color:#ccc;font-size:0.65rem">${new Date().toLocaleDateString('vi-VN')}</span>
      </div>
    </div>
  `;

  // Show in modal
  document.getElementById('bill-content').innerHTML = billHTML;
  document.getElementById('bill-modal').classList.add('active');

  // Generate QR code
  try {
    const tracuuBase = new URL('tracuu.html', window.location.href).href;
    const qrUrl = tracuuBase + '?code=' + encodeURIComponent(order.order_code);
    const qr = qrcode(0, 'M');
    qr.addData(qrUrl);
    qr.make();
    const qrContainer = document.getElementById('bill-qr-container');
    if (qrContainer) {
      qrContainer.innerHTML = qr.createImgTag(3, 4) + '<br><span style="font-size:0.55rem;color:#999">Quét để tra cứu đơn hàng</span>';
    }
  } catch(e) { console.warn('QR generation failed', e); }

  // Also render offscreen for capture
  document.getElementById('bill-render-target').innerHTML = document.getElementById('bill-content').innerHTML;
  closeDetailModal();
}

function closeBillModal() {
  document.getElementById('bill-modal').classList.remove('active');
}

async function copyBill() {
  const billEl = document.getElementById('bill-to-capture');
  if (!billEl) return;
  // Ghi vào clipboard NGAY trong lượt bấm của người dùng (truyền Promise vào ClipboardItem)
  // -> ảnh dán ra là PNG chuẩn, không bị thành file lạ
  try {
    if (!navigator.clipboard || !window.ClipboardItem) {
      showToast('Trình duyệt không hỗ trợ copy ảnh — dùng nút Tải PNG nhé', 'warning');
      return;
    }
    const blobPromise = html2canvas(billEl, {
      backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
    }).then(canvas => new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Không tạo được ảnh')), 'image/png');
    }));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    showToast('Đã copy ảnh bill — dán thẳng vào Zalo (Ctrl+V)!', 'success');
  } catch (err) {
    showToast('Copy ảnh không được trên trình duyệt này — dùng nút Tải PNG nhé', 'warning');
  }
}

async function downloadBill() {
  const billEl = document.getElementById('bill-to-capture');
  if (!billEl) return;

  try {
    const canvas = await html2canvas(billEl, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const link = document.createElement('a');
    link.download = `bill_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    showToast('Đã tải bill PNG!', 'success');
  } catch (err) {
    showToast('Lỗi tạo ảnh bill: ' + err.message, 'error');
  }
}

async function shareBill() {
  const billEl = document.getElementById('bill-to-capture');
  if (!billEl) return;

  try {
    const canvas = await html2canvas(billEl, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], `bill_${Date.now()}.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'Bill xác nhận đơn hàng',
        text: 'Thông tin đơn hàng vé Concert BigBang 2026',
        files: [file]
      });
      showToast('Đã chia sẻ bill!', 'success');
    } else {
      // Fallback: copy ảnh vào clipboard
      await copyBill();
      showToast('Trình duyệt không hỗ trợ chia sẻ — đã copy ảnh thay thế!', 'warning');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Lỗi chia sẻ: ' + err.message, 'error');
    }
  }
}

// ===== EXPORT CSV =====
async function exportCSV() {
  const allOrders = await db.orders.toArray();
  const orders = allOrders.filter(o => !o.deleted_at);
  const customers = await db.customers.toArray();
  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  const headers = ['Mã đơn', 'Tên khách', 'SĐT', 'Zalo', 'Facebook', 'Nguồn KH', 'Ngày show', 'Hạng vé', 'SL', 'Số ghế', 'Nguồn vé', 'Combo', 'Đơn giá', 'Tổng tiền', 'Đã cọc', 'Còn thiếu', 'Trạng thái', 'Giao hàng', 'CTV', 'Ghi chú', 'Ngày tạo'];

  const data = orders.map(o => {
    const c = customerMap[o.customer_id];
    const remaining = (o.total || 0) - (o.deposit_amount || 0);
    return {
      'Mã đơn': o.order_code,
      'Tên khách': c ? c.name : '',
      'SĐT': c ? c.phone : '',
      'Zalo': c ? c.zalo : '',
      'Facebook': c ? (c.social || '') : '',
      'Nguồn KH': c ? c.source : '',
      'Ngày show': showDayLabel(o.show_day),
      'Hạng vé': o.ticket_tier,
      'SL': o.quantity || 0,
      'Số ghế': o.seat_number || '',
      'Nguồn vé': o.ticket_source || '',
      'Combo': o.combo_info || '',
      'Đơn giá': o.unit_price || 0,
      'Tổng tiền': o.total || 0,
      'Đã cọc': o.deposit_amount || 0,
      'Còn thiếu': remaining,
      'Trạng thái': o.status,
      'Giao hàng': o.delivery_method || '',
      'CTV': o.ctv || '',
      'Ghi chú': o.note || '',
      'Ngày tạo': o.created_at ? new Date(o.created_at).toLocaleString('vi-VN') : ''
    };
  });

  // Dùng SheetJS nếu có (xuất .xlsx đẹp), fallback CSV nếu không
  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });

    // Auto-width cột
    const colWidths = headers.map((h) => {
      let maxLen = h.length;
      data.forEach(row => {
        const val = String(row[h] || '');
        if (val.length > maxLen) maxLen = val.length;
      });
      return { wch: Math.min(maxLen + 3, 35) };
    });
    ws['!cols'] = colWidths;

    // Format cột tiền dạng số có dấu phẩy
    const moneyHeaders = ['Đơn giá', 'Tổng tiền', 'Đã cọc', 'Còn thiếu'];
    const moneyColIdx = moneyHeaders.map(h => headers.indexOf(h));
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      for (const C of moneyColIdx) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr]) ws[addr].z = '#,##0';
      }
    }

    // Tạo sheet Tồn kho
    const inventory = await db.inventory.toArray();
    const invData = [];
    for (const inv of inventory) {
      const sold = await countSold(inv.show_day, inv.ticket_tier);
      invData.push({
        'Ngày show': showDayLabel(inv.show_day),
        'Hạng vé': inv.ticket_tier,
        'Tổng kho': inv.total_stock,
        'Đã bán': sold,
        'Còn lại': inv.total_stock - sold,
        'Giá vốn': inv.cost_price || 0
      });
    }
    const ws2 = XLSX.utils.json_to_sheet(invData);
    ws2['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }];

    // Tạo sheet Tổng hợp
    const confirmed = orders.filter(o => ['đã cọc', 'đã thanh toán đủ', 'đã giao vé'].includes(o.status));
    const summaryData = [
      { 'Chỉ số': 'Tổng đơn hàng', 'Giá trị': orders.length },
      { 'Chỉ số': 'Đơn đã chốt', 'Giá trị': confirmed.length },
      { 'Chỉ số': 'Tổng doanh thu', 'Giá trị': confirmed.reduce((s, o) => s + (o.total || 0), 0) },
      { 'Chỉ số': 'Tổng đã thu', 'Giá trị': confirmed.reduce((s, o) => s + (o.deposit_amount || 0), 0) },
      { 'Chỉ số': 'Tổng còn thiếu', 'Giá trị': confirmed.reduce((s, o) => s + ((o.total || 0) - (o.deposit_amount || 0)), 0) },
      { 'Chỉ số': 'Đơn mới chưa chốt', 'Giá trị': orders.filter(o => o.status === 'mới').length },
      { 'Chỉ số': 'Đơn hủy/hoàn', 'Giá trị': orders.filter(o => o.status === 'hủy' || o.status === 'hoàn cọc').length },
    ];
    const ws3 = XLSX.utils.json_to_sheet(summaryData);
    ws3['!cols'] = [{ wch: 25 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Đơn hàng');
    XLSX.utils.book_append_sheet(wb, ws2, 'Tồn kho');
    XLSX.utils.book_append_sheet(wb, ws3, 'Tổng hợp');

    XLSX.writeFile(wb, `BigBang_CRM_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('✅ Đã export ' + orders.length + ' đơn ra Excel! (3 sheet: Đơn hàng + Tồn kho + Tổng hợp)', 'success');
  } else {
    // Fallback CSV
    const safeCell = (cell) => {
      let s = String(cell === null || cell === undefined ? '' : cell);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csvRows = data.map(row => headers.map(h => safeCell(row[h])).join(','));
    const csvContent = '\uFEFF' + [headers.map(safeCell).join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'bigbang_orders_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    showToast('Đã export ' + orders.length + ' đơn ra CSV!', 'success');
  }
}

// ===== BACKUP / RESTORE =====
async function exportAllData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    customers: await db.customers.toArray(),
    orders: await db.orders.toArray(),
    inventory: await db.inventory.toArray(),
    settings: await db.settings.toArray(),
    resales: await db.resales.toArray(),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `bigbang_backup_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();

  await db.settings.put({ key: 'lastBackup', value: new Date().toISOString() });
  updateBackupBanner();
  showToast('Đã backup toàn bộ dữ liệu!', 'success');
}

// ===== ĐẾM NGƯỢC CONCERT =====
function renderCountdown() {
  const el = document.getElementById('countdown-banner');
  if (!el) return;
  const now = new Date();
  const day1 = new Date('2026-10-24T00:00:00+07:00');
  const day2 = new Date('2026-10-25T00:00:00+07:00');
  const end = new Date('2026-10-26T00:00:00+07:00');
  const days = Math.ceil((day1 - now) / 86400000);

  let html = '';
  if (now >= day1 && now < day2) {
    html = '🔥 <strong>HÔM NAY LÀ DAY 1!</strong> — Chúc anh em giao vé thuận lợi 👑';
  } else if (now >= day2 && now < end) {
    html = '🔥 <strong>HÔM NAY LÀ DAY 2!</strong> — Đêm cuối rồi, cháy hết mình 👑';
  } else if (now >= end) {
    html = '🎉 Concert đã khép lại — hẹn mùa vé sau! Nhớ tổng kết lợi nhuận & backup dữ liệu.';
  } else {
    html = `👑 Còn <span class="countdown-num">${days}</span> ngày tới <strong>BIGBANG Day 1</strong> · 24–25/10/2026 · SVĐ Mỹ Đình`;
  }
  el.innerHTML = html;
}

// ===== BACKUP REMINDER BANNER =====
async function updateBackupBanner() {
  const banner = document.getElementById('backup-banner');
  if (!banner) return;
  const orderCount = await db.orders.count();
  if (orderCount === 0) { banner.classList.add('hidden'); return; }
  const stored = await db.settings.get('lastBackup');
  const last = stored ? new Date(stored.value) : null;
  const hours = last ? (Date.now() - last.getTime()) / 36e5 : Infinity;
  if (hours >= 24) {
    banner.classList.remove('hidden');
    document.getElementById('backup-banner-text').textContent = last
      ? `⚠️ Đã ${Math.floor(hours)}h chưa backup dữ liệu. Dữ liệu nằm trong trình duyệt — xóa cache là MẤT!`
      : '⚠️ Bạn chưa backup lần nào. Dữ liệu nằm trong trình duyệt — xóa cache là MẤT!';
  } else {
    banner.classList.add('hidden');
  }
}

async function importAllData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.version || !data.customers || !data.orders) {
      showToast('File backup không hợp lệ!', 'error');
      return;
    }

    showConfirm('📥 Import sẽ ghi đè toàn bộ dữ liệu hiện tại. Tiếp tục?', async () => {
      await db.customers.clear();
      await db.orders.clear();
      await db.inventory.clear();
      await db.settings.clear();
      await db.resales.clear();

      await db.customers.bulkAdd(data.customers);
      await db.orders.bulkAdd(data.orders);
      if (data.inventory) await db.inventory.bulkAdd(data.inventory);
      if (data.settings) await db.settings.bulkAdd(data.settings);
      if (data.resales) await db.resales.bulkAdd(data.resales);

      // bulkAdd BỎ QUA Dexie hook -> backfill uuid cho record thiếu để còn sync được lên cloud
      for (const t of ['customers', 'orders', 'inventory', 'resales']) {
        const rows = await db[t].filter(r => !r.uuid).toArray();
        for (const r of rows) await db[t].update(r.id, { uuid: genUUID() });
      }
      // Đẩy toàn bộ dữ liệu vừa import lên cloud (nếu đang kết nối)
      if (typeof window.reconcileSync === 'function') await window.reconcileSync(true);

      await loadSettings();
      await refreshAll();
      showToast('Đã import dữ liệu thành công!', 'success');
    });
  } catch (err) {
    showToast('Lỗi đọc file: ' + err.message, 'error');
  }

  event.target.value = '';
}

// ===== SEED DATA =====
function confirmSeedData() {
  showConfirm('⚡ Tạo 10 đơn mẫu sẽ XÓA toàn bộ dữ liệu hiện tại. Tiếp tục?', seedData);
}

async function seedData() {
  await db.customers.clear();
  await db.orders.clear();
  await db.inventory.clear();
  await db.resales.clear();

  // Ensure default tiers
  await db.settings.put({ key: 'ticketTiers', value: JSON.stringify(DEFAULT_TIERS) });

  // Seed inventory
  const tiers = DEFAULT_TIERS;
  const stockMap = {
    'VIP Soundcheck': { stock: 10, cost: 8000000 },
    'VIP': { stock: 20, cost: 5500000 },
    'CAT1': { stock: 30, cost: 3500000 },
    'CAT2': { stock: 40, cost: 2200000 },
    'CAT3': { stock: 50, cost: 1200000 },
  };

  for (const day of ['day1', 'day2']) {
    for (const tier of tiers) {
      const info = stockMap[tier] || { stock: 20, cost: 2000000 };
      await db.inventory.add({
        show_day: day,
        ticket_tier: tier,
        total_stock: info.stock,
        cost_price: info.cost,
      });
    }
  }

  // Seed customers & orders
  const seedCustomers = [
    { name: 'Nguyễn Minh Anh', phone: '0901234567', zalo: '0901234567', social: '', source: 'zalo' },
    { name: 'Trần Thị Bảo Ngọc', phone: '0912345678', zalo: 'zalo.me/0912345678', social: 'threads/@baongoc', source: 'threads' },
    { name: 'Lê Hoàng Phúc', phone: '0923456789', zalo: '0923456789', social: '', source: 'fb_group' },
    { name: 'Phạm Quỳnh Như', phone: '0934567890', zalo: '0934567890', social: 'fb.com/quynhnhu', source: 'fb_group' },
    { name: 'Vũ Đức Thắng', phone: '0945678901', zalo: '', social: 'threads/@ducthang', source: 'threads' },
    { name: 'Hoàng Yến Nhi', phone: '0956789012', zalo: '0956789012', social: '', source: 'zalo' },
    { name: 'Đặng Tuấn Kiệt', phone: '0967890123', zalo: '0967890123', social: '', source: 'referral' },
    { name: 'Bùi Thanh Hằng', phone: '0978901234', zalo: '0978901234', social: 'fb.com/thanhhang', source: 'fb_group' },
    { name: 'Ngô Khánh Linh', phone: '0989012345', zalo: '', social: 'threads/@khanhlinh', source: 'threads' },
    { name: 'Mai Xuân Đạt', phone: '0990123456', zalo: '0990123456', social: '', source: 'zalo' },
  ];

  const priceMap = {
    'VIP Soundcheck': 12000000,
    'VIP': 8000000,
    'CAT1': 5000000,
    'CAT2': 3500000,
    'CAT3': 2000000,
  };

  const seedOrders = [
    { ci: 0, day: 'day1', tier: 'VIP Soundcheck', qty: 2, status: 'đã thanh toán đủ', deposit: 24000000, delivery: 'giao tận tay', hoursAgo: 72 },
    { ci: 1, day: 'day2', tier: 'VIP', qty: 1, status: 'đã cọc', deposit: 2500000, delivery: 'gửi ship', hoursAgo: 48, note: 'Ship về Đà Nẵng' },
    { ci: 2, day: 'both', tier: 'CAT1', qty: 2, status: 'đã cọc', deposit: 3000000, delivery: 'nhận tại sân', hoursAgo: 36 },
    { ci: 3, day: 'day1', tier: 'CAT2', qty: 3, status: 'mới', deposit: 0, delivery: 'giao tận tay', hoursAgo: 30 },
    { ci: 4, day: 'day2', tier: 'CAT3', qty: 2, status: 'đã giao vé', deposit: 4000000, delivery: 'e-ticket', hoursAgo: 96 },
    { ci: 5, day: 'day1', tier: 'VIP', qty: 1, status: 'đã cọc', deposit: 2000000, delivery: 'giao tận tay', hoursAgo: 60 },
    { ci: 6, day: 'day1', tier: 'CAT1', qty: 4, status: 'mới', deposit: 0, delivery: 'giao tận tay', hoursAgo: 26, note: 'Nhóm bạn, đợi xác nhận' },
    { ci: 7, day: 'day2', tier: 'VIP Soundcheck', qty: 1, status: 'đã thanh toán đủ', deposit: 12000000, delivery: 'giao tận tay', hoursAgo: 120 },
    { ci: 8, day: 'day1', tier: 'CAT2', qty: 2, status: 'hủy', deposit: 0, delivery: 'giao tận tay', hoursAgo: 48 },
    { ci: 9, day: 'both', tier: 'VIP', qty: 2, status: 'đã cọc', deposit: 5000000, delivery: 'gửi ship', hoursAgo: 12, note: 'Khách VIP, chăm sóc kỹ' },
  ];

  // Add customers
  const customerIds = [];
  for (const c of seedCustomers) {
    const id = await db.customers.add({ ...c, note: '', created_at: new Date().toISOString() });
    customerIds.push(id);
  }

  // Add orders
  for (let i = 0; i < seedOrders.length; i++) {
    const s = seedOrders[i];
    const unitPrice = priceMap[s.tier] || 3000000;
    const total = unitPrice * s.qty;
    const created = new Date(Date.now() - s.hoursAgo * 60 * 60 * 1000).toISOString();

    await db.orders.add({
      order_code: 'BB-' + String(i + 1).padStart(4, '0'),
      customer_id: customerIds[s.ci],
      show_day: s.day,
      ticket_tier: s.tier,
      quantity: s.qty,
      unit_price: unitPrice,
      total,
      deposit_amount: s.deposit,
      status: s.status,
      payment_proof: '',
      delivery_method: s.delivery,
      ctv: '',
      note: s.note || '',
      created_at: created,
      updated_at: created,
    });
  }

  await db.settings.put({ key: 'orderCounter', value: '10' });

  await renderTiers();
  await refreshAll();
  showToast('Đã tạo 10 đơn mẫu + tồn kho demo!', 'success');
}

// ===================================================================
// PASS VÉ / KÝ GỬI — khách nhờ shop bán lại vé (không đi được / đổi hạng)
// ===================================================================

async function refreshResales() {
  const resales = await db.resales.orderBy('id').reverse().toArray();
  const container = document.getElementById('resales-list');
  if (!container) return;

  // Badge: số vé đang cần rao
  const activeCount = resales.filter(r => r.status === 'chờ rao' || r.status === 'đang rao').length;
  const badge = document.getElementById('resale-badge');
  if (badge) {
    if (activeCount > 0) { badge.textContent = activeCount; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }

  // Tổng quan nhỏ đầu tab
  const doneCount = resales.filter(r => r.status === 'đã pass').length;
  const feeEarned = resales.filter(r => r.status === 'đã pass').reduce((s, r) => s + (r.service_fee || 0), 0);
  const summary = document.getElementById('resale-summary');
  if (summary) {
    summary.innerHTML = resales.length === 0 ? '' : `
      <div class="resale-summary-row">
        <span>🔁 Đang cần pass: <strong>${activeCount}</strong></span>
        <span>✅ Đã pass: <strong>${doneCount}</strong></span>
        <span>💵 Phí DV đã thu: <strong style="color:var(--gold-primary)">${formatVND(feeEarned)}</strong></span>
      </div>`;
  }

  if (resales.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔁</span>
        <p class="empty-text">Chưa có vé ký gửi nào.<br><span style="font-size:0.78rem">Khách không đi được hoặc muốn đổi hạng? Nhận ký gửi tại đây — vừa giữ uy tín, vừa thu phí dịch vụ.</span></p>
        <button class="btn btn-gold" onclick="openResaleModal()">+ Nhận ký gửi đầu tiên</button>
      </div>`;
    return;
  }

  container.innerHTML = resales.map(r => {
    const refund = (r.asking_price || 0) - (r.service_fee || 0);
    return `
      <div class="order-card resale-card" data-rstatus="${esc(r.status)}" onclick="openResaleDetail(${r.id})">
        <div class="order-card-header">
          <span class="order-code">${r.order_code ? esc(r.order_code) : 'KG-' + String(r.id).padStart(3, '0')}</span>
          <span style="display:flex;align-items:center;gap:6px">${quickContactHTML(r.customer_phone)}<span class="resale-status" data-rstatus="${esc(r.status)}">${esc(r.status)}</span></span>
        </div>
        <div class="order-card-body">
          <div class="order-info">
            <strong>${esc(r.customer_name)}</strong> · ${esc(r.customer_phone || '')}<br>
            ${showDayLabel(r.show_day)} · ${esc(r.ticket_tier)} × ${r.quantity}
            ${r.seat_number ? '<br><span style="color:var(--text-gold)">💺 ' + esc(r.seat_number) + '</span>' : ''}<br>
            <span class="text-muted" style="font-size:0.75rem">Lý do: ${esc(r.reason)}</span>
          </div>
          <div class="order-amount">
            <div class="total">Rao: ${formatVND(r.asking_price)}</div>
            <div class="deposit">Phí: ${formatVND(r.service_fee)} · Hoàn khách: ${formatVND(refund)}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function openResaleModal() {
  const modal = document.getElementById('resale-modal');
  document.getElementById('resale-form').reset();
  document.getElementById('edit-resale-id').value = '';
  document.getElementById('resale-refund-preview').textContent = '';

  // Dropdown đơn gốc: chỉ đơn đã TT đủ / đã giao (vé đã thuộc về khách)
  const orders = await db.orders.toArray();
  const customers = await db.customers.toArray();
  const cmap = {}; customers.forEach(c => cmap[c.id] = c);
  const eligible = orders.filter(o => o.status === 'đã thanh toán đủ' || o.status === 'đã giao vé');
  const select = document.getElementById('resale-order');
  select.innerHTML = '<option value="">— Khách ngoài / nhập tay —</option>' +
    eligible.map(o => {
      const c = cmap[o.customer_id];
      return `<option value="${o.id}">${esc(o.order_code)} · ${c ? esc(c.name) : '?'} · ${esc(o.ticket_tier)} ×${o.quantity} (${showDayLabel(o.show_day)})</option>`;
    }).join('');

  await populateTierSelect('resale-tier');
  modal.classList.add('active');
}

function closeResaleModal() {
  document.getElementById('resale-modal').classList.remove('active');
}

// Chọn đơn gốc -> autofill toàn bộ
async function resaleOrderPicked() {
  const orderId = parseInt(document.getElementById('resale-order').value);
  if (!orderId) return;
  const order = await db.orders.get(orderId);
  if (!order) return;
  const customer = await db.customers.get(order.customer_id);
  document.getElementById('resale-name').value = customer ? customer.name : '';
  document.getElementById('resale-phone').value = customer ? customer.phone : '';
  document.getElementById('resale-day').value = order.show_day;
  await populateTierSelect('resale-tier');
  document.getElementById('resale-tier').value = order.ticket_tier;
  document.getElementById('resale-qty').value = order.quantity;
  document.getElementById('resale-original-price').value = order.unit_price ? new Intl.NumberFormat('vi-VN').format(order.unit_price * order.quantity) : '';
  document.getElementById('resale-seat').value = order.seat_number || '';
  calcResaleRefund();
}

function calcResaleRefund() {
  const asking = parseVND(document.getElementById('resale-asking').value);
  const fee = parseVND(document.getElementById('resale-fee').value);
  const preview = document.getElementById('resale-refund-preview');
  const seatNum = document.getElementById('resale-seat').value.trim();
  if (asking > 0) {
    preview.innerHTML = `Khách nhận lại khi pass thành công: <strong style="color:var(--status-paid)">${formatVND(asking - fee)}</strong>`;
  } else {
    preview.textContent = '';
  }
}

async function saveResale(e) {
  e.preventDefault();
  const orderId = parseInt(document.getElementById('resale-order').value) || null;
  const name = document.getElementById('resale-name').value.trim();
  const phone = document.getElementById('resale-phone').value.replace(/[\s\-\.]/g, '');
  const day = document.getElementById('resale-day').value;
  const tier = document.getElementById('resale-tier').value;
  const qty = parseInt(document.getElementById('resale-qty').value) || 1;
  const originalPrice = parseVND(document.getElementById('resale-original-price').value);
  const asking = parseVND(document.getElementById('resale-asking').value);
  const fee = parseVND(document.getElementById('resale-fee').value);
  const reason = document.getElementById('resale-reason').value;
  const seatNumber = document.getElementById('resale-seat').value.trim();
  const note = document.getElementById('resale-note').value.trim();
  const editId = document.getElementById('edit-resale-id').value;

  if (!name) { showToast('Vui lòng nhập tên khách', 'error'); return; }
  if (!day) { showToast('Vui lòng chọn ngày diễn', 'error'); return; }
  if (!tier) { showToast('Vui lòng chọn hạng vé', 'error'); return; }
  if (asking <= 0) { showToast('Vui lòng nhập giá rao pass', 'error'); return; }
  if (fee > asking) { showToast('Phí dịch vụ lớn hơn giá rao!', 'error'); return; }

  let orderCode = '';
  if (orderId) {
    const o = await db.orders.get(orderId);
    if (o) orderCode = o.order_code;
  }

  const now = new Date().toISOString();
  if (editId) {
    await db.resales.update(parseInt(editId), {
      order_id: orderId, order_code: orderCode, customer_name: name, customer_phone: phone,
      show_day: day, ticket_tier: tier, quantity: qty,
      original_price: originalPrice, asking_price: asking, service_fee: fee,
      seat_number: seatNumber, reason, note, updated_at: now
    });
    showToast('Đã cập nhật ký gửi!', 'success');
  } else {
    await db.resales.add({
      order_id: orderId, order_code: orderCode, customer_name: name, customer_phone: phone,
      show_day: day, ticket_tier: tier, quantity: qty,
      original_price: originalPrice, asking_price: asking, service_fee: fee,
      seat_number: seatNumber, reason, note, status: 'chờ rao', created_at: now, updated_at: now
    });
    showToast('Đã nhận ký gửi vé!', 'success');
  }
  closeResaleModal();
  await refreshResales();
}

async function openResaleDetail(id) {
  const r = await db.resales.get(id);
  if (!r) return;
  const refund = (r.asking_price || 0) - (r.service_fee || 0);
  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-modal-title').textContent = '🔁 Ký gửi ' + (r.order_code || 'KG-' + String(r.id).padStart(3, '0'));

  document.getElementById('detail-modal-body').innerHTML = `
    <div style="margin-bottom:var(--space-md)">
      <span class="resale-status" data-rstatus="${esc(r.status)}" style="font-size:0.8rem">${esc(r.status).toUpperCase()}</span>
    </div>
    <div class="card" style="margin-bottom:var(--space-md)">
      <div class="card-header"><span class="card-title">👤 Khách ký gửi</span>${quickContactHTML(r.customer_phone)}</div>
      <div class="order-info">
        <strong>${esc(r.customer_name)}</strong><br>
        📱 ${esc(r.customer_phone) || 'N/A'}<br>
        📝 Lý do: ${esc(r.reason)}
        ${r.note ? '<br>💬 ' + esc(r.note) : ''}
      </div>
    </div>
    <div class="card" style="margin-bottom:var(--space-md)">
      <div class="card-header"><span class="card-title">🎫 Vé & tiền</span></div>
      <div class="order-info">
        🗓️ ${showDayLabel(r.show_day)}<br>
        🎫 ${esc(r.ticket_tier)} × ${r.quantity}<br>
        ${r.seat_number ? '💺 Ghế: <strong>' + esc(r.seat_number) + '</strong><br>' : ''}
        ${r.original_price ? '🧾 Giá khách mua gốc: ' + formatVND(r.original_price) + '<br>' : ''}
        💰 Giá rao pass: <strong>${formatVND(r.asking_price)}</strong><br>
        💵 Phí dịch vụ: ${formatVND(r.service_fee)}<br>
        <strong style="color:var(--status-paid)">🤝 Hoàn khách khi pass: ${formatVND(refund)}</strong>
      </div>
    </div>
    <div class="text-muted" style="font-size:0.72rem">Nhận ký gửi: ${formatDate(r.created_at)}</div>
  `;

  const statusButtons = RESALE_STATUSES.filter(s => s !== r.status).map(s => {
    let cls = 'btn-secondary';
    if (s === 'đã pass') cls = 'btn-primary';
    if (s === 'hủy ký gửi') cls = 'btn-danger';
    return `<button class="btn btn-sm ${cls}" onclick="changeResaleStatus(${r.id}, '${s}')" style="font-size:0.7rem">${s}</button>`;
  }).join('');

  document.getElementById('detail-modal-actions').innerHTML = `
    <button class="btn btn-secondary" onclick="closeDetailModal()">Đóng</button>
    <button class="btn btn-secondary" onclick="closeDetailModal();editResale(${r.id})">✏️ Sửa</button>
    ${r.status === 'đã pass' ? `<button class="btn btn-gold" onclick="createOrderFromResale(${r.id})">➕ Tạo đơn khách mua</button>` : ''}
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;width:100%">
      <span style="font-size:0.7rem;color:var(--text-muted);width:100%;margin-bottom:4px">Đổi trạng thái:</span>
      ${statusButtons}
    </div>
  `;
  modal.classList.add('active');
}

async function changeResaleStatus(id, newStatus) {
  await db.resales.update(id, { status: newStatus, updated_at: new Date().toISOString() });
  showToast(`Ký gửi → ${newStatus}`, 'success');
  closeDetailModal();
  await refreshResales();

  if (newStatus === 'đã pass') {
    const r = await db.resales.get(id);
    const refund = (r.asking_price || 0) - (r.service_fee || 0);

    // CHỐNG TỒN KHO ẢO: vé pass đi rồi thì đơn gốc phải đóng lại,
    // nếu không cùng 1 vé sẽ bị đếm bán 2 lần (đơn cũ + đơn người mua mới)
    if (r.order_id) {
      const origin = await db.orders.get(r.order_id);
      if (origin && ACTIVE_STATUSES.includes(origin.status)) {
        if ((origin.quantity || 0) === (r.quantity || 0)) {
          // Pass toàn bộ vé của đơn -> tự đóng đơn gốc, ghi chú rõ lý do
          await db.orders.update(origin.id, {
            status: 'hủy',
            note: ((origin.note || '') + ` [Vé đã pass lại qua ký gửi ${r.order_code || 'KG-' + String(r.id).padStart(3, '0')} — hoàn khách ${formatVND(refund)} từ tiền người mua mới]`).trim(),
            updated_at: new Date().toISOString()
          });
          await refreshAll();
          showToast(`Đã tự đóng đơn gốc ${origin.order_code} để trả tồn kho (tránh đếm trùng vé)`, 'info');
        } else {
          // Pass một phần -> không tự sửa, nhắc chỉnh tay số lượng
          showToast(`⚠️ Khách pass ${r.quantity}/${origin.quantity} vé — vào đơn ${origin.order_code} giảm số lượng thủ công để tồn kho đúng!`, 'warning');
        }
      }
    }

    showConfirm(`✅ Pass thành công! Hoàn khách ${r.customer_name}: ${formatVND(refund)}.\nTạo đơn cho người mua mới luôn?`, () => createOrderFromResale(id));
  }
}

async function editResale(id) {
  const r = await db.resales.get(id);
  if (!r) return;
  await openResaleModal();
  document.getElementById('edit-resale-id').value = id;
  document.getElementById('resale-order').value = r.order_id || '';
  document.getElementById('resale-name').value = r.customer_name || '';
  document.getElementById('resale-phone').value = r.customer_phone || '';
  document.getElementById('resale-day').value = r.show_day;
  document.getElementById('resale-tier').value = r.ticket_tier;
  document.getElementById('resale-qty').value = r.quantity;
  document.getElementById('resale-original-price').value = r.original_price ? new Intl.NumberFormat('vi-VN').format(r.original_price) : '';
  document.getElementById('resale-asking').value = r.asking_price ? new Intl.NumberFormat('vi-VN').format(r.asking_price) : '';
  document.getElementById('resale-fee').value = r.service_fee ? new Intl.NumberFormat('vi-VN').format(r.service_fee) : '';
  document.getElementById('resale-reason').value = r.reason || 'không đi được';
  document.getElementById('resale-seat').value = r.seat_number || '';
  document.getElementById('resale-note').value = r.note || '';
  calcResaleRefund();
}

// Pass xong -> mở form đơn mới điền sẵn thông tin vé cho người mua
async function createOrderFromResale(id) {
  const r = await db.resales.get(id);
  if (!r) return;
  closeDetailModal();
  closeConfirm();
  openOrderModal();
  // Điền sẵn sau khi modal mở
  setTimeout(async () => {
    document.getElementById('order-day').value = r.show_day;
    await populateTierSelect('order-tier');
    document.getElementById('order-tier').value = r.ticket_tier;
    document.getElementById('order-qty').value = r.quantity;
    const unit = Math.round((r.asking_price || 0) / (r.quantity || 1));
    document.getElementById('order-price').value = new Intl.NumberFormat('vi-VN').format(unit);
    calcTotal();
    document.getElementById('order-seat').value = r.seat_number || '';
    document.getElementById('order-note').value = `Vé pass lại từ ký gửi ${r.order_code || 'KG-' + String(r.id).padStart(3, '0')} (khách gốc: ${r.customer_name})`;
    showToast('Đã điền sẵn thông tin vé pass — nhập SĐT người mua mới', 'info');
  }, 100);
}

// ===== TOAST =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${esc(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===== CONFIRM DIALOG =====
function showConfirm(message, callback) {
  confirmCallback = callback;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-dialog').classList.add('active');
}

function closeConfirm() {
  document.getElementById('confirm-dialog').classList.remove('active');
  confirmCallback = null;
}

function confirmOk() {
  if (confirmCallback) confirmCallback();
  closeConfirm();
}

// ===== FORM DIRTY CHECK: tránh mất dữ liệu đang nhập dở =====
function orderFormDirty() {
  const phone = document.getElementById('order-phone')?.value.trim();
  const name = document.getElementById('order-name')?.value.trim();
  return !!(phone || name);
}

function tryCloseOrderModal() {
  if (orderFormDirty()) {
    showConfirm('Đơn đang nhập dở sẽ bị mất. Đóng form?', () => {
      document.getElementById('order-modal').classList.remove('active');
    });
  } else {
    document.getElementById('order-modal').classList.remove('active');
  }
}

// ===== CLOSE MODALS ON OVERLAY CLICK =====
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
    if (e.target.id === 'order-modal') {
      tryCloseOrderModal();
    } else {
      e.target.classList.remove('active');
    }
  }
});

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const orderModal = document.getElementById('order-modal');
    if (orderModal.classList.contains('active')) {
      tryCloseOrderModal();
      return;
    }
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    closeConfirm();
  }
});
