# JOURNEY — BigBang CRM
> Bắt đầu: 2026-06-11 | Phiên bản hiện tại: v20+ | Trạng thái: Production

---

## Quyết định kiến trúc ban đầu
- **Vanilla HTML/CSS/JS** thay vì React/Next.js: ưu tiên tốc độ triển khai, không cần build step
- **IndexedDB (Dexie.js)** cho offline-first local storage
- **Supabase** cho cloud sync 2 chiều (thêm sau Phase 1)
- **Netlify** CI/CD tự động deploy từ GitHub

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
- Đồng bộ 2 chiều: Local ↔ Cloud mỗi 30 giây
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
- DB migration v3, sync cloud đầy đủ
- **Yêu cầu SQL Supabase:**
  ```sql
  ALTER TABLE public.customers ADD COLUMN email text DEFAULT '';
  ```

---

## Bug đã fix (13/06/2026)

| Bug | Nguyên nhân | Cách sửa |
|---|---|---|
| Thanh tìm kiếm trùng 2 cái | HTML có 2 input cùng id `order-search` | Xóa cái thừa |
| Chart.js load 2 lần | Load ở `<head>` và cuối `<body>` | Xóa bản trùng |
| Tab Orders active cùng Dashboard | HTML đặt `class="active"` nhầm | Xóa active |
| Service Worker cache cứng đầu | SW lưu bộ nhớ đệm cũ không chịu cập nhật | Gỡ bỏ SW, thêm script xóa cache |
| Netlify deploy fail | 3 submodule hỏng trong repo Git | Gỡ submodule khỏi Git index |

---

## Cấu hình hiện tại

### Hosting
- **Netlify site:** `ve-bigbang-vip.netlify.app`
- **CI/CD:** Tự động deploy khi push lên GitHub `main` branch
- **Publish directory:** `bigbang-crm`
- **Build command:** (trống — static site)

### Cloud Database
- **Supabase Project URL:** Lưu trong app Settings (user tự nhập)
- **Tables:** `customers`, `orders`, `inventory`, `settings`
- **Storage bucket:** `payment_proofs` (Public, cần RLS Policy INSERT)

### GitHub
- **Repo:** `shmotthoihobao2-stack/BT1-backup`
- **Branch:** `main`
- **Thư mục CRM:** `bigbang-crm/`
