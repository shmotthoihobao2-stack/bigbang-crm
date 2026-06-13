# JOURNEY — BigBang CRM
> Bắt đầu: 2026-06-11 | Phiên bản hiện tại: DB v4 | Trạng thái: Production

---

## Quyết định kiến trúc ban đầu
- **Vanilla HTML/CSS/JS** thay vì React/Next.js: ưu tiên tốc độ triển khai, không cần build step
- **IndexedDB (Dexie.js)** cho offline-first local storage
- **Supabase** cho cloud sync 2 chiều (thêm sau Phase 1)
- **GitHub Pages** để deploy (thay Netlify vì hết credits)

---

## Lịch sử phát triển (Theo thứ tự thời gian)

### Phase 1 — Xây nền (11-12/06/2026)
- Tạo app CRM hoàn chỉnh: Dashboard, Đơn hàng, Tồn kho, Follow-up, Cài đặt
- Hệ thống login bằng mật khẩu (lưu local)
- Auto-lookup khách cũ qua SĐT
- Sinh Bill PNG có mã QR
- Export Excel (.xlsx) 3 sheet
- Backup/Import JSON
- Countdown tới ngày concert
- Hệ thống Pass vé ký gửi (Resale)

### Phase 2 — Cloud Sync (12/06/2026)
- Tích hợp Supabase (PostgreSQL + Auth)
- Đồng bộ 2 chiều: Local ↔ Cloud mỗi 30 giây + Realtime
- Outbox queue (ghi local trước, đẩy cloud sau)
- UUID mapping giữa local ID và cloud UUID
- Trang tra cứu đơn công khai (tracuu.html)

### Kaizen 1 — Dashboard Charts (12/06/2026)
- Biểu đồ doanh thu theo ngày (Line chart - Chart.js)
- Biểu đồ tỷ trọng hạng vé (Doughnut chart)

### Kaizen 2 — Upload Ủy Nhiệm Chi (13/06/2026)
- Upload ảnh bill chuyển khoản lên Supabase Storage
- Hiển thị ảnh trong chi tiết đơn (click phóng to)
- Bucket: `payment_proofs` (Public)
- **Yêu cầu:** Phải tạo RLS Policy INSERT cho bucket trên Supabase

### Kaizen 3 — Copy Tin Nhắn Chốt Đơn (13/06/2026)
- Template tin nhắn tự động: "Quân chào bạn [Tên]..."
- Hiển thị sẵn trong textarea (không dùng clipboard API vì bị captcha)
- User tự bôi đen copy hoặc bấm nút Copy
- Xưng hô: "Quân" (chủ shop) và "bạn [Tên Khách]"

### Kaizen 3.5 — Thêm trường Email (13/06/2026)
- Thêm ô Email khách hàng vào form tạo đơn
- Mục đích: gửi vé QR cho khách sau này
- DB migration v3 → v4 (fix conflict Dexie schema)
- Sync cloud đầy đủ
- **Yêu cầu SQL Supabase:**
  ```sql
  ALTER TABLE public.customers ADD COLUMN email text DEFAULT '';
  ```

### Kaizen 4 — Gửi Vé Qua Email (13/06/2026)
- Tích hợp EmailJS (free 200 email/tháng, reset 13/07)
- Email gửi từ: `vebigbang2026@gmail.com`
- Nút "📧 Gửi vé Email" trong chi tiết đơn (tím gradient)
- Tự động điền thông tin đơn hàng vào email template
- Service ID: `service_c2q6n7f`
- Template ID: `template_thvt726`
- Public Key: `lhJZwyjgcDzYQM7uc`

---

## Bug đã fix

| Ngày | Bug | Nguyên nhân | Cách sửa |
|---|---|---|---|
| 13/06 | Thanh tìm kiếm trùng 2 cái | HTML có 2 input cùng id | Xóa cái thừa |
| 13/06 | Chart.js load 2 lần | Load ở `<head>` và cuối `<body>` | Xóa bản trùng |
| 13/06 | Tab Orders active cùng Dashboard | HTML đặt `class="active"` nhầm | Xóa active |
| 13/06 | Service Worker cache cứng đầu | SW lưu bộ nhớ đệm cũ | Gỡ bỏ SW |
| 13/06 | Netlify deploy fail | 3 submodule hỏng trong repo Git | Gỡ submodule |
| 13/06 | Email không sync giữa thiết bị | Dexie v3 conflict giữa app.js và sync.js | Nâng lên v4 thống nhất |
| 13/06 | Xóa cache mất Supabase credentials | URL/Key lưu trong IndexedDB | Hardcode vào sync.js |
| 13/06 | Netlify hết credits | Free tier hết 300 build | Chuyển sang GitHub Pages |

---

## Cấu hình hiện tại

### Hosting
- **GitHub Pages:** `shmotthoihobao2-stack.github.io/bigbang-crm/`
- **Repo riêng:** `shmotthoihobao2-stack/bigbang-crm` (Public)
- **CI/CD:** GitHub Actions — tự deploy khi push lên `main`
- **Netlify (cũ):** `ve-bigbang-vip.netlify.app` — hết credits, không dùng nữa

### Cloud Database
- **Supabase Project URL:** `https://satcrqkyxrrioctncokv.supabase.co` (hardcode trong sync.js)
- **Tables:** `customers`, `orders`, `inventory`, `resales`, `app_settings`
- **Storage bucket:** `payment_proofs` (Public, cần RLS Policy INSERT)

### Email Service
- **EmailJS:** Free 200 email/tháng
- **Email gửi:** `vebigbang2026@gmail.com`

### GitHub Repos
- **Repo CRM (riêng, Public):** `shmotthoihobao2-stack/bigbang-crm`
- **Repo gốc (Private):** `shmotthoihobao2-stack/BT1-backup` — chứa các dự án khác, KHÔNG public
