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
-- Nguyên tắc: chỉ chủ shop (đã đăng nhập) đọc/ghi được dữ liệu.
-- Người lạ (anon) KHÔNG đọc được gì — chỉ gọi được hàm tra cứu giới hạn.

alter table customers enable row level security;
alter table orders enable row level security;
alter table inventory enable row level security;
alter table resales enable row level security;
alter table app_settings enable row level security;

-- Chủ shop (authenticated) toàn quyền
drop policy if exists "owner all customers" on customers;
create policy "owner all customers" on customers for all to authenticated using (true) with check (true);
drop policy if exists "owner all orders" on orders;
create policy "owner all orders" on orders for all to authenticated using (true) with check (true);
drop policy if exists "owner all inventory" on inventory;
create policy "owner all inventory" on inventory for all to authenticated using (true) with check (true);
drop policy if exists "owner all resales" on resales;
create policy "owner all resales" on resales for all to authenticated using (true) with check (true);
drop policy if exists "owner all settings" on app_settings;
create policy "owner all settings" on app_settings for all to authenticated using (true) with check (true);

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
    and right(coalesce(c.phone, ''), 4) = right(trim(p_phone_last4), 4)
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

-- ===== STORAGE: bucket ảnh ủy nhiệm chi (idempotent) =====
-- Thiếu bucket này thì tính năng upload ảnh bill sẽ lỗi.
insert into storage.buckets (id, name, public)
values ('payment_proofs', 'payment_proofs', true)
on conflict (id) do nothing;

-- Quyền cho bucket: chủ shop (đăng nhập) toàn quyền; người lạ chỉ xem (bucket public để hiện ảnh trên bill).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='pp_authenticated_all') then
    create policy "pp_authenticated_all" on storage.objects
      for all to authenticated
      using (bucket_id = 'payment_proofs') with check (bucket_id = 'payment_proofs');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='pp_public_read') then
    create policy "pp_public_read" on storage.objects
      for select to anon using (bucket_id = 'payment_proofs');
  end if;
end $$;

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
grant execute on function public.next_order_code() to authenticated;

-- ===== XONG! =====
-- Bước tiếp theo: vào Authentication > Users > Add user
-- tạo email + mật khẩu cho chủ shop, rồi nhập vào phần Cài đặt của app.
