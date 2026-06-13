# PRD — Mini-CRM Quản Lý Bán Vé Concert BigBang 2026

## Sản phẩm
Web app PWA mobile-first quản lý bán vé concert BigBang (24-25/10/2026, SVĐ Mỹ Đình).

## Đối tượng
- **Chủ shop (Quân):** 1 người chính, quản lý toàn bộ đơn hàng
- **CTV:** 1-2 cộng tác viên hỗ trợ bán

## Tiêu chí thành công
| Tiêu chí | Ngưỡng | Trạng thái |
|---|---|---|
| Nhập 1 đơn mới | < 30 giây | ✅ Đạt |
| Cảnh báo bán vượt tồn | 100% các trường hợp | ✅ Đạt |
| Sinh bill PNG | < 3 giây | ✅ Đạt |
| Follow-up đơn chưa cọc | Hiện đúng sau 24h | ✅ Đạt |
| Mobile usable | Mọi thao tác dùng được trên 375px | ✅ Đạt |
| Đồng bộ cloud | < 30 giây giữa 2 thiết bị | ✅ Đạt |
| Copy tin nhắn chốt đơn | 1 bước bấm/bôi đen | ✅ Đạt |
| Lưu email khách | Sẵn sàng gửi vé QR | ✅ Đạt |
| Gửi vé QR qua email | 1 bấm từ chi tiết đơn | ✅ Đạt |

## Kênh bán
Threads, Facebook Group, Zalo (cá nhân/OA)

## Quy mô
30-100 đơn/ngày cao điểm, tổng ~500-5000 đơn cả mùa.

## Tính năng đã triển khai (16 tính năng)
1. ✅ Dashboard tổng quan (stats + charts)
2. ✅ CRUD đơn hàng (tạo/sửa/xóa/soft-delete)
3. ✅ Quản lý tồn kho (Day 1 + Day 2)
4. ✅ Follow-up tự động (đơn quá hạn)
5. ✅ Pass vé ký gửi
6. ✅ Sinh Bill PNG có QR
7. ✅ Export Excel 3 sheet
8. ✅ Backup/Import JSON
9. ✅ Cloud sync 2 chiều + Realtime (Supabase)
10. ✅ Upload ảnh ủy nhiệm chi (Supabase Storage)
11. ✅ Copy tin nhắn chốt đơn
12. ✅ Trường email khách hàng
13. ✅ Tracking khách VIP (lịch sử mua)
14. ✅ Trang tra cứu đơn công khai (tracuu.html)
15. ✅ Biểu đồ doanh thu + hạng vé (Chart.js)
16. ✅ Gửi vé xác nhận qua email (EmailJS)

## Tính năng dự kiến (Kaizen tiếp theo)
- ⏳ Phân trang / Lazy Load (chuẩn bị cho 5000+ đơn)
- ⏳ Bảo mật nâng cao (bcrypt password, session timeout)
- ⏳ Dark/Light mode toggle
