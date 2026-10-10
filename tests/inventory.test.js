// Test tồn kho theo "vé đã có trong tay" (10/10/2026, yêu cầu anh Quân):
//   "nhập vé nào vào, anh có sẵn thì mới tính tồn kho" -> đơn chỉ mới cọc, chưa có vé/ghế KHÔNG được trừ tồn.
// Quy ước: đơn "đã có vé" = còn hiệu lực + (đã giao vé HOẶC đã ghi ghế). Đơn còn lại (đã cọc/đã thanh toán đủ mà chưa ghế) = "chờ vé".
// Không gọi mạng, không đụng DB; trích đúng code nguồn từ app.js (không chép lại).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Test tồn kho theo vé đã có (không trừ tồn cho đơn chờ vé)...');
const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

const grab = (re, what) => {
  const m = appCode.match(re);
  if (!m) { console.error('❌ ĐỎ: thiếu ' + what + ' trong app.js'); process.exit(1); }
  return m[0];
};
const src = [
  grab(/const ACTIVE_STATUSES = \[[^\]]*\];/, 'ACTIVE_STATUSES'),
  grab(/function soldFromOrders\([\s\S]*?\n\}/, 'soldFromOrders'),
  grab(/function orderHasTicket\([\s\S]*?\n\}/, 'orderHasTicket'),
  grab(/function stockCounts\([\s\S]*?\n\}/, 'stockCounts'),
  grab(/function stockStatus\([\s\S]*?\n\}/, 'stockStatus'),
  grab(/function ticketFitWarning\([\s\S]*?\n\}/, 'ticketFitWarning'),
  grab(/function inventoryTiers\([\s\S]*?\n\}/, 'inventoryTiers'),
].join('\n');
const F = new Function(src + '; return { soldFromOrders, orderHasTicket, stockCounts, stockStatus, ticketFitWarning, inventoryTiers };')();

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✅ ' + name + ' PASS'); };
const O = (o) => Object.assign({ show_day: 'day1', ticket_tier: 'Gold VIP', quantity: 2, status: 'đã cọc', seat_number: '', deleted_at: null }, o);

// ── orderHasTicket / stockCounts ──
t('1. đã cọc, CHƯA ghế -> chờ vé (held 0, waiting 2)', () => {
  const c = F.stockCounts([O({})], 'day1', 'Gold VIP');
  assert.deepStrictEqual([c.held, c.waiting], [0, 2]);
});
t('2. đã cọc + ĐÃ ghi ghế -> đã có vé (held 2, waiting 0)', () => {
  const c = F.stockCounts([O({ seat_number: 'Hàng F ghế 12-13' })], 'day1', 'Gold VIP');
  assert.deepStrictEqual([c.held, c.waiting], [2, 0]);
});
t('3. "đã giao vé" dù không ghi ghế -> vẫn là đã có vé', () => {
  const c = F.stockCounts([O({ status: 'đã giao vé' })], 'day1', 'Gold VIP');
  assert.deepStrictEqual([c.held, c.waiting], [2, 0]);
});
t('4. mới / hủy / hoàn cọc / đã xoá mềm -> không tính vào đâu cả (kể cả khi có ghế)', () => {
  const os = ['mới', 'hủy', 'hoàn cọc'].map(s => O({ status: s, seat_number: 'A1' })).concat([O({ deleted_at: '2026-10-01', seat_number: 'A1' })]);
  const c = F.stockCounts(os, 'day1', 'Gold VIP');
  assert.deepStrictEqual([c.held, c.waiting], [0, 0]);
});
t('5. ghế chỉ toàn khoảng trắng / null / undefined -> KHÔNG phải đã có vé', () => {
  for (const s of ['   ', '\t', null, undefined]) {
    const c = F.stockCounts([O({ seat_number: s })], 'day1', 'Gold VIP');
    assert.deepStrictEqual([c.held, c.waiting], [0, 2], 'seat=' + JSON.stringify(s));
  }
});
t('6. "both" tính cho CẢ 2 ngày; "flex" không thuộc ngày nào; hạng khác không lẫn', () => {
  const os = [O({ show_day: 'both', seat_number: 'X' }), O({ show_day: 'flex', seat_number: 'Y' }), O({ ticket_tier: 'CAT 1', seat_number: 'Z' })];
  assert.strictEqual(F.stockCounts(os, 'day1', 'Gold VIP').held, 2);
  assert.strictEqual(F.stockCounts(os, 'day2', 'Gold VIP').held, 2);
  assert.strictEqual(F.stockCounts(os, 'day1', 'CAT 1').held, 2);
});
t('7. NHẤT QUÁN 2 CHIỀU: held + waiting luôn = soldFromOrders cũ (mọi tổ hợp trạng thái × ghế × ngày)', () => {
  const statuses = ['mới', 'đã cọc', 'đã thanh toán đủ', 'đã giao vé', 'hoàn cọc', 'hủy'];
  const seats = ['', 'A1'];
  const days = ['day1', 'day2', 'both', 'flex'];
  const os = [];
  let q = 1;
  for (const s of statuses) for (const st of seats) for (const d of days) for (const del of [null, '2026-01-01'])
    os.push(O({ status: s, seat_number: st, show_day: d, deleted_at: del, quantity: q++ % 4 + 1 }));
  for (const day of ['day1', 'day2']) {
    const c = F.stockCounts(os, day, 'Gold VIP');
    assert.strictEqual(c.held + c.waiting, F.soldFromOrders(os, day, 'Gold VIP'), 'lệch ở ' + day);
    assert.strictEqual(c.sold, c.held + c.waiting);
  }
});

// ── stockStatus (logic hiện trên màn hình Tồn kho) ──
t('8. tổng = 0/trống -> ∞: không cảnh báo, không "còn lại" (giữ nguyên hành vi cũ)', () => {
  for (const total of [0, undefined, null, -1]) {
    const s = F.stockStatus(total, 5, 3);
    assert.strictEqual(s.unlimited, true);
    assert.strictEqual(s.over, 0);
    assert.strictEqual(s.need, 0);
  }
});
t('9. nhập 5 vé, đã có 3, chờ 4 -> còn 2, cần mua thêm 2, không vượt', () => {
  const s = F.stockStatus(5, 3, 4);
  assert.deepStrictEqual([s.unlimited, s.remaining, s.need, s.over], [false, 2, 2, 0]);
});
t('10. nhập 5 vé nhưng đã ghi ghế 7 -> vượt 2 (ghi ghế quá số vé đã nhập), còn -2, cần thêm 0 cho chờ=0', () => {
  const s = F.stockStatus(5, 7, 0);
  assert.deepStrictEqual([s.remaining, s.over, s.need], [-2, 2, 0]);
});
t('11. ĐƠN CHỜ VÉ KHÔNG LÀM "HẾT VÉ": nhập 5 vé, 0 đã có, 9 chờ -> còn 5 (không âm), cần mua thêm 4', () => {
  const s = F.stockStatus(5, 0, 9);
  assert.deepStrictEqual([s.remaining, s.need, s.over], [5, 4, 0]);
});

// ── ticketFitWarning (cảnh báo khi nhập/sửa đơn) ──
t('12. đơn đang nhập CHƯA ghế và chưa giao -> không cảnh báo tồn (chưa có vé thì chưa trừ)', () => {
  assert.strictEqual(F.ticketFitWarning({ total: 5, heldOthers: 5, qty: 3, willHoldTicket: false }).level, 'none');
});
t('13. tổng = 0 (∞) -> không cảnh báo', () => {
  assert.strictEqual(F.ticketFitWarning({ total: 0, heldOthers: 9, qty: 3, willHoldTicket: true }).level, 'none');
});
t('14. có ghế, hết vé -> "out"; vượt -> "exceed" (số vượt); còn ≤3 -> "low"; còn nhiều -> "none"', () => {
  assert.strictEqual(F.ticketFitWarning({ total: 5, heldOthers: 5, qty: 1, willHoldTicket: true }).level, 'out');
  const e = F.ticketFitWarning({ total: 5, heldOthers: 3, qty: 4, willHoldTicket: true });
  assert.deepStrictEqual([e.level, e.remaining, e.over], ['exceed', 2, 2]);
  assert.strictEqual(F.ticketFitWarning({ total: 6, heldOthers: 3, qty: 2, willHoldTicket: true }).level, 'low');
  assert.strictEqual(F.ticketFitWarning({ total: 20, heldOthers: 3, qty: 2, willHoldTicket: true }).level, 'none');
});

// ── inventoryTiers: hạng cũ vẫn hiện trên Tồn kho ──
t('15. hạng CŨ có đơn đang hiệu lực được thêm SAU 10 hạng mới, không trùng; đơn hủy/xoá không kéo hạng vào', () => {
  const tiers = ['Gold VIP', 'CAT 1'];
  const os = [O({ ticket_tier: 'CAT1' }), O({ ticket_tier: 'CAT1' }), O({ ticket_tier: 'VIP Soundcheck' }),
    O({ ticket_tier: 'Ma', status: 'hủy' }), O({ ticket_tier: 'Ma2', deleted_at: '2026-01-01' }), O({ ticket_tier: 'Gold VIP' })];
  assert.deepStrictEqual(F.inventoryTiers(os, tiers), ['Gold VIP', 'CAT 1', 'CAT1', 'VIP Soundcheck']);
  assert.deepStrictEqual(tiers, ['Gold VIP', 'CAT 1'], 'không được sửa mảng đầu vào');
});

// ── Khoá lỗi gốc: 3 chỗ dùng đếm phải đi qua hàm mới, không quay về đếm cũ ──
const body = (name) => { const m = appCode.match(new RegExp('(?:async )?function ' + name + '\\([\\s\\S]*?\\n\\}')); if (!m) { console.error('❌ thiếu hàm ' + name); process.exit(1); } return m[0]; };
t('16. checkInventory dùng orderHasTicket/stockCounts/ticketFitWarning, không còn countSold', () => {
  const b = body('checkInventory');
  assert.ok(/ticketFitWarning\(/.test(b) && /stockCounts\(/.test(b) && /orderHasTicket\(/.test(b), 'checkInventory chưa dùng hàm mới');
  assert.ok(!/countSold\(/.test(b), 'checkInventory vẫn đếm bằng countSold cũ');
});
t('17. refreshInventory dùng stockCounts + stockStatus + inventoryTiers (hạng cũ lên màn Tồn kho)', () => {
  const b = body('refreshInventory');
  assert.ok(/stockCounts\(/.test(b) && /stockStatus\(/.test(b) && /inventoryTiers\(/.test(b));
});
t('18. openInventoryModal liệt kê cả hạng cũ (inventoryTiers) để nhập được số vé cho chúng', () => {
  assert.ok(/inventoryTiers\(/.test(body('openInventoryModal')));
});
t('19. xuất Excel: sheet Tồn kho dùng stockCounts (có cột "Chờ vé")', () => {
  assert.ok(/stockCounts\(/.test(appCode.slice(appCode.indexOf('Tạo sheet Tồn kho'), appCode.indexOf('Tạo sheet Tổng hợp'))));
  assert.ok(/Chờ vé/.test(appCode.slice(appCode.indexOf('Tạo sheet Tồn kho'), appCode.indexOf('Tạo sheet Tổng hợp'))));
});

console.log(`\n🎉 ${pass}/19 PASS`);
