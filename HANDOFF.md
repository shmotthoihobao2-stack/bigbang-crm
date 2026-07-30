# 🤖 BÀN GIAO DỰ ÁN — BigBang CRM
> Cập nhật lần cuối: 17/06/2026 ICT
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
| **Điểm đánh giá** | 9.0/10 |
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
- Supabase anon key là PUBLIC KEY, an toàn để commit (Supabase thiết kế như vậy)
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
| 30/07 | Round 7 (audit) | **Audit tổng thể 3 agent song song + tự verify tay từng phát hiện nặng.** Vá 2 lỗi P0 THẬT: (1) `pullAll` thiếu `deleted_at:null` ở 4 nhánh merge → nút "Khôi phục" Thùng rác vô hiệu khi dùng 2 máy (đơn tự chui lại thùng rác, xóa cứng sau 30 ngày); (2) import backup âm thầm reset mật khẩu app về mặc định công khai → giữ key `password`/`supabaseEmail`/... qua import. **⚠️ Lỗi P0 thứ 3 báo trong audit ("cache-bust `?v=` đứng yên 6 tuần") là FALSE POSITIVE** — `deploy.yml` đã tự inject commit SHA từ 14/06, live luôn đúng bản mới (verify: `curl -s <URL> | grep -o '?v='` ra `0c93721f` khớp commit). Bài học: verify nửa chừng (chỉ đọc `git log -- index.html`, không đọc pipeline deploy) thì kết luận sai — xem quy tắc #5 mục 6. Vá 5 P1/P2: esc(tier) sót ở cảnh báo bán vượt, cảnh báo đơn mang hạng đã xóa khỏi Settings, biểu đồ doanh thu đồng bộ `ACTIVE_STATUSES` với stat card, trục X biểu đồ gom theo ngày thật (không sort chuỗi dd/mm), card flex đếm vé thay vì đơn, mục "đã cọc chưa TT đủ" thêm ngưỡng tuổi đơn, Thùng rác auto-refresh ở tab Cài đặt, `_pullBusy` chống pullAll chạy chồng gây nhân đôi đơn, `pruneCloudOrphansAfterImport()` dọn cloud sau import. **Còn tồn (ghi nhận, chưa vá — round riêng nếu cần):** index `uuid` không unique (cần bump Dexie v6+dedupe), mã đơn tuần tự dò được qua `lookup_order` (rate-limit), tài liệu `.md` còn nhiều chỗ lệch code thật. |

## 8. BUG ĐÃ FIX (BÀI HỌC RÚT RA)

| Bug | Root Cause | Bài học |
|---|---|---|
| Email không sync | 2 file khai báo `db.version(3)` khác nhau → conflict | **KHÔNG BAO GIỜ khai báo cùng version ở 2 file** |
| Xóa cache mất credentials | Supabase URL/Key lưu IndexedDB | **Hardcode public keys, chỉ dynamic cho secrets** |
| Service Worker cache cứng đầu | SW lưu cache cũ, code mới không được load | **Đã vô hiệu hóa SW** |
| Netlify deploy fail | Submodule hỏng trong Git | **Kiểm tra `.gitmodules` khi clone fail** |

## 9. KAIZEN CÒN LẠI (ĐỌC TRƯỚC KHI LÀM)

### Kaizen 5 — Phân trang / Lazy Load (Ưu tiên: TRUNG BÌNH)
**Mục đích:** App không bị lag khi có 500+ đơn.
**Cách làm gợi ý:**
- Thay `db.orders.toArray()` bằng `db.orders.offset(page*50).limit(50).toArray()`
- Thêm nút "Tải thêm" hoặc infinite scroll ở tab Đơn hàng
- Dashboard stats vẫn dùng `.count()` và `.sum()` (Dexie hỗ trợ)
**Rủi ro:** THẤP — chỉ sửa phần render danh sách

### Kaizen 6 — Bảo mật nâng cao (Ưu tiên: THẤP)
**Mục đích:** Mã hóa mật khẩu, session timeout.
**Cách làm gợi ý:**
- Thay lưu plaintext bằng hash (dùng `crypto.subtle.digest('SHA-256', ...)` native)
- Thêm `sessionTimeout` setting (auto logout sau X phút)
**Rủi ro:** TRUNG BÌNH — cần migrate mật khẩu cũ

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
