-- Run after 0004. Fixes mapping rules, Sunday-to-Saturday timelines, manual bulk sold entries, and receiving damage handling.

-- Mapping rules can now map a row to real inventory OR ignore/void the row.
alter table public.product_mapping_rules
  add column if not exists map_action text not null default 'map';

alter table public.product_mapping_rules
  alter column variation_id drop not null;

do $$
begin
  alter table public.product_mapping_rules
    add constraint product_mapping_rules_map_action_check check (map_action in ('map','ignore'));
exception when duplicate_object then null;
end $$;

-- Imported rows now store normalized dates and Sunday week starts.
alter table public.imported_order_rows
  add column if not exists order_date_parsed date,
  add column if not exists week_start date;

-- Inventory movements can carry the real effective movement date. This matters for manual/bulk entries.
alter table public.inventory_movements
  add column if not exists movement_date date;

update public.inventory_movements
set movement_date = created_at::date
where movement_date is null;

-- Purchase order items now separate good received quantity from total accounted quantity.
-- Damaged/missing items should reduce incoming/projected quantity even though they do not add usable stock.
alter table public.purchase_order_items
  add column if not exists quantity_accounted numeric not null default 0 check (quantity_accounted >= 0);

update public.purchase_order_items
set quantity_accounted = greatest(quantity_accounted, quantity_received)
where quantity_accounted < quantity_received;

create table if not exists public.manual_units_sold (
  id uuid primary key default gen_random_uuid(),
  variation_id uuid not null references public.product_variations(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  sale_date date not null,
  week_start date,
  order_reference text,
  reason text not null default 'bulk_order_manual_entry',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_manual_units_sold_variation_id on public.manual_units_sold(variation_id);
create index if not exists idx_manual_units_sold_sale_date on public.manual_units_sold(sale_date desc);
create index if not exists idx_imported_order_rows_week_start on public.imported_order_rows(week_start);
create index if not exists idx_inventory_movements_movement_date on public.inventory_movements(movement_date desc);

create or replace function public.week_start_sunday(d date)
returns date
language sql
immutable
as $$
  select (d - extract(dow from d)::int)::date;
$$;

-- Drop dependent views first because PostgreSQL cannot change view column order/names with CREATE OR REPLACE.
drop view if exists public.overdue_open_po_items;
drop view if exists public.open_po_items;

-- Rebuild incoming views to use quantity_accounted instead of good received only.
create or replace view public.part_incoming
with (security_invoker = true)
as
select
  poi.part_id,
  coalesce(sum(greatest(poi.quantity_ordered - coalesce(poi.quantity_accounted, poi.quantity_received, 0), 0)), 0)::numeric as incoming_qty
from public.purchase_order_items poi
join public.purchase_orders po on po.id = poi.purchase_order_id
where po.status in ('draft','ordered','in_production','shipped','delivered','receiving_check','partially_received')
group by poi.part_id;

create or replace view public.inventory_status
with (security_invoker = true)
as
select
  ps.*,
  coalesce(pi.incoming_qty, 0)::numeric as incoming_qty,
  (ps.on_hand + coalesce(pi.incoming_qty, 0))::numeric as projected_qty,
  case
    when ps.on_hand <= 0 then 'out'
    when ps.on_hand <= ps.reorder_point then 'reorder_now'
    when ps.on_hand <= (ps.reorder_point * 1.25) then 'getting_low'
    else 'ok'
  end as stock_status
from public.part_stock ps
left join public.part_incoming pi on pi.part_id = ps.part_id;

create or replace view public.open_po_items
with (security_invoker = true)
as
select
  poi.id as purchase_order_item_id,
  po.id as purchase_order_id,
  po.po_number,
  po.status,
  po.expected_date,
  po.tracking_number,
  s.name as supplier_name,
  p.id as part_id,
  p.name as part_name,
  p.sku as part_sku,
  poi.quantity_ordered,
  poi.quantity_received,
  coalesce(poi.quantity_accounted, poi.quantity_received, 0)::numeric as quantity_accounted,
  greatest(poi.quantity_ordered - coalesce(poi.quantity_accounted, poi.quantity_received, 0), 0)::numeric as remaining_qty
from public.purchase_order_items poi
join public.purchase_orders po on po.id = poi.purchase_order_id
join public.suppliers s on s.id = po.supplier_id
join public.parts p on p.id = poi.part_id
where po.status not in ('received','closed','cancelled')
order by po.expected_date nulls last, po.created_at desc;

create or replace view public.overdue_open_po_items
with (security_invoker = true)
as
select *
from public.open_po_items
where expected_date is not null
  and expected_date < current_date
  and remaining_qty > 0;

-- Sunday-to-Saturday usage view.
create or replace view public.part_usage_weekly
with (security_invoker = true)
as
select
  p.id as part_id,
  p.name,
  p.sku,
  public.week_start_sunday(coalesce(im.movement_date, im.created_at::date)) as period_start,
  sum(abs(im.quantity)) filter (where im.quantity < 0)::numeric as used_qty
from public.parts p
left join public.inventory_movements im on im.part_id = p.id
group by p.id, p.name, p.sku, public.week_start_sunday(coalesce(im.movement_date, im.created_at::date));

create or replace view public.part_usage_monthly
with (security_invoker = true)
as
select
  p.id as part_id,
  p.name,
  p.sku,
  date_trunc('month', coalesce(im.movement_date, im.created_at::date))::date as period_start,
  sum(abs(im.quantity)) filter (where im.quantity < 0)::numeric as used_qty
from public.parts p
left join public.inventory_movements im on im.part_id = p.id
group by p.id, p.name, p.sku, date_trunc('month', coalesce(im.movement_date, im.created_at::date))::date;

alter table public.manual_units_sold enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers','parts','products','product_variations','bom_items','purchase_orders',
    'purchase_order_items','receiving_events','inventory_movements','damage_reports',
    'replacement_orders','cycle_counts','platform_connections','sync_logs',
    'upload_batches','imported_order_rows','product_mapping_rules','inventory_switches',
    'zero_stock_reports','notifications','slack_notification_settings','prediction_snapshots',
    'manual_units_sold'
  ] loop
    execute format('drop policy if exists "authenticated_delete" on public.%I', t);
    execute format('create policy "authenticated_delete" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.part_stock to authenticated;
grant select on public.part_incoming to authenticated;
grant select on public.inventory_status to authenticated;
grant select on public.open_po_items to authenticated;
grant select on public.overdue_open_po_items to authenticated;
grant select on public.imported_order_summary to authenticated;
grant select on public.part_usage_weekly to authenticated;
grant select on public.part_usage_monthly to authenticated;
grant select on public.dead_stock_candidates to authenticated;
