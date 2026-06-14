# 🚀 HƯỚNG DẪN BÀN GIAO & NHÂN BẢN HỆ THỐNG CRM

Tài liệu này dành cho Anh (Chủ mã nguồn) để hướng dẫn chi tiết cách nhân bản (clone) hệ thống CRM này và bàn giao cho khách hàng (người mua lại phần mềm hoặc đội nhóm mới).

Hệ thống được thiết kế theo dạng **Serverless PWA (Netlify + Supabase)**, nên việc nhân bản cho 1 khách hàng mới cực kỳ dễ dàng, không mất chi phí duy trì server hàng tháng.

---

## PHẦN 1: CHUẨN BỊ SOURCE CODE ĐỂ BÀN GIAO

Anh chỉ cần nén toàn bộ thư mục `bigbang-crm` thành file `.zip` (vd: `crm-source.zip`). Tuy nhiên, trước khi nén, hãy nhắc nhở khách hàng:
- File này chứa **100% mã nguồn sạch**, không chứa bất kỳ dữ liệu cũ nào của anh (dữ liệu nằm trên trình duyệt và Supabase).
- Khi họ mua/nhận bộ code này, họ sẽ sở hữu 1 bản độc lập hoàn toàn.

---

## PHẦN 2: HƯỚNG DẪN KHÁCH HÀNG TỰ SETUP (CỰC KỲ QUAN TRỌNG)

Khi khách hàng nhận file `crm-source.zip`, hãy yêu cầu họ làm đúng theo **3 bước chuẩn hóa** sau đây để hệ thống chạy được online và có tính năng tra cứu cho khách của họ.

### BƯỚC 1: TẠO DATABASE ĐỘC LẬP (SUPABASE)
*Tuyệt đối KHÔNG cho khách hàng dùng chung Key Supabase của anh để tránh lộ data.*

1. Khách hàng vào **[Supabase.com](https://supabase.com)** -> Đăng nhập bằng Github/Gmail -> Bấm **New Project**.
2. Nhập tên dự án (VD: `PheVe-CRM`), tạo mật khẩu Database và chọn Region `Singapore` (để tốc độ về VN nhanh nhất) -> Bấm **Create New Project**.
3. Đợi 2-3 phút cho Supabase setup xong.
4. Trỏ vào **SQL Editor** (menu bên trái) -> Bấm **New Query**.
5. Mở file **`supabase-setup.sql`** trong thư mục code, copy TOÀN BỘ nội dung dán vào SQL Editor -> Bấm nút **Run** màu xanh.
   *(Việc này sẽ tự động tạo đủ 5 bảng: customers, orders, inventory, resales, app_settings và toàn bộ bảo mật RLS, các cột số ghế, nguồn vé).*
6. Vào mục **Authentication** -> **Users** -> Bấm **Add user** -> Create new user.
   Tạo 1 tài khoản (Email + Mật khẩu) để cấp quyền cho Chủ shop mới (tài khoản này dùng để đăng nhập kết nối API).

### BƯỚC 2: CẬP NHẬT KẾT NỐI VÀO SOURCE CODE
Khách hàng cần sửa **2 file** để trỏ toàn bộ hệ thống về Database mới của họ:

1. Vào Supabase -> **Project Settings** (icon bánh răng) -> **API**.
2. Copy `Project URL` và `Project API Keys (anon, public)`.

**File thứ nhất — `sync.js`** (app chính, QUAN TRỌNG NHẤT):
3. Mở file **`sync.js`** bằng Notepad (hoặc VSCode).
4. Tìm đến **Dòng 29, 30** (gần đầu file):
   ```javascript
   const DEFAULT_SUPABASE_URL = 'https://...supabase.co';
   const DEFAULT_SUPABASE_KEY = 'eyJ...';
   ```
   Thay bằng `Project URL` và `Anon Key` của khách. Lưu file (`Ctrl + S`).
   > ⚠️ **Bắt buộc** — nếu bỏ qua bước này, dữ liệu của khách sẽ ghi vào Database của chủ mã nguồn!

**File thứ hai — `tracuu.html`** (trang tra cứu công khai):
5. Mở file **`tracuu.html`** bằng Notepad (hoặc VSCode).
6. Tìm đến **Dòng 15, 16**:
   ```javascript
   const SUPABASE_URL = 'ĐIỀN_PROJECT_URL_CỦA_KHÁCH_VÀO_ĐÂY';
   const SUPABASE_ANON_KEY = 'ĐIỀN_ANON_KEY_CỦA_KHÁCH_VÀO_ĐÂY';
   ```
   Dán thông tin của khách vào. Lưu file lại (`Ctrl + S`).

### BƯỚC 3: ĐƯA LÊN MẠNG & CHẠY CHÍNH THỨC (NETLIFY)
1. Khách hàng vào **[Netlify.com](https://app.netlify.com)** -> Đăng nhập/Đăng ký.
2. Bấm mục **Sites** -> Kéo xuống dưới cùng sẽ thấy ô viền nét đứt có chữ **"Drag and drop your site output folder here"**.
3. Kéo toàn bộ **thư mục code** (đã giải nén) thả vào ô đó.
4. Chờ 5 giây, Netlify sẽ cấp cho 1 đường link online (VD: `https://ten-shop-cua-khach.netlify.app`).
5. Vào đường link đó -> Bấm icon bánh răng (**Cài đặt**).
6. Dán `URL`, `Anon Key`, và `Email/Mật khẩu` (vừa tạo ở bước 1 Supabase) vào Cài đặt -> Bấm **Lưu & Kiểm tra**.
7. Báo "Kết nối Supabase Thành công" là XONG! 🎉

---

## PHẦN 3: CÁCH KHÁCH HÀNG TỰ BRANDING (ĐỔI TÊN THƯƠNG HIỆU)

Để hệ thống mang tên của khách hàng (VD: Vé Rẻ VIP thay vì BigBang CRM):
1. **Đổi chữ:** Mở file `index.html` và `manifest.json`, tìm tất cả chữ `BigBang CRM` đổi thành tên của họ.
2. **Đổi Logo:** Thay 2 hình ảnh `icon-192.png` và `icon-512.png` trong thư mục bằng logo của họ (bắt buộc giữ nguyên tên file là `icon-...png` và định dạng hình vuông).
3. Sau khi đổi, kéo thả lại thư mục lên **Netlify** để cập nhật. Nhớ đổi số `CACHE` trong file `sw.js` (ví dụ `v7` -> `v8`) để thiết bị tự xóa cache tải logo mới.

---

## 🎁 NHỮNG ĐIỂM "ĂN TIỀN" ĐỂ ANH CHÀO BÁN/BÀN GIAO CHO KHÁCH:
- **Tốc độ bàn thờ:** Không có độ trễ (0ms) do dùng IndexedDB local. Bấm là lưu.
- **Không bao giờ mất data:** Mất mạng wifi, tắt 4G vẫn tạo đơn bình thường. Có mạng hệ thống tự đẩy (Outbox Sync) lên cloud Supabase ẩn danh.
- **Tự động hóa tồn kho:** Không cần đếm tay. Đơn tạo có ghi số ghế -> tự trừ tồn kho -> tự liệt kê ghế đã bán.
- **Quản lý Nguồn vé thông minh:** Nhập một lần nhớ mãi mãi. Đơn hàng lưu lại nguồn lấy vé (BTC, đại lý, khách pass), hệ thống tự động gợi ý ở lần sau, giúp kiểm soát chéo cực kỳ dễ dàng.
- **Tra cứu an toàn:** Web có tra cứu online cho khách lẻ, nhưng được bảo mật RLS mã hóa tên (`N***A`), chống đối thủ cào data.
- **Không tốn tiền Server:** Hosting dùng Netlify Free, Database dùng Supabase Free (chịu tải 50,000 requests/tháng — dư xài cho 1 shop bán vé). Khách mua đứt 1 lần, không phí duy trì.
