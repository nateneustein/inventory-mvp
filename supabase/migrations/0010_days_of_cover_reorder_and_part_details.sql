-- 0010 — Days-of-cover reorder trigger + part ordering details
--
-- The reorder trigger stops being a fixed quantity. A fixed number goes stale
-- the moment a product gets more or less popular, so instead each part carries
-- a WINDOW: "tell me if this is going to run out within N days". The system
-- works out days of cover from real usage and compares against that window.
--
-- reorder_point, target_stock, safety_stock_days and the lead time fields all
-- stay. They are reference information for whoever places the order. They no
-- longer trigger anything.

-- 1. Trigger setting + informational ordering fields
alter table public.parts
  add column if not exists reorder_horizon_days numeric not null default 90,
  add column if not exists unit_price numeric,
  add column if not exists currency text default 'USD',
  add column if not exists moq numeric,
  add column if not exists order_multiple numeric,
  add column if not exists size_dimensions text,
  add column if not exists color_finish text,
  add column if not exists material_spec text,
  add column if not exists supplier_link text,
  add column if not exists supplier_order_instructions text,
  add column if not exists packaging_notes text,
  add column if not exists backup_supplier_id uuid references public.suppliers(id),
  add column if not exists backup_supplier_notes text;

comment on column public.parts.reorder_horizon_days is
  'THE reorder trigger. If projected stock (on hand + incoming) will run out within this many days at the fastest observed usage rate, the part flags reorder_now. Set per part. Default 90 days (3 months).';
comment on column public.parts.reorder_point is
  'INFORMATIONAL ONLY as of migration 0010. No longer triggers alerts.';
comment on column public.parts.target_stock is
  'INFORMATIONAL ONLY. The level to refill up to when ordering. Does not trigger alerts.';
comment on column public.parts.safety_stock_days is
  'INFORMATIONAL ONLY. Does not trigger alerts.';
comment on column public.parts.lead_time_days_min is 'INFORMATIONAL ONLY. Does not trigger alerts.';
comment on column public.parts.lead_time_days_max is 'INFORMATIONAL ONLY. Does not trigger alerts.';
comment on column public.parts.supplier_order_instructions is
  'What to tell the supplier when ordering this part: specs, finish, tolerances, marking, anything the buyer must repeat every time.';

-- 2. The trigger itself: days of cover vs each part's own window.
--
-- Three usage paces are computed (1 week, 4 week, 3 month). The FASTEST one
-- wins, because any one of them predicting a run-out inside the window is
-- reason enough to order.
create or replace view public.inventory_status as
with r as (
  select w.part_id,
         case when w.usage_7  > 0 then w.usage_7  / 7.0  else 0 end as daily_rate_7,
         case when w.usage_28 > 0 then w.usage_28 / 28.0 else 0 end as daily_rate_28,
         case when w.usage_90 > 0 then w.usage_90 / 90.0 else 0 end as daily_rate_90
  from public.part_usage_windows w
),
c as (
  select ps.part_id,
         ps.on_hand + coalesce(pi.incoming_qty, 0) as projected,
         greatest(coalesce(r.daily_rate_7,0), coalesce(r.daily_rate_28,0), coalesce(r.daily_rate_90,0)) as fastest
  from public.part_stock ps
  left join public.part_incoming pi on pi.part_id = ps.part_id
  left join r on r.part_id = ps.part_id
)
select
  ps.part_id,
  ps.name,
  ps.sku,
  ps.category,
  ps.unit,
  ps.critical,
  ps.reorder_point,
  ps.target_stock,
  ps.default_order_quantity,
  ps.active,
  ps.ignore_alerts,
  ps.sort_order,
  ps.on_hand,
  coalesce(pi.incoming_qty, 0) as incoming_qty,
  ps.on_hand + coalesce(pi.incoming_qty, 0) as projected_qty,
  case
    when c.projected <= 0 then 'out'
    when c.fastest <= 0 then 'ok'
    when c.projected / c.fastest <= p.reorder_horizon_days then 'reorder_now'
    when c.projected / c.fastest <= p.reorder_horizon_days * 1.25 then 'getting_low'
    else 'ok'
  end as stock_status,
  p.reorder_horizon_days,
  round(coalesce(r.daily_rate_7,0), 4)  as daily_rate_7,
  round(coalesce(r.daily_rate_28,0), 4) as daily_rate_28,
  round(coalesce(r.daily_rate_90,0), 4) as daily_rate_90,
  round(c.fastest, 4) as fastest_daily_rate,
  case when c.fastest > 0 then round(c.projected / c.fastest, 1) end as days_of_cover,
  case when c.fastest > 0 then round(c.projected / c.fastest / 7.0, 1) end as weeks_of_cover,
  case when coalesce(r.daily_rate_7,0)  > 0 then round(c.projected / r.daily_rate_7,  1) end as days_of_cover_1wk_rate,
  case when coalesce(r.daily_rate_28,0) > 0 then round(c.projected / r.daily_rate_28, 1) end as days_of_cover_4wk_rate,
  case when coalesce(r.daily_rate_90,0) > 0 then round(c.projected / r.daily_rate_90, 1) end as days_of_cover_3mo_rate,
  case
    when c.fastest <= 0 then null
    when coalesce(r.daily_rate_7,0)  >= c.fastest then '1 week pace'
    when coalesce(r.daily_rate_28,0) >= c.fastest then '4 week pace'
    else '3 month pace'
  end as driving_rate,
  case when c.fastest > 0
       then (current_date + ((c.projected / c.fastest))::int)
  end as projected_runout_date
from public.part_stock ps
join public.parts p on p.id = ps.part_id
join c on c.part_id = ps.part_id
left join public.part_incoming pi on pi.part_id = ps.part_id
left join r on r.part_id = ps.part_id;

-- 3. Add-your-own labelled lines per part, so new kinds of ordering
--    information do not need a migration every time.
create table if not exists public.part_custom_fields (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  label text not null,
  value text,
  sort_order integer not null default 100,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists part_custom_fields_part_id_idx on public.part_custom_fields(part_id);
alter table public.part_custom_fields enable row level security;

drop policy if exists read_all_signed_in on public.part_custom_fields;
create policy read_all_signed_in on public.part_custom_fields
  for select to authenticated using (true);
drop policy if exists write_manager_admin on public.part_custom_fields;
create policy write_manager_admin on public.part_custom_fields
  for insert to authenticated with check (public.is_manager_or_admin());
drop policy if exists update_manager_admin on public.part_custom_fields;
create policy update_manager_admin on public.part_custom_fields
  for update to authenticated using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());
drop policy if exists delete_manager_admin on public.part_custom_fields;
create policy delete_manager_admin on public.part_custom_fields
  for delete to authenticated using (public.is_manager_or_admin());

-- 4. Photos and files per part — the images and specs the buyer sends to the
--    supplier ("we want this one, in this colour").
create table if not exists public.part_files (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  kind text not null default 'supplier_spec'
    check (kind in ('supplier_spec','reference_photo','packaging','label_artwork','invoice','other')),
  caption text,
  send_to_supplier boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists part_files_part_id_idx on public.part_files(part_id);
alter table public.part_files enable row level security;

drop policy if exists read_all_signed_in on public.part_files;
create policy read_all_signed_in on public.part_files
  for select to authenticated using (true);
drop policy if exists write_manager_admin on public.part_files;
create policy write_manager_admin on public.part_files
  for insert to authenticated with check (public.is_manager_or_admin());
drop policy if exists update_manager_admin on public.part_files;
create policy update_manager_admin on public.part_files
  for update to authenticated using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());
drop policy if exists delete_manager_admin on public.part_files;
create policy delete_manager_admin on public.part_files
  for delete to authenticated using (public.is_manager_or_admin());

comment on column public.part_files.send_to_supplier is
  'Flag the files the buyer should attach when placing the order with the supplier.';

-- 5. Private bucket for those files. Private on purpose: downloads go through
--    a short-lived signed link so nothing is guessable from the open internet.
insert into storage.buckets (id, name, public, file_size_limit)
values ('part-files', 'part-files', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "part_files_read_signed_in" on storage.objects;
create policy "part_files_read_signed_in" on storage.objects
  for select to authenticated
  using (bucket_id = 'part-files');

drop policy if exists "part_files_insert_manager_admin" on storage.objects;
create policy "part_files_insert_manager_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'part-files' and public.is_manager_or_admin());

drop policy if exists "part_files_update_manager_admin" on storage.objects;
create policy "part_files_update_manager_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'part-files' and public.is_manager_or_admin())
  with check (bucket_id = 'part-files' and public.is_manager_or_admin());

drop policy if exists "part_files_delete_manager_admin" on storage.objects;
create policy "part_files_delete_manager_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'part-files' and public.is_manager_or_admin());
