const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("🧪 Bắt đầu chạy bộ test kiểm tra 3 hàm tiền (orderRevenue, orderReceived, orderRemaining)...");

const appPath = path.join(__dirname, '../app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

// Trích xuất 3 hàm tính tiền dùng chung từ app.js để test đúng code nguồn
const fnMatch = appCode.match(/function orderRevenue[\s\S]*?function orderRemaining\(o\) \{[\s\S]*?\n\}/);
if (!fnMatch) {
  console.error("❌ LỖI: Không tìm thấy định nghĩa 3 hàm tiền trong app.js!");
  process.exit(1);
}

const { orderRevenue, orderReceived, orderRemaining } = new Function(
  fnMatch[0] + '; return { orderRevenue, orderReceived, orderRemaining };'
)();

const scenarios = [
  {
    name: "1. Đơn bình thường 'đã cọc'",
    order: { total: 10000000, deposit_amount: 3000000, status: 'đã cọc' },
    expected: { revenue: 10000000, received: 3000000, remaining: 7000000 }
  },
  {
    name: "2. Đơn bình thường 'đã thanh toán đủ'",
    order: { total: 10000000, deposit_amount: 10000000, status: 'đã thanh toán đủ' },
    expected: { revenue: 10000000, received: 10000000, remaining: 0 }
  },
  {
    name: "3. Đơn bình thường 'đã giao vé'",
    order: { total: 10000000, deposit_amount: 10000000, status: 'đã giao vé' },
    expected: { revenue: 10000000, received: 10000000, remaining: 0 }
  },
  {
    name: "4. Đơn giữ chỗ chưa chốt giá (total=0, cọc 2tr)",
    order: { total: 0, deposit_amount: 2000000, status: 'đã cọc' },
    expected: { revenue: 2000000, received: 2000000, remaining: 0 }
  },
  {
    name: "5. Đơn giữ chỗ khi đổi sang 'đã giao vé' (total=0, cọc không được mất)",
    order: { total: 0, deposit_amount: 2000000, status: 'đã giao vé' },
    expected: { revenue: 2000000, received: 2000000, remaining: 0 }
  },
  {
    name: "6. Đơn mới tinh chưa có cọc",
    order: { total: 5000000, deposit_amount: 0, status: 'mới' },
    expected: { revenue: 5000000, received: 0, remaining: 5000000 }
  },
  {
    name: "7. Đơn cọc vượt tổng (deposit > total)",
    order: { total: 8000000, deposit_amount: 10000000, status: 'đã cọc' },
    expected: { revenue: 8000000, received: 10000000, remaining: 0 }
  },
  {
    name: "8. Đơn dữ liệu rỗng / null",
    order: { total: null, deposit_amount: null, status: 'mới' },
    expected: { revenue: 0, received: 0, remaining: 0 }
  }
];

let passed = 0;
for (const sc of scenarios) {
  const rev = orderRevenue(sc.order);
  const rec = orderReceived(sc.order);
  const rem = orderRemaining(sc.order);

  assert.strictEqual(rev, sc.expected.revenue, `${sc.name}: revenue sai (thực tế ${rev}, kỳ vọng ${sc.expected.revenue})`);
  assert.strictEqual(rec, sc.expected.received, `${sc.name}: received sai (thực tế ${rec}, kỳ vọng ${sc.expected.received})`);
  assert.strictEqual(rem, sc.expected.remaining, `${sc.name}: remaining sai (thực tế ${rem}, kỳ vọng ${sc.expected.remaining})`);
  
  console.log(`  ✅ ${sc.name} PASS`);
  passed++;
}

console.log(`\n🎉 Hoàn thành: ${passed}/${scenarios.length} kịch bản kiểm thử tính tiền PASS 100%!\n`);
