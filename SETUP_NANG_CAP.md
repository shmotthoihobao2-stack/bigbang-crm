# 🚀 SETUP NÂNG CẤP v3 — Cloud Sync + Tra cứu công khai + PWA

Bản v3 thêm 3 thứ: **(1)** dữ liệu đồng bộ lên cloud Supabase (hết lo mất data, dùng nhiều máy), **(2)** trang tra cứu đơn công khai cho khách, **(3)** PWA — cài app lên màn hình chính, chạy được khi mạng yếu.

> ⏱️ Tổng thời gian setup: ~15 phút. Làm đúng thứ tự bên dưới.
> 💡 Chưa setup Supabase thì app vẫn chạy local bình thường như cũ — không hỏng gì cả.

---

## PHẦN A — Tạo Supabase (miễn phí)

1. Vào **https://supabase.com** → Sign up (đăng nhập bằng GitHub hoặc email)
2. Bấm **New project**:
   - Name: `bigbang-crm`
   - Database Password: đặt 1 mật khẩu mạnh, **lưu lại** (đây là mật khẩu database, khác mật khẩu đăng nhập app)
   - Region: **Southeast Asia (Singapore)** — gần VN nhất
3. Đợi ~2 phút project khởi tạo xong

## PHẦN B — Chạy SQL tạo bảng + bảo mật

1. Trong project, vào menu trái → **SQL Editor** → **New query**
2. Mở file `supabase-setup.sql` (trong thư mục app), **copy toàn bộ**, dán vào, bấm **RUN**
3. Thấy "Success. No rows returned" là xong. Script này tạo 5 bảng + khóa bảo mật:
   - Người lạ KHÔNG đọc được bất kỳ dữ liệu nào
   - Chỉ duy nhất hàm tra cứu (cần đúng cả mã đơn + 4 số cuối SĐT) là công khai, và nó chỉ trả về thông tin đã che tên

## PHẦN C — Tạo tài khoản đăng nhập cho shop

1. Menu trái → **Authentication** → **Users** → **Add user** → **Create new user**
2. Nhập email + mật khẩu (đây là tài khoản chủ shop để app đăng nhập cloud)
3. ✅ Tick **Auto Confirm User** rồi tạo

## PHẦN D — Lấy 2 thông tin kết nối

1. Menu trái → **Settings** (bánh răng) → **API**
2. Copy 2 thứ:
   - **Project URL** (dạng `https://xxxx.supabase.co`)
   - **anon public** key (chuỗi dài bắt đầu `eyJ...`) — key này AN TOÀN để công khai vì đã có lớp bảo mật RLS ở phần B

## PHẦN E — Kết nối app

1. Mở BigBang CRM → tab **⚙️ Cài đặt** → mục **☁️ Đồng bộ cloud**
2. Dán Project URL + anon key, nhập email + mật khẩu ở Phần C
3. Bấm **🔗 Kết nối & đồng bộ**
   - Lần đầu: app tự đẩy toàn bộ dữ liệu local lên cloud
   - Từ đó: mọi thay đổi tự đồng bộ; chấm tròn trên header báo trạng thái:
     - 🟢 xanh = đã đồng bộ | 🟡 vàng nhấp nháy = đang đẩy | 🟠 cam = offline (sẽ tự đẩy khi có mạng) | 🔴 đỏ = lỗi | ⚪ xám = chế độ local
   - Bấm vào chấm tròn = đồng bộ ngay
4. **Dùng máy thứ 2**: mở app trên máy đó → nhập đúng 4 thông tin trên → Kết nối → dữ liệu tự về

## PHẦN F — Trang tra cứu công khai cho khách

1. Mở file `tracuu.html` bằng Notepad/VS Code, sửa 4 dòng đầu trong thẻ `<script>`:
   ```
   const SUPABASE_URL = 'https://xxxx.supabase.co';   ← dán URL Phần D
   const SUPABASE_ANON_KEY = 'eyJ...';                 ← dán anon key Phần D
   const SHOP_NAME = 'Tên shop của anh';
   const SHOP_ZALO = '09xxxxxxxx';                     ← để khách bấm liên hệ
   ```
2. Đưa file lên hosting miễn phí (chỉ cần file này, KHÔNG đưa cả app lên!):
   - **Cách dễ nhất — Netlify Drop**: vào https://app.netlify.com/drop → kéo thả MỘT MÌNH file `tracuu.html` (đổi tên thành `index.html` trước khi kéo) → nhận link dạng `https://xxx.netlify.app`
   - Hoặc GitHub Pages / Vercel nếu anh quen
3. Test: nhập 1 mã đơn thật + 4 số cuối SĐT khách đó → hiện trạng thái đơn
4. **In link này lên bill / gửi kèm khi chốt cọc** — "Anh/chị tra cứu đơn bất cứ lúc nào tại đây" là câu chốt niềm tin cực mạnh

⚠️ **Tuyệt đối không** đưa `index.html`/`app.js` của CRM lên hosting public — chỉ `tracuu.html` thôi.

## PHẦN G — Cài PWA lên điện thoại

1. App phải chạy qua `http://` (như anh đang chạy `python -m http.server 8085`) — mở bằng `http://localhost:8085`, **không mở kiểu file://**
2. Trên điện thoại (cùng wifi, mở `http://<IP máy tính>:8085`):
   - **Android Chrome**: menu ⋮ → "Thêm vào màn hình chính" / "Cài đặt ứng dụng"
   - **iPhone Safari**: nút Chia sẻ → "Thêm vào MH chính"
3. App có icon vương miện 👑 riêng, mở fullscreen như app thật, và **vẫn mở được khi mạng chập chờn** (giao diện + dữ liệu local hoạt động; thay đổi xếp hàng chờ, có mạng tự đẩy lên cloud)

---

## ❓ FAQ nâng cấp

**Q: Không setup Supabase có sao không?**
A: Không sao — app chạy local y như v2.1. Nhưng nhớ backup tay thường xuyên.

**Q: 2 máy cùng tạo đơn 1 lúc có trùng mã không?**
A: Không — khi online, app lấy mã lớn nhất trên cloud rồi +1. Chỉ khi CẢ 2 máy cùng offline cùng tạo đơn mới có rủi ro nhỏ, hiếm gặp.

**Q: Sửa cùng 1 đơn trên 2 máy?**
A: Bản sửa sau cùng thắng (theo thời gian). Nên phân vùng: mỗi người phụ trách đơn của mình.

**Q: Anon key lộ ra trong tracuu.html có nguy hiểm không?**
A: Không — RLS đã khóa: người có anon key chỉ gọi được hàm tra cứu (phải đúng cả mã đơn + SĐT), không đọc được danh sách khách hay bất kỳ bảng nào.

**Q: Lỡ tay xóa data trên cloud?**
A: Vẫn giữ thói quen bấm 💾 Backup JSON định kỳ — backup giờ là lớp bảo hiểm thứ 2.
