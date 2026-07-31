# 🤖 BÀN GIAO DỰ ÁN — BigBang CRM
> Cập nhật lần cuối: 31/07/2026 ICT (Round 9)
> Tài liệu này dành cho AGENT MỚI tiếp nhận dự án. Đọc KỸ trước khi làm bất kỳ gì.

---

## 1. DỰ ÁN LÀ GÌ?

**BigBang CRM** là web app CRM quản lý bán vé Concert BigBang 2026 (24-25/10/2026, SVĐ Mỹ Đình, Hà Nội). Chủ shop tên "Quân" dùng app này trên cả điện thoại lẫn máy tính để:
- Nhập đơn hàng (vé concert)
- Theo dõi thanh toán (cọc → thanh toán đủ → giao vé)
- Đồng bộ dữ liệu giữa nhiều thiết bị qua Supabase
- Gửi email xác nhận cho khách

## 2. TRẠNG THÁI HIỆN TẠI

| Hạng mục | Chi tiết |
|---|---|
| **Điểm đánh giá** | 6/10 audit code-level R9 (31/07) — P0+P1 đã vá + `node --check` sạch + test thuần cho 3 hàm tiền, nhưng **CHƯA verify LIVE trên điện thoại/2 máy/Supabase Dashboard thật** (agent không có trình duyệt). Đừng nâng điểm cho tới khi chạy hết mục VERIFY trong `~/.claude/plans/giggly-riding-dusk.md`. |
| **Số tính năng** | 16 (hoàn chỉnh) |
| **URL Production** | https://shmotthoihobao2-stack.github.io/bigbang-crm/ |
| **Repo** | https://github.com/shmotthoihobao2-stack/bigbang-crm (Public) |
| **Hosting** | GitHub Pages (CI/CD qua GitHub Actions) |
| **Mật khẩu test** | `bigbang2026` |
| **DB version** | Dexie v5 |

## 3. KIẾN TRÚC KỸ THUẬT

```
Kiến trúc: Static SPA (không có build step)
────────────────────────────────────────────
index.html  ← SPA layout (6 tabs + modals)
app.js      ← Logic CRUD, UI (~2690 dòng)
sync.js     ← Đồng bộ Supabase (~780 dòng)
style.css   ← UI dark theme (~1765 dòng)
tracuu.html ← Trang tra cứu đơn công khai
```

### Tech Stack
| Thành phần | Công nghệ |
|---|---|
| Frontend | Vanilla HTML/CSS/JS |
| Local DB | Dexie.js (IndexedDB) v5 |
| Cloud DB | Supabase (PostgreSQL + Auth + Realtime) |
| Cloud Storage | Supabase Storage (`payment_proofs` bucket) |
| Charts | Chart.js v4.4.0 |
| Email | EmailJS (free 200/tháng) |
| Hosting | GitHub Pages + GitHub Actions |

### Luồng đồng bộ
```
User thao tác → Dexie Hook → Outbox Queue → debounce 1.5s → Supabase upsert
Auto-sync 30s → pullAll() → So sánh updated_at → Cập nhật local
Realtime → Supabase postgres_changes → pullAll() → Toast notification
```

## 4. CREDENTIALS & SECRETS

### Supabase (HARDCODE trong sync.js)
- **URL:** `https://satcrqkyxrrioctncokv.supabase.co`
- **Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (đầy đủ trong sync.js dòng 20-21)
- **Auth Email/Password:** User tự nhập trong Cài đặt (lưu trong IndexedDB settings table)

### EmailJS
- **Service ID:** `service_c2q6n7f`
- **Template ID:** `template_thvt726`
- **Public Key:** `lhJZwyjgcDzYQM7uc`
- **Email gửi:** `vebigbang2026@gmail.com`

### Lưu ý bảo mật
- **R9 (31/07/2026): RLS đổi từ `to authenticated using(true)` sang `using(is_owner())`.** Trước đây
  BẤT KỲ ai tự `POST /auth/v1/signup` (đăng ký công khai — xác nhận LIVE `disable_signup:false`
  qua `GET /auth/v1/settings`) là có toàn quyền SELECT/UPDATE/DELETE cả 5 bảng, vì anon key public.
  Giờ có bảng `app_owner` (0 policy — không ai SELECT/INSERT trực tiếp được) + hàm `is_owner()`/
  `claim_owner()` (security definer): tài khoản authenticated ĐẦU TIÊN gọi `claim_owner()` sau khi
  chạy `supabase-setup.sql` được khoá làm chủ vĩnh viễn, mọi policy chỉ đúng người đó mới `true`.
  `sync.js` tự gọi `claim_owner()` mỗi lần đăng nhập cloud thành công (no-op nếu đã có chủ).
  **BẮT BUỘC làm thêm ở Supabase Dashboard (agent không có quyền làm hộ):** (1) Authentication →
  Users xác nhận chỉ có đúng email chủ shop; (2) Authentication → tắt "Allow new users to sign up";
  (3) chạy lại `supabase-setup.sql` trong SQL Editor; (4) mở app, đăng xuất/đăng nhập cloud 1 lần.

### ⚠️ 3 BÀI HỌC TRIỂN KHAI (R9 — trả giá bằng 3 lần vá lại, ĐỌC TRƯỚC KHI ĐỤNG QUYỀN/SCHEMA)
1. **`revoke ... from public` KHÔNG chặn được `anon`/`authenticated` trên Supabase.** Project cấp
   EXECUTE trực tiếp cho 2 role đó (ALTER DEFAULT PRIVILEGES tầng project), không đi qua PUBLIC.
   Bằng chứng: sau khi revoke-from-public, gọi `next_order_code()` bằng anon key vẫn trả `BB-0022`.
   → Phải `revoke all ... from public, anon, authenticated;` rồi mới `grant` lại đúng role cần.
2. **Deploy CODE trước, SQL sau** (hoặc chuẩn bị đường lùi trước khi đổi quyền). R9 làm ngược: đổi
   RLS sang `is_owner()` trong khi `sync.js` gọi `claim_owner()` chưa push → `app_owner` rỗng →
   `is_owner()` false cho MỌI người → chính chủ bị khoá khỏi cloud. Có sẵn `ROLLBACK_RLS.sql` để gỡ.
3. **Đụng tới quyền thì đọc `pg_policies` TRƯỚC — không tin file setup.** Bucket ảnh bill có 4 policy
   `Cho phep upload 1jmfb48_0..3` tạo tay qua Dashboard, không hề nằm trong `supabase-setup.sql`.
   Postgres nối policy bằng **HOẶC** → thêm 1 policy chặt không có tác dụng nếu còn policy lỏng.
   → Luôn `select * from pg_policies where tablename='<bảng>'` để thấy toàn cảnh trước khi thêm.
4. **Chấm sync đỏ sau sự cố quyền = dư âm, không phải lỗi mới.** `updateSyncStatus` kiểm `parked > 0`
   TRƯỚC mọi điều kiện khác (`sync.js`), nên outbox bị park trong lúc mất quyền sẽ giữ chấm đỏ vĩnh
   viễn dù RLS đã đúng. Sửa: Cài đặt → "☁️⬆️ Đồng bộ lại toàn bộ" (`forceSyncAll` gỡ cờ park).
   Triệu chứng ≠ nguyên nhân — suýt chạy rollback gỡ bỏ hàng rào đang hoạt động tốt.

### Review độc lập bằng Gemini Pro (31/07) — 2/3 xử lý, 1/3 bác bỏ có lý do
1. ✅ **Đúng, đã vá**: `pullAll()` không kiểm cờ `reconciling` (bất đối xứng — `reconcile()` có kiểm
   `pulling` để nhường, chiều ngược lại thì không) → 2 luồng có thể ghi/đẩy IndexedDB chồng nhau nếu
   interval 30s/`online`/`visibilitychange` bắn đúng lúc "Đồng bộ lại toàn bộ" đang chạy. Vá:
   `if (_pullBusy || reconciling) return;`. Bug có từ trước R9, không phải do đợt vá này gây ra.
2. ⚠️ **Đúng về nguyên lý, SAI về hiện trạng**: cảnh báo script dọn policy `LIKE '%payment_proofs%'`
   có thể bỏ sót 1 policy "mù" kiểu `using(true)` không nhắc tên bucket. Đã tự verify LIVE bằng
   `select * from pg_policies where tablename='objects'` KHÔNG lọc gì — hiện tại chỉ có đúng 1
   policy (`pp_owner_all`), không có policy mù nào. Vẫn hardening script (dọn sạch toàn bộ trừ
   `pp_owner_all`, xác nhận qua grep dự án chỉ có 1 bucket) để lần chạy lại sau này an toàn hơn.
3. ❌ **Bác bỏ**: đề xuất reset `_lastPullOk = true` khi `processOutbox`/`reconcile` thành công.
   KHÔNG áp dụng — sẽ tái tạo lại đúng lỗi P0 vừa vá (push OK mà pull vẫn hỏng thì bị che thành
   xanh giả). Thiết kế hiện tại đã đúng: `online`/`visibilitychange`/interval 30s tự gọi lại
   `pullAll` nên cờ tự lành trong ~30s nếu pull thật sự thông; nếu không tự lành nghĩa là pull
   đang thật sự có vấn đề — hiện đỏ là ĐÚNG, không phải bug.
- Supabase anon key là PUBLIC KEY, an toàn để commit (Supabase thiết kế như vậy) — **NHƯNG chỉ an
  toàn khi RLS pin đúng 1 chủ như trên**, không phải vì bản thân key vô hại.
- Mật khẩu CRM lưu **dạng hash SHA-256** trong IndexedDB (không phải plaintext)
- Service Worker đã bị VÔ HIỆU HÓA (sw.js chỉ để tương thích cũ)
- **Ảnh chuyển khoản (payment_proofs): bucket PRIVATE** — `payment_proof` lưu PATH (không phải URL), xem qua signed URL tạm 1h (`window.getSignedProofUrl` ở sync.js). Đổi private cần chạy lại `supabase-setup.sql` trên Supabase (đã idempotent: ép `public=false` + drop policy `pp_public_read`).
- **File backup KHÔNG còn chứa secret**: `exportAllData()` loại `password`/`supabaseEmail`/`supabasePassword(Enc)`. Giữ `supabaseUrl`+`supabaseKey` (public). Restore máy mới → tự nối cloud nhưng phải nhập lại email/mật khẩu Supabase + đặt lại mật khẩu app.

## 5. DATABASE SCHEMA

### Dexie v5 (sync.js định nghĩa, KHÔNG định nghĩa lại trong app.js)
```js
// app.js: v1 + v2
// sync.js: v3 (uuid + outbox) + v4 (email) + v5 (bảng history — snapshot chống mất dữ liệu)
db.version(5).stores({
  customers: '++id, uuid, name, phone, email, zalo, social, source, note, created_at',
  orders: '++id, uuid, order_code, customer_id, show_day, ticket_tier, ...',
  inventory: '++id, uuid, show_day, ticket_tier, total_stock, cost_price',
  settings: 'key',
  resales: '++id, uuid, order_id, customer_name, status, created_at',
  outbox: '++id, table_name, created_at',
  history: '++id, table_name, uuid, replaced_at'
});
```

### `show_day` — 4 giá trị (KHÔNG phải 3, dễ nhầm)
- `day1` / `day2`: 1 vé, ngày cụ thể.
- `both`: **2 vé** — 1 vé mỗi ngày (cộng dồn cả tồn kho lẫn giá vốn Day1+Day2).
- `flex` (R6, 2026-07-30): **1 vé, CHƯA chốt ngày** ("ngày nào cũng được, miễn còn vé"). Khác hẳn `both`. Cố tình **KHÔNG trừ tồn kho** ngày nào (`soldFromOrders`/`countSold` không match `flex`) — anh tự sửa đơn sang `day1`/`day2` khi chốt ngày thật. Giá vốn để trống, tự nhập tay (Dashboard cảnh báo nếu quên). Xem danh sách đơn `flex` ở tab Tồn kho → card "🎟️ Khách chưa chốt ngày" (tự ẩn nếu không có đơn nào).
- `show_day` là `text` thuần trong Supabase, **không CHECK/ENUM** — thêm giá trị mới không cần migration SQL.

### Supabase tables (cloud)
- `customers` — bao gồm cột `email text DEFAULT ''`
- `orders` — bao gồm `payment_proof`, `seat_number`, `ticket_source`, `combo_info`
- `inventory`
- `resales`
- `app_settings` — key-value store cho settings đồng bộ
- `app_owner` (R9, 31/07) — bảng singleton `{id: true, uid}`, **0 RLS policy** (kể cả authenticated
  cũng không SELECT/INSERT trực tiếp được, chỉ 2 hàm security definer `claim_owner()`/`is_owner()`
  chạm vào được). Đây là chốt chặn thay cho `using(true)` cũ — xem mục 4.

## 6. CÁC FILE QUAN TRỌNG VÀ CHỨC NĂNG

| File | Dòng | Chức năng chính |
|---|---|---|
| `app.js` | ~2880 | DB setup (v1-v2), STATE, UI rendering, CRUD, Bill generation, Charts, Import/Export, Resales, showConfirm/Toast |
| `sync.js` | ~866 | DB setup (v3-v5), Supabase connect, toCloud(), pullAll(), outbox queue, Realtime subscription, firstSyncUpload() |
| `index.html` | ~949 | HTML structure: login, 6 tabs, modals (order, detail, bill, confirm), CDN scripts |
| `style.css` | ~1765 | Dark theme, responsive, glassmorphism cards, animations |
| `tracuu.html` | ~218 | Trang tra cứu đơn công khai (standalone, dùng Supabase trực tiếp) |

### Quy tắc khi sửa code
1. **Thêm cột DB mới** → Sửa 3 chỗ trong sync.js: `db.version()`, `toCloud()`, `pullAll()`
2. **KHÔNG khai báo db.version() trong app.js từ v3 trở lên** — tất cả nằm trong sync.js
3. **Thêm cột Supabase** → Chạy `ALTER TABLE` trên SQL Editor
4. **Sau khi sửa** → `git add . && git commit && git push` → GitHub Pages tự deploy
5. **KHÔNG cần tự bump `?v=` trong `index.html`** — `.github/workflows/deploy.yml` có bước "Cache-bust assets
   bằng commit SHA" tự `sed` thay `app.js?v=` / `sync.js?v=` / `style.css?v=` bằng 8 ký tự đầu commit hash
   mỗi lần deploy. Token nằm trong repo chỉ là placeholder, không bao giờ ra tới trình duyệt người dùng.
   ⚠️ Đừng lặp lại sai lầm audit R7: chỉ nhìn `git log -- index.html` thấy token đứng yên rồi kết luận
   "cache-bust hỏng" là SAI — phải đọc cả pipeline deploy. Kiểm nhanh bằng:
   `curl -s <URL> | grep -o '?v=[0-9a-z]*'` → phải khớp commit mới nhất.

## 7. LỊCH SỬ PHÁT TRIỂN (TÓM TẮT)

| Ngày | Phase | Nội dung |
|---|---|---|
| 11/06 | Phase 1 | Xây nền: CRUD, Dashboard, Bill, Export, Resale |
| 12/06 | Phase 2 | Cloud Sync Supabase, Charts, Tra cứu |
| 13/06 | Kaizen 2 | Upload ủy nhiệm chi |
| 13/06 | Kaizen 3 | Copy tin nhắn chốt đơn |
| 13/06 | Kaizen 3.5 | Thêm trường email |
| 13/06 | Kaizen 4 | Gửi vé qua email (EmailJS) |
| 13/06 | Hotfix | Fix Dexie schema conflict, hardcode credentials, tách repo, chuyển GitHub Pages |
| 15-17/06 | Round 1 | Tồn kho ∞ (không ôm vé), giá vốn theo từng đơn, nút pass vé nhanh, fix autofill SĐT ký gửi, Script nhắn khách |
| 17/06 | Round 2 | Fix resale thiếu uuid, CSS --bg-elevated, confirm hủy/hoàn cọc, real-time cọc>tổng, countdown auto-refresh, toast max 3, filter reset |
| 17/06 | Round 3 | --accent-gold undefined, CTV doanh thu đếm sai, tồn kho ghế soft-delete, interval logout, giá vốn 2 ngày, toast lỗi bị chặn |
| 17/06 | Round 4 | Bảo mật: bucket payment_proofs PUBLIC→PRIVATE + signed URL; backup redact secret (không còn hash pw/email Supabase) |
| 02/07 | Round 5 | Audit Principal Architect (3 agent + verify chéo). Fix 7 việc — (P0) `lookup_order` guard null-phone+length (chống lộ đơn khách không SĐT); (P1) `refreshInventory` batch-load orders 1 lần thay ~20 query N+1; (P1) validate creds Supabase TRƯỚC khi lưu DB; (P2) realtime auto re-subscribe backoff + generation guard; (P2) toast khi load connect fail; (P3) `.catch()` populateCTVSelect; (P3) hint mật khẩu không nhúng HTML (JS chèn khi còn default). Bác 7 false-positive. **⚠️ Cần chạy lại `supabase-setup.sql` live cho P0.** |
| 30/07 | Round 6 | **Ngày linh động (`show_day='flex'`)**: 1 vé chưa chốt ngày, khác `both` (2 vé). Soát bằng 2 agent + verify tay trước khi code — phát hiện rủi ro mất dữ liệu (4 chỗ `select.value = show_day` fail-silent nếu thiếu `<option>`) và 2 chỗ ternary hardcode gửi sai "Cả 2 ngày" ra email/Zalo cho khách — cả 2 đã fix. **Bảng khách theo hạng vé** trong tab Tồn kho: dòng tóm tắt (đếm theo trạng thái) + modal chi tiết khi bấm, card riêng cho đơn `flex` (tự ẩn nếu rỗng). Không đổi schema, không cần chạy SQL, không bump Dexie version. |
| 30/07 | Round 7 (audit) | **Audit tổng thể 3 agent song song + tự verify tay từng phát hiện nặng.** Vá 2 lỗi P0 THẬT: (1) `pullAll` thiếu `deleted_at:null` ở 4 nhánh merge → nút "Khôi phục" Thùng rác vô hiệu khi dùng 2 máy (đơn tự chui lại thùng rác, xóa cứng sau 30 ngày); (2) import backup âm thầm reset mật khẩu app về mặc định công khai → giữ key `password`/`supabaseEmail`/... qua import. **⚠️ Lỗi P0 thứ 3 báo trong audit ("cache-bust `?v=` đứng yên 6 tuần") là FALSE POSITIVE** — `deploy.yml` đã tự inject commit SHA từ 14/06, live luôn đúng bản mới (verify: `curl -s <URL> | grep -o '?v='` ra `0c93721f` khớp commit). Bài học: verify nửa chừng (chỉ đọc `git log -- index.html`, không đọc pipeline deploy) thì kết luận sai — xem quy tắc #5 mục 6. Vá 5 P1/P2: esc(tier) sót ở cảnh báo bán vượt, cảnh báo đơn mang hạng đã xóa khỏi Settings, biểu đồ doanh thu đồng bộ `ACTIVE_STATUSES` với stat card, trục X biểu đồ gom theo ngày thật (không sort chuỗi dd/mm), card flex đếm vé thay vì đơn, mục "đã cọc chưa TT đủ" thêm ngưỡng tuổi đơn, Thùng rác auto-refresh ở tab Cài đặt, `_pullBusy` chống pullAll chạy chồng gây nhân đôi đơn, `pruneCloudOrphansAfterImport()` dọn cloud sau import. |
| 30/07 | Round 8 (hotfix P0 phát sinh sau R7) | **Fix hotfix restore vẫn hỏng sau R7**: cả 4 nhánh soft-delete trong `pullAll` thiếu SO SÁNH THỜI GIAN (chỉ check `!local.deleted_at`) → pull chạy xen giữa lúc outbox debounce 1.5s đọc phải cloud CŨ → tự xoá lại bản vừa khôi phục TRÊN CHÍNH MÁY vừa bấm. **Phát hiện + fix lớp lỗi "đơn giữ chỗ" (`total=0`, `deposit_amount>0` — 15/18 đơn thật lúc đó)**: bill/email/tracuu.html/modal/dashboard/Excel/followup — 8 vị trí hiện "0đ" hoặc nuốt mất tiền cọc thay vì "Chốt khi BTC công bố giá". Root cause: R6 trở về trước ngầm giả định "đơn luôn có total>0", sai với nghiệp vụ nhận cọc giữ chỗ trước khi mở bán. Kèm: `normalizePhone()`/`validatePhone()`, double-tap guard nút Lưu (đặt ĐÚNG trong try/finally hiện có, không phải đầu hàm — có 7 early-return), tìm kiếm thêm ghi chú/số ghế/nguồn vé, label ô mật khẩu Supabase chống nhầm mk mail/app. Đây là **class lỗi lớn nhất khoá học rút ra**: audit theo cấu trúc code không đủ — phải audit từ HÌNH DẠNG DỮ LIỆU THẬT (xem `~/.claude/PATTERNS.md §A57`). |
| 31/07 | Round 9 (audit + vá P0+P1) | **Audit lần 3 (3 agent song song theo 8 trụ cột) + tự verify tay + 1 curl LIVE vào chính Supabase.** 6 lỗi P0: (1) **RLS `using(true)` + đăng ký công khai đang MỞ** (xác nhận LIVE `GET /auth/v1/settings` → `disable_signup:false`) = bất kỳ ai tự signup là có toàn quyền 5 bảng — vá bằng bảng `app_owner` + hàm `is_owner()`/`claim_owner()` (security definer, pin đúng 1 UID, xem mục 4); (2) đổi "đã giao vé" làm cọc BAY khỏi "Tiền thực đã thu" khi `total=0` (fix bằng `orderReceived()`); (3) Lợi nhuận tạm tính ra ÂM giả vì cộng vốn nhưng không cộng doanh thu của đúng các đơn giữ chỗ đó; (4) chấm đồng bộ báo XANH dù `pullAll` vừa lỗi thật (`finally{}` ghi đè mất `updateSyncStatus('error')` — vá bằng cờ `_lastPullOk`); (5) Khôi phục từ Thùng rác ép `status:'hủy'`, xoá mất trạng thái gốc; (6) gỡ hẳn nút "Tạo dữ liệu mẫu" (mìn cạnh 18 đơn tiền thật — `Table.clear()` không bắn hook enqueue, seedData không gọi `pruneCloudOrphansAfterImport`). Trích **3 hàm tiền dùng chung `orderRevenue/orderReceived/orderRemaining`** (app.js đầu file) — nguồn sự thật duy nhất, thay thế toàn bộ công thức tự viết lại ở CTV/badge VIP/lịch sử khách/Dashboard/Excel (fix luôn Excel tự mâu thuẫn: cột "Còn thiếu" kẹp 0 theo dòng vs ô "Tổng còn thiếu" kẹp 0 trên tổng). 4 lỗi P1: 4 chỗ còn hiện "0đ" cho đơn giữ chỗ (modal chi tiết + 2 card followup + Thùng rác), QR trên bill trỏ `tracuu.html?code=` nhưng trang không đọc query string (thêm `URLSearchParams`), `checkInventory()` không trigger khi đổi Số lượng VÀ không so với số đang nhập (chỉ so tồn kho sẵn có) — vá cả 2. Verify: `node --check` sạch + test thuần Node cho 3 hàm tiền (8/8 kịch bản PASS, xem `~/.claude/plans/giggly-riding-dusk.md`). **CHƯA verify LIVE** (agent không có trình duyệt) — cần anh tự chạy mục VERIFY trong plan trước khi tin điểm số. **Phát hiện mới lúc verify, đã hỏi anh Quân và VÁ LUÔN**: `changeOrderStatus()` giờ tự nâng `deposit_amount` lên bằng `total` khi đánh dấu "đã thanh toán đủ"/"đã giao vé" (chỉ nâng, không hạ nếu đã ≥ total) — trước đó nếu đơn đã chốt giá mà cọc cũ < tổng, "Còn thiếu" vẫn hiện số dương ngay cạnh badge "ĐÃ THANH TOÁN ĐỦ". 6 mục P2 ghi nhận, chưa vá (xem plan): `removeTier` không confirm + nút 14px, modal Ký gửi/Tồn kho không hỏi khi đóng nhầm, Dexie CDN từ unpkg (khác 5 lib jsdelivr), `revoke next_order_code from public` thiếu (đã vá luôn trong SQL cùng đợt vì cùng file), reconcile/prune nuốt lỗi `continue`, 0 test tự động + 0 gate cú pháp trong `deploy.yml`. |

## 8. BUG ĐÃ FIX (BÀI HỌC RÚT RA)

| Bug | Root Cause | Bài học |
|---|---|---|
| Email không sync | 2 file khai báo `db.version(3)` khác nhau → conflict | **KHÔNG BAO GIỜ khai báo cùng version ở 2 file** |
| Xóa cache mất credentials | Supabase URL/Key lưu IndexedDB | **Hardcode public keys, chỉ dynamic cho secrets** |
| Service Worker cache cứng đầu | SW lưu cache cũ, code mới không được load | **Đã vô hiệu hóa SW** |
| Netlify deploy fail | Submodule hỏng trong Git | **Kiểm tra `.gitmodules` khi clone fail** |

## 9. KAIZEN CÒN LẠI (ĐỌC TRƯỚC KHI LÀM)

**✅ ĐÃ XONG (không phải "còn lại" — sửa lại vì HANDOFF cũ liệt kê nhầm):**
- ~~Kaizen 5 — Phân trang/Lazy Load~~: đã có `ordersPage`/`PAGE_SIZE=50` (app.js:28-29), `loadMoreOrders()`, nút "Tải thêm N đơn" ở tab Đơn hàng.
- ~~Kaizen 6 — Hash mật khẩu~~: đã có `sha256()` (app.js:363) + migration tự động plaintext→hash khi phát hiện giá trị cũ (app.js:52-58).
- Còn thiếu thật của Kaizen 6 cũ: **`sessionTimeout`** (auto logout sau X phút) — chưa làm, ưu tiên THẤP.

### Kaizen 7 — Dark/Light Mode Toggle (Ưu tiên: THẤP)
**Mục đích:** Cho phép user chọn giao diện sáng/tối.
**Cách làm gợi ý:**
- Thêm CSS variables cho light theme
- Toggle button ở Settings
- Lưu preference vào IndexedDB settings
**Rủi ro:** THẤP — chỉ CSS

## 10. HƯỚNG DẪN CHO AGENT MỚI

### Bắt đầu
1. Đọc file này TRƯỚC
2. Đọc `docs/SPEC.md` để hiểu schema
3. Đọc `docs/JOURNEY.md` để hiểu lịch sử
4. Test trên `localhost:8085` (dùng live-server)
5. Mật khẩu: `bigbang2026`

### Khi code
1. Sửa code → Test trên localhost → `git add . && git commit -m "..." && git push`
2. GitHub Pages tự deploy trong ~1-2 phút
3. **QUAN TRỌNG:** Version DB (Dexie) chỉ khai báo trong `sync.js`, KHÔNG khai báo trong `app.js` từ v3 trở lên

### User preferences
- User nói tiếng Việt, thích giao tiếp trực tiếp
- Thích UX đơn giản (1 click là xong)
- Dùng app trên cả điện thoại lẫn máy tính
- Muốn copy tin nhắn để dán vào Zalo gửi khách
- Xưng hô: "Quân" là chủ shop, "bạn [Tên]" là khách

### Repo structure
```
bigbang-crm/           ← Repo riêng (Public) — chỉ chứa CRM
├── .github/workflows/ ← GitHub Actions deploy
├── docs/              ← PRD, SPEC, PLAN, JOURNEY
├── app.js, sync.js, style.css, index.html
├── tracuu.html
├── HUONG_DAN.md, SETUP_NANG_CAP.md, HD_NHAN_BAN_CRM.md
└── supabase-setup.sql

BT1-backup/            ← Repo gốc (Private) — chứa MỌI dự án khác
└── bigbang-crm/       ← Bản copy (có thể outdated)
```

> **CẢNH BÁO:** Chỉ push vào repo `bigbang-crm` riêng. KHÔNG push vào `BT1-backup` cho phần CRM nữa.
