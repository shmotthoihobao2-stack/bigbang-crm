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
2. **Project URL + anon key đã hardcode sẵn trong `sync.js`** (2 dòng `DEFAULT_SUPABASE_URL`/`DEFAULT_SUPABASE_KEY`) — không cần dán lại trong app. Chỉ cần nhập **email + mật khẩu** đã tạo ở Phần C.
   - Nếu clone app này cho dự án/shop KHÁC dùng Supabase riêng: sửa trực tiếp 2 hằng số đó trong `sync.js` (xem `HD_NHAN_BAN_CRM.md`)
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

💡 **Cập nhật:** bản BigBang CRM đang chạy production thực tế đã deploy **toàn bộ app** (kể cả `index.html`/`app.js`) lên GitHub Pages public — điều này AN TOÀN vì: (1) anon key chỉ gọi được hàm tra cứu công khai đã che tên (RLS chặn hết phần còn lại), (2) app có màn hình đăng nhập mật khẩu riêng chặn trước khi vào CRM. Khuyến nghị cũ "chỉ đưa tracuu.html" vẫn là lựa chọn AN TOÀN HƠN NỮA nếu anh muốn tách biệt hẳn (khách chỉ thấy trang tra cứu, không thấy cả giao diện quản lý dù có đăng nhập) — tùy anh chọn mức độ.

## PHẦN G — Cài PWA lên điện thoại

⚠️ **Quan trọng — secure context:** app dùng `crypto.subtle` (mã hóa mật khẩu SHA-256) — trình duyệt CHỈ cho phép chạy trên `https://`, `http://localhost`, hoặc mở trực tiếp `file://`. **`http://<IP máy tính>:port`** (LAN, không phải localhost) **KHÔNG phải secure context** → `crypto.subtle` là `undefined` → bấm Đăng nhập **không có phản ứng gì**, không báo lỗi. Vì vậy trên điện thoại (khác máy chạy server) **không dùng được cách mở qua IP LAN** — dùng 1 trong 2 cách sau:
1. **Khuyên dùng:** mở thẳng link production đã deploy (`https://shmotthoihobao2-stack.github.io/bigbang-crm/` hoặc domain riêng) — luôn là secure context, không vướng lỗi này.
2. Nếu chạy hoàn toàn offline/local: mở trực tiếp file `index.html` bằng `file://` trên chính điện thoại đó (Chrome/Safari coi `file://` là potentially-trustworthy).

Cài vào màn hình chính:
- **Android Chrome**: menu ⋮ → "Thêm vào màn hình chính" / "Cài đặt ứng dụng"
- **iPhone Safari**: nút Chia sẻ → "Thêm vào MH chính"

App có icon vương miện 👑 riêng, mở fullscreen như app thật. Lưu ý: `sw.js` hiện là **kill-switch** (không cache gì) — mất mạng hoàn toàn thì các thư viện tải từ CDN (Dexie, Chart.js...) sẽ không load được, trang trắng. "Offline" ở đây chỉ đúng cho **ghi dữ liệu** (thay đổi xếp hàng chờ trong outbox, có mạng tự đẩy lên cloud) khi tab đã mở sẵn từ trước, không phải mở app mới hoàn toàn khi không có mạng.

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
