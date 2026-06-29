-- Run this after 0001_inventory_mvp.sql.
-- This upgrade adds spreadsheet uploads, imported order rows, mapping rules, switches, zero reports, predictions, and Slack settings.

create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('etsy','amazon','tiktok','shopify')),
  account_name text not null,
  file_name text not null,
  row_count integer not null default 0,
  status text not null default 'uploaded' check (status in ('uploaded','processed','failed')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.imported_order_rows (
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.upload_batches(id) on delete set null,
  platform text not null check (platform in ('etsy','amazon','tiktok','shopify')),
  account_name text not null,
  source_row_number integer,
  platform_order_id text,
  order_date text,
  item_name text,
  platform_sku text,
  variation_text text,
  customization_text text,
  quantity numeric not null default 1,
  order_status text,
  mapping_status text not null default 'unmapped' check (mapping_status in ('unmapped','mapped','ignored','needs_review')),
  mapped_variation_id uuid references public.product_variations(id) on delete set null,
  demand_variation_id uuid references public.product_variations(id) on delete set null,
  raw_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(platform, account_name, platform_order_id, platform_sku, item_name, variation_text, source_row_number)
);

create table if not exists public.product_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('etsy','amazon','tiktok','shopify','all')),
  account_name text,
  match_type text not null default 'contains' check (match_type in ('contains','equals','starts_with')),
  match_field text not null default 'sku' check (match_field in ('sku','item_name','variation','customization')),
  match_value text not null,
  variation_id uuid not null references public.product_variations(id) on delete cascade,
  demand_variation_id uuid references public.product_variations(id) on delete set null,
  priority integer not null default 100,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_switches (
  id uuid primary key default gen_random_uuid(),
  from_part_id uuid references public.parts(id) on delete set null,
  to_part_id uuid not null references public.parts(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  change_type text not null check (change_type in ('voluntary_customer_change','forced_due_to_stockout')),
  order_reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.zero_stock_reports (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete restrict,
  system_quantity_at_report numeric not null default 0,
  warehouse_quantity_reported numeric not null default 0,
  order_reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'info' check (level in ('info','warning','urgent')),
  title text not null,
  message text,
  source_type text,
  source_id uuid,
  acknowledged_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.slack_notification_settings (
  id uuid primary key default gen_random_uuid(),
  channel_name text not null,
  notify_low_stock boolean not null default true,
  notify_overdue_shipments boolean not null default true,
  notify_zero_stock boolean not null default true,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.prediction_snapshots (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete restrict,
  calculation_type text not null default 'advanced',
  current_on_hand numeric not null default 0,
  incoming_qty numeric not null default 0,
  last_7_days_usage numeric not null default 0,
  last_30_days_usage numeric not null default 0,
  last_90_days_usage numeric not null default 0,
  lead_time_days numeric not null default 0,
  buffer_days numeric not null default 0,
  low_recommendation numeric not null default 0,
  normal_recommendation numeric not null default 0,
  safe_recommendation numeric not null default 0,
  very_safe_recommendation numeric not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_imported_order_rows_platform on public.imported_order_rows(platform, account_name);
create index if not exists idx_imported_order_rows_order_id on public.imported_order_rows(platform_order_id);
create index if not exists idx_imported_order_rows_mapping_status on public.imported_order_rows(mapping_status);
create index if not exists idx_mapping_rules_variation_id on public.product_mapping_rules(variation_id);
create index if not exists idx_zero_stock_reports_part_id on public.zero_stock_reports(part_id);
create index if not exists idx_inventory_switches_to_part_id on public.inventory_switches(to_part_id);
create index if not exists idx_prediction_snapshots_part_id on public.prediction_snapshots(part_id);

create or replace view public.overdue_open_po_items
with (security_invoker = true)
as
select *
from public.open_po_items
where expected_date is not null
  and expected_date < current_date
  and remaining_qty > 0;

create or replace view public.imported_order_summary
with (security_invoker = true)
as
select
  platform,
  account_name,
  count(*)::integer as imported_rows,
  count(*) filter (where mapping_status = 'mapped')::integer as mapped_rows,
  count(*) filter (where mapping_status = 'unmapped')::integer as unmapped_rows,
  max(created_at) as last_imported_at
from public.imported_order_rows
group by platform, account_name;

create or replace view public.part_usage_weekly
with (security_invoker = true)
as
select
  p.id as part_id,
  p.name,
  p.sku,
  date_trunc('week', im.created_at)::date as period_start,
  sum(abs(im.quantity)) filter (where im.quantity < 0)::numeric as used_qty
from public.parts p
left join public.inventory_movements im on im.part_id = p.id
group by p.id, p.name, p.sku, date_trunc('week', im.created_at)::date;

create or replace view public.part_usage_monthly
with (security_invoker = true)
as
select
  p.id as part_id,
  p.name,
  p.sku,
  date_trunc('month', im.created_at)::date as period_start,
  sum(abs(im.quantity)) filter (where im.quantity < 0)::numeric as used_qty
from public.parts p
left join public.inventory_movements im on im.part_id = p.id
group by p.id, p.name, p.sku, date_trunc('month', im.created_at)::date;

create or replace view public.dead_stock_candidates
with (security_invoker = true)
as
select
  ist.part_id,
  ist.name,
  ist.sku,
  ist.on_hand,
  max(im.created_at) filter (where im.quantity < 0) as last_used_at,
  case
    when max(im.created_at) filter (where im.quantity < 0) is null then 'never_used'
    when max(im.created_at) filter (where im.quantity < 0) < now() - interval '12 months' then 'no_usage_12_months'
    when max(im.created_at) filter (where im.quantity < 0) < now() - interval '6 months' then 'no_usage_6_months'
    else 'active'
  end as dead_stock_status
from public.inventory_status ist
left join public.inventory_movements im on im.part_id = ist.part_id
group by ist.part_id, ist.name, ist.sku, ist.on_hand;

alter table public.upload_batches enable row level security;
alter table public.imported_order_rows enable row level security;
alter table public.product_mapping_rules enable row level security;
alter table public.inventory_switches enable row level security;
alter table public.zero_stock_reports enable row level security;
alter table public.notifications enable row level security;
alter table public.slack_notification_settings enable row level security;
alter table public.prediction_snapshots enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'upload_batches','imported_order_rows','product_mapping_rules','inventory_switches',
    'zero_stock_reports','notifications','slack_notification_settings','prediction_snapshots'
  ] loop
    execute format('drop policy if exists "authenticated_select" on public.%I', t);
    execute format('drop policy if exists "authenticated_insert" on public.%I', t);
    execute format('drop policy if exists "authenticated_update" on public.%I', t);
    execute format('create policy "authenticated_select" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "authenticated_insert" on public.%I for insert to authenticated with check (auth.uid() is not null)', t);
    execute format('create policy "authenticated_update" on public.%I for update to authenticated using (true) with check (auth.uid() is not null)', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant select on public.overdue_open_po_items to authenticated;
grant select on public.imported_order_summary to authenticated;
grant select on public.part_usage_weekly to authenticated;
grant select on public.part_usage_monthly to authenticated;
grant select on public.dead_stock_candidates to authenticated;
