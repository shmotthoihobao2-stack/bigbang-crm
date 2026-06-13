# SPEC — Kiến trúc & Thiết kế kỹ thuật BigBang CRM

## Tech Stack
| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| Frontend | HTML5 + Vanilla CSS + Vanilla JS (SPA) | — |
| Local DB | IndexedDB via Dexie.js | v3 |
| Cloud DB | Supabase (PostgreSQL + Auth) | v2 |
| Cloud Storage | Supabase Storage (bucket: payment_proofs) | — |
| Charts | Chart.js | v4.4.0 |
| Bill PNG | html2canvas | v1.4.1 |
| QR Code | qrcode-generator | v1.4.4 |
| Export Excel | SheetJS (xlsx) | v0.20.3 |
| Font | Google Fonts — Inter | 400-700 |
| Hosting | Netlify (CI/CD từ GitHub) | — |
| Version Control | GitHub | — |

## Tại sao không dùng framework?
- Ưu tiên NHANH, không cần build step
- 1-2 người dùng, không cần backend phức tạp
- Dexie.js + Supabase đủ cho quy mô 5000+ đơn
- Static files → deploy miễn phí, nhanh, không cần server

---

## Data Schema

### IndexedDB (Dexie.js v3) — Local

#### customers
```
++id, name, phone, email, zalo, social, source, note, created_at
```
| Trường | Kiểu | Mô tả |
|---|---|---|
| id | auto++ | ID local |
| uuid | string | UUID đồng bộ cloud |
| name | string | Tên khách |
| phone | string | SĐT (unique, dùng để lookup) |
| email | string | Email (để gửi vé QR) |
| zalo | string | Link/số Zalo |
| social | string | Link Facebook/Threads |
| source | string | Nguồn khách (threads/fb_group/zalo/referral/khác) |
| note | string | Ghi chú |
| created_at | ISO string | Ngày tạo |

#### orders
```
++id, order_code, customer_id, show_day, ticket_tier, quantity, unit_price, total, deposit_amount, status, payment_proof, delivery_method, ctv, note, created_at, updated_at
```
| Trường | Kiểu | Mô tả |
|---|---|---|
| id | auto++ | ID local |
| uuid | string | UUID đồng bộ cloud |
| order_code | string | Mã đơn (BB-XXXX) |
| customer_id | int | FK → customers.id |
| show_day | string | day1 / day2 / both |
| ticket_tier | string | Hạng vé (VIP, CAT1...) |
| quantity | int | Số lượng |
| unit_price | int | Đơn giá (VNĐ) |
| total | int | Tổng tiền |
| deposit_amount | int | Tiền cọc |
| status | string | mới/đã cọc/đã thanh toán đủ/đã giao vé/hoàn cọc/hủy |
| payment_proof | string | URL ảnh ủy nhiệm chi (Supabase Storage) |
| delivery_method | string | giao tận tay/gửi ship/e-ticket/nhận tại sân |
| seat_number | string | Số ghế / vị trí |
| ticket_source | string | Nguồn vé (BTC, đại lý...) |
| combo_info | string | Dịch vụ kèm (vé bay, KS...) |
| ctv | string | CTV phụ trách |
| note | string | Ghi chú |
| deleted_at | ISO string | Soft delete (thùng rác 30 ngày) |

#### inventory
```
++id, show_day, ticket_tier, total_stock, cost_price
```

#### settings
```
key (primary), value
```
Keys: password, ticketTiers, shopName, shopPhone, shopZalo, ctvList, supabaseUrl, supabaseKey, supabaseEmail, supabasePassword

#### resales
```
++id, order_id, customer_name, status, created_at
```

---

### Supabase (Cloud) — SQL Tables

> File SQL setup: `supabase-setup.sql`
> **Sau Kaizen 3.5 cần chạy thêm:**
> ```sql
> ALTER TABLE public.customers ADD COLUMN email text DEFAULT '';
> ```

---

## Cấu trúc file

```
bigbang-crm/
├── index.html          # SPA chính (login + 6 tabs + 5 modals)
├── app.js              # Logic nghiệp vụ (~2400 dòng)
├── sync.js             # Đồng bộ Supabase 2 chiều (~530 dòng)
├── style.css           # UI/UX dark theme (~1100 dòng)
├── sw.js               # Service Worker (đã vô hiệu hóa)
├── manifest.json       # PWA manifest
├── icon-192.png        # App icon
├── icon-512.png        # App icon lớn
├── tracuu.html         # Trang tra cứu đơn công khai
├── supabase-setup.sql  # SQL tạo bảng Supabase
├── HUONG_DAN.md        # Hướng dẫn sử dụng cho chủ shop
├── SETUP_NANG_CAP.md   # Hướng dẫn cài đặt Supabase
├── HD_NHAN_BAN_CRM.md  # Hướng dẫn nhân bản cho shop khác
└── docs/
    ├── PRD.md           # Product Requirements
    ├── SPEC.md          # Technical Specification (file này)
    ├── PLAN.md          # Kế hoạch phát triển
    └── JOURNEY.md       # Nhật ký phát triển & Kaizen
```

---

## Luồng đồng bộ Cloud (sync.js)

```
[User thao tác] → Dexie Hook (creating/updating) → Outbox Queue
    → debounce 1.5s → processOutbox() → Supabase upsert
    
[Auto-sync mỗi 30s] → pullAll() → So sánh updated_at → Cập nhật local
```

- **UUID mapping:** Mỗi record local có `uuid` để map với cloud
- **Conflict resolution:** Cloud updated_at mới hơn → ghi đè local
- **Soft delete:** Đánh dấu `deleted: true` thay vì xóa hẳn

---

## UI Tabs
1. **📊 Tổng quan** — Dashboard stats + charts
2. **🎫 Đơn hàng** — CRUD + filter + search + detail modal
3. **📦 Tồn kho** — Inventory theo Day 1/Day 2
4. **🔔 Cần xử lý** — Follow-up đơn quá hạn
5. **🔁 Pass vé** — Ký gửi pass vé
6. **⚙️ Cài đặt** — Hạng vé, CTV, cloud sync, export, thùng rác
