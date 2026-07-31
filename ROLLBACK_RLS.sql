-- ===================================================================
-- ĐƯỜNG LÙI KHẨN CẤP — chỉ chạy khi app KHÔNG đồng bộ được cloud
-- ===================================================================
-- Khi nào dùng: sau khi siết RLS theo is_owner() (R9, 31/07/2026), anh mở app
-- mà chấm đồng bộ ĐỎ / báo "chưa đồng bộ được" → nghĩa là is_owner() không trả
-- true cho chính tài khoản chủ shop → anh đang bị khoá khỏi cloud.
--
-- File này đưa quyền về trạng thái CŨ (mọi tài khoản đăng nhập được đều toàn
-- quyền) để cloud chạy lại NGAY. Dữ liệu KHÔNG bị đụng tới — chỉ đổi policy.
--
-- ⚠️ SAU KHI CHẠY FILE NÀY: signup vẫn đang TẮT nên vẫn an toàn tương đối
-- (không ai tự đăng ký được). Nhưng lời hứa "lỡ signup bật lại thì cửa vẫn
-- khoá" sẽ mất → báo lại để sửa đúng thiết kế rồi siết lại.
--
-- Cách dùng: Supabase Dashboard > SQL Editor > New query > dán > RUN
-- ===================================================================

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

-- Ảnh uỷ nhiệm chi: đưa về policy cũ (phòng khi đã kịp siết sang is_owner())
drop policy if exists "pp_owner_all" on storage.objects;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='pp_authenticated_all') then
    create policy "pp_authenticated_all" on storage.objects
      for all to authenticated
      using (bucket_id = 'payment_proofs') with check (bucket_id = 'payment_proofs');
  end if;
end $$;

-- Kiểm chứng: liệt kê policy hiện tại của 5 bảng (phải thấy qual = true)
select tablename, policyname, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('customers','orders','inventory','resales','app_settings')
order by tablename;
