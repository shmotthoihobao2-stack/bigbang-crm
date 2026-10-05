# PLAN R10 — Kaizen giai đoạn nước rút (05/10 → 25/10/2026)
> Người lập: Antigravity (05/10/2026). Người thực thi: agent khác. ĐỌC `HANDOFF.md` mục 4, 6, 8 TRƯỚC.
> Bối cảnh: còn 19 ngày tới show. Vé phát hành qua CTicket.vn, sold-out từ 08/2026, rủi ro lừa đảo QR/vé giả cao.
> Code đứng yên từ 31/07 (commit 7655b9a). Điểm hiện tại 6/10 — CHƯA verify LIVE.

## Nguyên tắc (cô Long + AGENTS.md)
- Giai đoạn nước rút = **ỔN ĐỊNH > TÍNH NĂNG**. Không đổi schema Dexie/Supabase trừ khi anh Quân duyệt.
- Mỗi việc 1 commit riêng → rollback được bằng `git revert`. Deploy CODE trước, SQL sau.
- Đóng băng code (freeze) từ **20/10**: chỉ vá P0.
- Không xoá file — dùng `node .claude/scripts/safe-delete.js`.

## Đánh giá tổng thể (05/10)
| Trụ cột | Điểm | Ghi chú |
|---|---|---|
| Nghiệp vụ tiền | 7 | 3 hàm dùng chung, test 8/8, chưa test tự động trong CI |
| Bảo mật | 6 | RLS `is_owner()` đã vá, CHƯA xác nhận tắt signup trên Dashboard |
| Đồng bộ | 6 | Nhiều vá race-condition, chưa test 2 máy thật |
| Vận hành ngày show | 3 | Chưa có luồng giao vé/check-in/hạn chót thanh toán |
| Kiểm thử/CI | 2 | 0 gate cú pháp trong `deploy.yml` |
| Vệ sinh repo | 5 | 4 file `_R9_*.sql-back-up` rác, file zip 59KB trong repo |

## Giai đoạn 0 — VERIFY LIVE (anh Quân tự làm, 30 phút, BẮT BUỘC trước mọi code)
- [ ] Supabase → Authentication → tắt "Allow new users to sign up".
- [ ] Authentication → Users: chỉ còn đúng email chủ shop.
- [ ] `select * from app_owner;` → đúng 1 dòng.
- [ ] Mở app trên ĐT + máy tính: tạo 1 đơn test ở máy A, thấy ở máy B ≤ 30s; xoá → khôi phục → không tự chui lại thùng rác.
- [ ] Bấm "Xuất backup" → lưu file JSON lên Google Drive.
**DoD:** 5/5 tick. Nếu fail mục nào → dừng, báo lại, KHÔNG code tiếp.

## Giai đoạn 1 — An toàn & CI (Rủi ro THẤP, ~1h)
1. `deploy.yml`: thêm bước `node --check app.js sync.js` trước deploy → fail thì không deploy.
2. Thêm `tests/money.test.js` (copy 8 kịch bản từ plan R9) chạy bằng `node` trong CI.
3. Dọn 4 file `_R9_*back-up*` + `bigbang-crm-ban-giao.zip` ra khỏi repo (safe-delete, hỏi anh trước).
4. Đổi Dexie CDN unpkg → jsdelivr (đồng nhất 5 lib khác), có pin version.
**DoD:** push 1 commit cố tình lỗi cú pháp → Action đỏ, site không đổi. Revert → xanh.

## Giai đoạn 2 — Vận hành nước rút (Rủi ro TRUNG BÌNH, cần duyệt câu hỏi bên dưới)
5. **Bảng "Việc cần làm trước show"** trên Dashboard: đơn còn thiếu tiền, đơn chưa giao vé, đơn `flex` chưa chốt ngày — sắp theo số ngày còn lại tới 24/10.
6. **Trạng thái giao vé CTicket**: dùng lại `combo_info`/`note` hoặc thêm cột `transfer_status` (chưa chuyển / đã chuyển tài khoản CTicket / khách xác nhận) — CẦN ANH CHỌN (xem câu hỏi 2).
7. **Script nhắn khách hàng loạt** theo mốc: T-7 nhắc thanh toán đủ, T-3 hướng dẫn vào cổng + cảnh báo lừa đảo, T-1 nhắc giờ 19:30 & cổng A/B/C theo hạng.
8. **Chế độ ngày show (offline)**: danh sách đơn theo ngày, tìm nhanh theo SĐT/tên, nút "Đã giao tay" — chạy được khi mạng Mỹ Đình nghẽn (Dexie local sẵn có).
**DoD:** mỗi tính năng test trên điện thoại thật; 0 đổi công thức tiền.

## Giai đoạn 3 — Sau show (26/10 →)
9. Báo cáo lợi nhuận cuối, xuất Excel, chốt sổ CTV.
10. Archive dữ liệu, khoá ghi, viết LESSONS vào `docs/JOURNEY.md`.

## KHÔNG làm (để dành sau show)
Dark/Light mode, sessionTimeout, refactor app.js 2.9k dòng.
