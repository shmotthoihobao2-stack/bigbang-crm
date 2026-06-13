# PLAN — Kế hoạch phát triển BigBang CRM

## ĐÃ HOÀN THÀNH

### Phase 1 — Nền tảng (11/06/2026) ✅
- [x] Login / Auth
- [x] Dashboard + Stats
- [x] CRUD đơn hàng
- [x] Quản lý tồn kho
- [x] Follow-up tự động
- [x] Sinh Bill PNG + QR
- [x] Export Excel
- [x] Backup/Import
- [x] Cài đặt (hạng vé, CTV, mật khẩu)

### Phase 2 — Cloud Sync (12/06/2026) ✅
- [x] Supabase setup (tables + auth)
- [x] 2-way sync (outbox queue + pullAll)
- [x] UUID mapping
- [x] Trang tra cứu đơn công khai
- [x] Realtime subscription (orders + customers)

### Kaizen 1 — Charts (12/06/2026) ✅
- [x] Biểu đồ doanh thu theo ngày
- [x] Biểu đồ tỷ trọng hạng vé

### Kaizen 2 — Upload Ủy Nhiệm Chi (13/06/2026) ✅
- [x] Upload ảnh lên Supabase Storage
- [x] Hiển thị trong chi tiết đơn

### Kaizen 3 — Copy Tin Nhắn (13/06/2026) ✅
- [x] Template tin nhắn "Quân chào bạn..."
- [x] Textarea hiển thị sẵn + nút Copy

### Kaizen 3.5 — Email Khách Hàng (13/06/2026) ✅
- [x] Thêm trường email vào customers
- [x] DB migration v3 → v4 (fix Dexie schema conflict)
- [x] Sync cloud đầy đủ (toCloud + pullAll)

### Kaizen 4 — Gửi Vé Qua Email (13/06/2026) ✅
- [x] Tích hợp EmailJS (free 200 email/tháng)
- [x] Email gửi từ vebigbang2026@gmail.com
- [x] Nút "📧 Gửi vé Email" trong chi tiết đơn
- [x] Popup xác nhận trước khi gửi

### Hotfix — CI/CD & Bugs (13/06/2026) ✅
- [x] Netlify CI/CD tự động từ GitHub
- [x] Gỡ 3 submodule hỏng
- [x] Xóa thanh tìm kiếm trùng
- [x] Xóa Chart.js load trùng
- [x] Gỡ Service Worker cache cứng đầu
- [x] Fix Dexie schema conflict v3 → v4
- [x] Hardcode Supabase URL/Key vào sync.js
- [x] Tách repo riêng bigbang-crm (Public)
- [x] Chuyển từ Netlify sang GitHub Pages

---

## ĐANG CHỜ TRIỂN KHAI

### Kaizen 5 — Phân trang (Ưu tiên: TRUNG BÌNH)
- [ ] Lazy load 50 đơn/lần
- [ ] Nút "Tải thêm" hoặc infinite scroll
- [ ] Chuẩn bị cho 5000+ đơn

### Kaizen 6 — Nâng cấp Bảo mật (Ưu tiên: THẤP)
- [ ] Mã hóa mật khẩu (bcrypt hash)
- [ ] Timeout phiên đăng nhập
- [ ] Dark/Light mode toggle

---

## LƯU Ý CHO AGENT MỚI

1. **Đọc docs/ trước khi code** — JOURNEY.md có toàn bộ lịch sử
2. **Test trên localhost:8085** — dùng live-server hoặc http-server
3. **Mật khẩu test:** `bigbang2026`
4. **Sau khi code xong:** `git add . && git commit -m "..." && git push` → GitHub Pages tự deploy
5. **Repo riêng CRM:** `shmotthoihobao2-stack/bigbang-crm` (KHÔNG push vào BT1-backup)
6. **Nếu thêm cột DB:** Phải thêm vào 3 chỗ: Dexie schema (sync.js v4), toCloud (sync.js), pullAll (sync.js)
7. **Nếu thêm cột Supabase:** Chạy `ALTER TABLE` trên SQL Editor
8. **Supabase URL/Key:** Đã hardcode trong sync.js (DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY)
9. **EmailJS:** Service `service_c2q6n7f`, Template `template_thvt726`, Key `lhJZwyjgcDzYQM7uc`
