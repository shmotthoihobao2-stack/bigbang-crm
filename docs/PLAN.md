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
- [x] DB migration v3
- [x] Sync cloud

### Hotfix — CI/CD & Bugs (13/06/2026) ✅
- [x] Netlify CI/CD tự động từ GitHub
- [x] Gỡ 3 submodule hỏng
- [x] Xóa thanh tìm kiếm trùng
- [x] Xóa Chart.js load trùng
- [x] Gỡ Service Worker cache cứng đầu

---

## ĐANG CHỜ TRIỂN KHAI

### Kaizen 4 — Phân trang (Ưu tiên: CAO)
- [ ] Lazy load 50 đơn/lần
- [ ] Nút "Tải thêm" hoặc infinite scroll
- [ ] Chuẩn bị cho 5000+ đơn

### Kaizen 5 — Realtime Sync (Ưu tiên: TRUNG BÌNH)
- [ ] Supabase Realtime subscription
- [ ] Đồng bộ tức thì (0s thay vì 30s)

### Kaizen 6 — Gửi vé QR qua Email (Ưu tiên: CAO)
- [ ] Tích hợp gửi email (Resend/EmailJS)
- [ ] Đính kèm vé QR dạng PNG

### Kaizen 7 — Nâng cấp UX (Ưu tiên: THẤP)
- [ ] Dark/Light mode toggle
- [ ] Mã hóa mật khẩu (bcrypt hash)
- [ ] Timeout phiên đăng nhập

---

## LƯU Ý CHO AGENT MỚI

1. **Đọc docs/ trước khi code** — JOURNEY.md có toàn bộ lịch sử
2. **Test trên localhost:8085** — dùng live-server hoặc http-server
3. **Mật khẩu test:** `bigbang2026`
4. **Sau khi code xong:** `git add . && git commit -m "..." && git push` → Netlify tự deploy
5. **Publish directory trên Netlify:** `bigbang-crm`
6. **Nếu thêm cột DB:** Phải thêm vào 3 chỗ: Dexie schema (app.js), toCloud (sync.js), pullAll (sync.js)
7. **Nếu thêm cột Supabase:** Chạy `ALTER TABLE` trên SQL Editor
