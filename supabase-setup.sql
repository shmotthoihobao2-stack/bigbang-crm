-- ===================================================================
-- BIGBANG CRM — Cài đặt Supabase (chạy 1 lần)
-- Cách dùng: vào Supabase Dashboard > SQL Editor > New query
--            > dán toàn bộ file này > bấm RUN
-- ===================================================================

-- ===== 1. BẢNG DỮ LIỆU =====
create table if not exists customers (
  uuid text primary key,
  name text,
  phone text,
  email text default '',
  zalo text,
  social text,
  source text,
  note text,
  created_at timestamptz,
  updated_at timestamptz default now(),
  deleted boolean default false
);

create table if not exists orders (
  uuid text primary key,
  order_code text,
  customer_uuid text,
  show_day text,
  ticket_tier text,
  quantity int,
  unit_price bigint,
  cost_price bigint default 0,
  total bigint,
  deposit_amount bigint,
  status text,
  delivery_method text,
  ctv text,
  payment_proof text default '',
  seat_number text default '',
  ticket_source text default '',
  combo_info text default '',
  note text,
  created_at timestamptz,
  updated_at timestamptz default now(),
  deleted boolean default false
);

-- Migration: thêm cột giá vốn theo từng đơn cho DB đã tạo trước đó (an toàn chạy lại)
alter table orders add column if not exists cost_price bigint default 0;

create table if not exists inventory (
  uuid text primary key,
  show_day text,
  ticket_tier text,
  total_stock int,
  cost_price bigint,
  updated_at timestamptz default now(),
  deleted boolean default false
);

create table if not exists resales (
  uuid text primary key,
  order_uuid text,
  order_code text,
  customer_name text,
  customer_phone text,
  show_day text,
  ticket_tier text,
  quantity int,
  original_price bigint,
  asking_price bigint,
  service_fee bigint,
  seat_number text default '',
  reason text,
  note text,
  status text,
  created_at timestamptz,
  updated_at timestamptz default now(),
  deleted boolean default false
);

create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create index if not exists idx_orders_code on orders(order_code);
create index if not exists idx_orders_updated on orders(updated_at);
create index if not exists idx_customers_updated on customers(updated_at);
create index if not exists idx_resales_updated on resales(updated_at);
create index if not exists idx_inventory_updated on inventory(updated_at);

-- ===== 2. BẢO MẬT (RLS) =====
-- R9 audit (31/07/2026): "to authenticated using(true)" từng cho phép BẤT KỲ ai tự
-- POST /auth/v1/signup (đăng ký mở mặc định) rồi có toàn quyền SELECT/UPDATE/DELETE cả
-- 5 bảng. Anon key nằm public trong repo (sync.js, tracuu.html) nên ai cũng lấy được.
-- Vá gốc (không chỉ tắt signup — phòng khi lỡ bật lại): khoá cứng vào ĐÚNG 1 UID chủ shop
-- qua bảng `app_owner` (không policy nào -> không ai SELECT/INSERT trực tiếp được, chỉ 2 hàm
-- security definer dưới đây được phép đụng vào). Tài khoản authenticated ĐẦU TIÊN gọi
-- claim_owner() sau khi chạy file này sẽ là chủ shop vĩnh viễn; các is_owner() sau đó chỉ
-- đúng người đó mới true. ⚠️ TRƯỚC KHI CHẠY: vào Authentication > Users xác nhận CHỈ có
-- đúng email của chủ shop (không có tài khoản lạ nào) — nếu có, xoá tài khoản lạ TRƯỚC.

create table if not exists app_owner (
  id boolean primary key default true,
  uid uuid,
  constraint app_owner_singleton check (id)
);
alter table app_owner enable row level security;
-- Không tạo policy nào cho app_owner -> kể cả authenticated cũng KHÔNG SELECT/INSERT trực
-- tiếp được; chỉ 2 hàm security definer bên dưới (chạy với quyền chủ DB) mới đọc/ghi được.

create or replace function public.claim_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_owner (id, uid) values (true, auth.uid())
  on conflict (id) do update set uid = excluded.uid
  where app_owner.uid is null; -- chỉ set khi CHƯA có ai claim -> chống người thứ 2 giành quyền
end;
$$;
-- ⚠️ R9 (verify LIVE 31/07 phát hiện): "revoke ... from public" KHÔNG đủ trên Supabase — project
-- tự cấp EXECUTE cho anon/authenticated TRỰC TIẾP (không qua PUBLIC) mỗi khi tạo hàm mới (ALTER
-- DEFAULT PRIVILEGES ở tầng project), nên revoke-from-public không chặn được `anon`. Test thật
-- bằng curl xác nhận: gọi next_order_code() bằng anon key VẪN THÀNH CÔNG dù đã revoke from public.
-- Phải revoke đích danh `anon` (và `authenticated` trước khi grant lại) mới chặn đúng.
revoke all on function public.claim_owner() from public, anon, authenticated;
grant execute on function public.claim_owner() to authenticated;

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from app_owner where uid = auth.uid());
$$;
revoke all on function public.is_owner() from public, anon, authenticated;
grant execute on function public.is_owner() to authenticated;

alter table customers enable row level security;
alter table orders enable row level security;
alter table inventory enable row level security;
alter table resales enable row level security;
alter table app_settings enable row level security;

-- Chủ shop (đúng 1 UID đã claim) toàn quyền — KHÔNG còn "mọi authenticated" nữa.
drop policy if exists "owner all customers" on customers;
create policy "owner all customers" on customers for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists "owner all orders" on orders;
create policy "owner all orders" on orders for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists "owner all inventory" on inventory;
create policy "owner all inventory" on inventory for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists "owner all resales" on resales;
create policy "owner all resales" on resales for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists "owner all settings" on app_settings;
create policy "owner all settings" on app_settings for all to authenticated using (is_owner()) with check (is_owner());

-- Anon: KHÔNG có policy nào => không select/insert/update/delete được gì cả.

-- ===== 3. HÀM TRA CỨU CÔNG KHAI (cho trang tracuu.html) =====
-- Khách nhập MÃ ĐƠN + 4 SỐ CUỐI SĐT => chỉ trả về thông tin an toàn,
-- tên đã che, KHÔNG lộ SĐT đầy đủ, không lộ khách khác.

create or replace function public.lookup_order(p_code text, p_phone_last4 text)
returns table (
  order_code text,
  customer_masked text,
  show_day text,
  ticket_tier text,
  quantity int,
  total bigint,
  deposit_amount bigint,
  status text,
  delivery_method text,
  seat_number text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.order_code,
    case
      when c.name is null or length(c.name) < 2 then c.name
      else left(c.name, 1) || repeat('*', greatest(length(c.name) - 2, 1)) || right(c.name, 1)
    end as customer_masked,
    o.show_day,
    o.ticket_tier,
    o.quantity,
    o.total,
    o.deposit_amount,
    o.status,
    o.delivery_method,
    o.seat_number,
    o.updated_at
  from orders o
  left join customers c on c.uuid = o.customer_uuid
  where upper(trim(o.order_code)) = upper(trim(p_code))
    -- Ép chính hàm tự bảo vệ (không tin client): phải đủ 4 số cuối + khách PHẢI có SĐT.
    -- Thiếu guard này: anon gọi RPC trực tiếp với last4='' -> khớp mọi khách phone NULL -> lộ đơn.
    and length(trim(p_phone_last4)) = 4
    and c.phone is not null and length(c.phone) >= 4
    and right(c.phone, 4) = right(trim(p_phone_last4), 4)
    and o.deleted = false
  limit 1;
$$;

-- Cho phép người lạ gọi DUY NHẤT hàm này
revoke all on function public.lookup_order(text, text) from public;
grant execute on function public.lookup_order(text, text) to anon;
grant execute on function public.lookup_order(text, text) to authenticated;

-- ===== NÂNG CẤP DB CŨ (idempotent — chạy lại không hỏng) =====
-- Nếu DB đã tạo trước Kaizen 2 (upload ảnh) và Kaizen 3.5 (email):
alter table if exists orders add column if not exists payment_proof text default '';
alter table if exists customers add column if not exists email text default '';

-- ===== REALTIME: bật đồng bộ tức thời giữa điện thoại & máy tính (idempotent) =====
-- Thiếu bước này thì 2 máy KHÔNG tự cập nhật cho nhau khi có đơn mới.
do $$
declare t text;
begin
  foreach t in array array['orders','customers','inventory','resales'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ===== STORAGE: bucket ảnh ủy nhiệm chi — PRIVATE (idempotent) =====
-- Thiếu bucket này thì tính năng upload ảnh bill sẽ lỗi.
-- Ảnh bill chứa tên + STK + nội dung CK của khách => bucket PRIVATE, app sinh signed URL tạm khi xem.
insert into storage.buckets (id, name, public)
values ('payment_proofs', 'payment_proofs', false)
on conflict (id) do nothing;
-- Nếu bucket đã tồn tại (setup cũ để public=true) -> ép về private.
update storage.buckets set public = false where id = 'payment_proofs';

-- Quyền cho bucket: CHỈ ĐÚNG chủ shop (is_owner()) — khớp với 5 bảng dữ liệu.
--
-- ⚠️ BÀI HỌC R9 (31/07/2026): trước đây policy chỉ là `to authenticated using (bucket_id=...)`,
-- tức MỌI tài khoản đăng nhập được đều xem/tải được ảnh bill (chứa tên khách + STK + số tiền).
-- Tệ hơn: khi kiểm `pg_policies` mới lòi ra 4 policy "Cho phep upload 1jmfb48_0..3" do tạo tay
-- qua Dashboard, KHÔNG hề có trong file này. Postgres nối policy bằng HOẶC nên chỉ cần 1 cái mở
-- là mọi ổ khoá khác vô tác dụng => phải DỌN SẠCH policy lạ trên bucket này, không chỉ thêm mới.
--
-- => LUẬT: đụng tới quyền thì đọc `pg_policies` TRƯỚC (trạng thái THẬT của DB), không tin file setup.

-- B1: dọn MỌI policy khác trên storage.objects, kể cả tạo tay qua Dashboard.
-- ⚠️ Review độc lập (Gemini, 31/07) chỉ ra đúng: bản đầu chỉ LIKE '%payment_proofs%' nên sẽ BỎ SÓT
-- 1 policy "mù" kiểu using(true) không hề nhắc tên bucket nào (áp cho MỌI bucket, kể cả cái này) —
-- Postgres nối policy bằng HOẶC nên chỉ cần sót 1 cái mở là is_owner() vô tác dụng. Đã tự kiểm LIVE
-- bằng query pg_policies KHÔNG lọc gì: hiện tại không có policy nào như vậy — nhưng script này có
-- thể chạy lại nhiều lần trong tương lai, nên dọn SẠCH TOÀN BỘ (trừ pp_owner_all) chứ không lọc theo
-- nội dung nữa, để không phụ thuộc vào việc policy tương lai có nhắc tên bucket hay không.
-- ⚠️ Giả định: dự án chỉ có ĐÚNG 1 bucket (`payment_proofs`) — đã kiểm grep toàn repo xác nhận
-- (31/07/2026). Nếu sau này thêm bucket thứ 2, đoạn dọn "sạch toàn bộ" này PHẢI đổi lại thành lọc
-- theo bucket_id, nếu không sẽ xoá luôn policy của bucket mới.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname <> 'pp_owner_all'
  loop
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;
end $$;
drop policy if exists "pp_public_read" on storage.objects;      -- policy cũ cho anon đọc
drop policy if exists "pp_authenticated_all" on storage.objects; -- policy cũ chưa gate is_owner()

-- B2: dựng lại đúng 1 policy, khoá theo is_owner().
drop policy if exists "pp_owner_all" on storage.objects;
create policy "pp_owner_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'payment_proofs' and is_owner())
  with check (bucket_id = 'payment_proofs' and is_owner());

-- ===== CHỐNG TRÙNG MÃ ĐƠN: sequence cấp số NGUYÊN TỬ (idempotent) =====
-- Thiếu phần này: 2 máy tạo đơn gần như cùng lúc sẽ đọc cùng MAX -> đẻ TRÙNG mã (BB-0042 x2).
-- Có sequence: mỗi lần gọi next_order_code() trả 1 số duy nhất, không bao giờ trùng dù bao nhiêu máy.
create sequence if not exists order_code_seq;

-- Seed sequence = (số đơn lớn nhất hiện có) + 1, để mã đơn chạy tiếp không nhảy/lùi.
-- is_called=false => lần nextval() đầu tiên trả về đúng giá trị này.
select setval(
  'order_code_seq',
  coalesce(
    (select max((regexp_replace(order_code, '\D', '', 'g'))::bigint)
       from orders where order_code ~ '^BB-[0-9]+$'),
    0
  ) + 1,
  false
);

create or replace function public.next_order_code()
returns text
language sql
security definer
set search_path = public
as $$
  select 'BB-' || lpad(nextval('order_code_seq')::text, 4, '0');
$$;
-- R9 audit + verify LIVE: thiếu revoke -> `anon` gọi được RPC này để đốt số thứ tự (nextval) dù
-- không đăng nhập (test thật bằng curl xác nhận: gọi bằng anon key trả về 'BB-0022' thành công).
-- revoke đích danh `anon`/`authenticated` (không chỉ `public` — xem comment ở claim_owner phía
-- trên) rồi mới grant lại đúng người cần.
revoke all on function public.next_order_code() from public, anon, authenticated;
grant execute on function public.next_order_code() to authenticated;

-- ===== XONG! =====
-- Bước tiếp theo:
-- 1. Vào Authentication > Users > xác nhận CHỈ có đúng 1 tài khoản (email chủ shop).
--    Nếu chưa có, bấm Add user tạo email + mật khẩu, rồi nhập vào phần Cài đặt của app.
-- 2. Vào Authentication > Sign In / Providers > tắt "Allow new users to sign up"
--    (chặn người lạ tự đăng ký để giành quyền `authenticated`).
-- 3. Mở app, đăng xuất rồi đăng nhập lại cloud Supabase 1 LẦN — lần đăng nhập này sẽ tự động
--    gọi claim_owner() và khoá quyền chủ vĩnh viễn vào đúng tài khoản đó (xem sync.js).
