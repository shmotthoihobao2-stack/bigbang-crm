const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("🧪 Test nâng cấp hạng vé (5 hạng cũ -> 10 hạng) + bắt buộc đẩy lên cloud...");

const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// --- Trích đúng code nguồn trong app.js (không chép lại) ---
const tiersMatch = appCode.match(/const DEFAULT_TIERS = \[[^\]]*\];/);
const fnMatch = appCode.match(/function nextTicketTiersValue\([\s\S]*?\n\}/);
if (!tiersMatch || !fnMatch) {
  console.error("❌ ĐỎ: thiếu DEFAULT_TIERS hoặc hàm nextTicketTiersValue trong app.js");
  process.exit(1);
}
const { DEFAULT_TIERS, nextTicketTiersValue } = new Function(
  tiersMatch[0] + fnMatch[0] + '; return { DEFAULT_TIERS, nextTicketTiersValue };'
)();

const OLD = '["VIP Soundcheck","VIP","CAT1","CAT2","CAT3"]';
const NEW = JSON.stringify(DEFAULT_TIERS);
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✅ " + name + " PASS"); };

// Chiều 1: PHẢI nâng cấp
t("1. Đúng 5 hạng cũ mặc định -> nâng lên 10 hạng", () => assert.strictEqual(nextTicketTiersValue(OLD), NEW));
// Chiều 2: KHÔNG được đụng bản người dùng tự chỉnh
t("2. Hạng vé do user tự chỉnh -> giữ nguyên (null)", () => assert.strictEqual(nextTicketTiersValue('["A","B"]'), null));
t("3. Đã là 10 hạng mới -> không làm gì (null)", () => assert.strictEqual(nextTicketTiersValue(NEW), null));
t("4. Chưa có giá trị (null/undefined/rỗng) -> null", () => {
  assert.strictEqual(nextTicketTiersValue(null), null);
  assert.strictEqual(nextTicketTiersValue(undefined), null);
  assert.strictEqual(nextTicketTiersValue(''), null);
});
t("5. 10 hạng mới có đủ 10 phần tử, không trùng", () => {
  assert.strictEqual(DEFAULT_TIERS.length, 10);
  assert.strictEqual(new Set(DEFAULT_TIERS).size, 10);
});

// Chiều 3 (gốc lỗi 09/10/2026): nâng cấp xong PHẢI tự ghi hàng chờ đẩy cloud.
// Trước đây chỉ db.settings.put -> hook bị bỏ qua lúc khởi động (đang pull) -> cloud giữ 5 hạng
// từ 13/06 và kéo ngược về ghi đè. Test này khoá lại để không ai gỡ mất dòng enqueue.
t("6. Nhánh nâng cấp có gọi enqueue('app_settings', ..., ticketTiers)", () => {
  const i = appCode.indexOf('nextTicketTiersValue(tiers.value)');
  assert.ok(i > 0, "không thấy nhánh nâng cấp trong DOMContentLoaded");
  const block = appCode.slice(i, i + 700);
  assert.ok(/enqueue\(\s*'app_settings'\s*,\s*'upsert'\s*,\s*\{\s*key:\s*'ticketTiers'/.test(block),
    "nhánh nâng cấp KHÔNG ghi hàng chờ đẩy cloud");
});

console.log(`\n🎉 Hoàn thành: ${pass}/6 kịch bản hạng vé PASS 100%!`);
