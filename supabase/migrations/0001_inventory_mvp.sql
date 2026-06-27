create extension if not exists pgcrypto;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  website text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null unique,
  category text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_part_number text,
  unit text not null default 'each',
  lead_time_days_min numeric not null default 0,
  lead_time_days_max numeric not null default 0,
  safety_stock_days numeric not null default 30,
  reorder_point numeric not null default 0,
  target_stock numeric not null default 0,
  default_order_quantity numeric not null default 0,
  critical boolean not null default false,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variation_name text not null,
  internal_sku text not null unique,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bom_items (
  id uuid primary key default gen_random_uuid(),
  variation_id uuid not null references public.product_variations(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete restrict,
  quantity_per_unit numeric not null check (quantity_per_unit > 0),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (variation_id, part_id)
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null default 'ordered' check (status in ('draft','ordered','in_production','shipped','delivered','receiving_check','partially_received','received','closed','cancelled')),
  order_date date,
  expected_date date,
  tracking_number text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete restrict,
  quantity_ordered numeric not null check (quantity_ordered >= 0),
  quantity_received numeric not null default 0 check (quantity_received >= 0),
  unit_cost numeric not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.receiving_events (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete restrict,
  quantity_received numeric not null default 0 check (quantity_received >= 0),
  quantity_damaged numeric not null default 0 check (quantity_damaged >= 0),
  quantity_missing numeric not null default 0 check (quantity_missing >= 0),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete restrict,
  movement_type text not null check (movement_type in ('starting_balance','supplier_received','order_consumption','replacement_order','damage','sample_or_testing','cycle_count_adjustment','manual_adjustment')),
  quantity numeric not null check (quantity <> 0),
  source_type text,
  source_id uuid,
  reason text not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.damage_reports (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  reason text not null check (reason in ('supplier_damaged','production_damaged','wrong_cut','broken_in_shipping','testing_sample','missing','unknown')),
  order_reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.replacement_orders (
  id uuid primary key default gen_random_uuid(),
  original_order_reference text,
  variation_id uuid not null references public.product_variations(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  reason text not null,
  approved_by text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete restrict,
  counted_quantity numeric not null check (counted_quantity >= 0),
  system_quantity_at_count numeric not null,
  difference numeric not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('etsy','amazon','tiktok','shopify')),
  account_name text not null,
  status text not null default 'not_connected',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  job_name text not null,
  status text not null,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_parts_supplier_id on public.parts(supplier_id);
create index if not exists idx_inventory_movements_part_id on public.inventory_movements(part_id);
create index if not exists idx_inventory_movements_created_at on public.inventory_movements(created_at desc);
create index if not exists idx_po_supplier_id on public.purchase_orders(supplier_id);
create index if not exists idx_po_status on public.purchase_orders(status);
create index if not exists idx_po_items_po_id on public.purchase_order_items(purchase_order_id);
create index if not exists idx_po_items_part_id on public.purchase_order_items(part_id);
create index if not exists idx_bom_variation_id on public.bom_items(variation_id);
create index if not exists idx_bom_part_id on public.bom_items(part_id);

create or replace view public.part_stock
with (security_invoker = true)
as
select
  p.id as part_id,
  p.name,
  p.sku,
  p.category,
  p.unit,
  p.critical,
  p.reorder_point,
  p.target_stock,
  p.default_order_quantity,
  p.active,
  coalesce(sum(im.quantity), 0)::numeric as on_hand
from public.parts p
left join public.inventory_movements im on im.part_id = p.id
group by p.id, p.name, p.sku, p.category, p.unit, p.critical, p.reorder_point, p.target_stock, p.default_order_quantity, p.active;

create or replace view public.part_incoming
with (security_invoker = true)
as
select
  poi.part_id,
  coalesce(sum(greatest(poi.quantity_ordered - poi.quantity_received, 0)), 0)::numeric as incoming_qty
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
  greatest(poi.quantity_ordered - poi.quantity_received, 0)::numeric as remaining_qty
from public.purchase_order_items poi
join public.purchase_orders po on po.id = poi.purchase_order_id
join public.suppliers s on s.id = po.supplier_id
join public.parts p on p.id = poi.part_id
where po.status not in ('received','closed','cancelled')
order by po.expected_date nulls last, po.created_at desc;

alter table public.suppliers enable row level security;
alter table public.parts enable row level security;
alter table public.products enable row level security;
alter table public.product_variations enable row level security;
alter table public.bom_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.receiving_events enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.damage_reports enable row level security;
alter table public.replacement_orders enable row level security;
alter table public.cycle_counts enable row level security;
alter table public.platform_connections enable row level security;
alter table public.sync_logs enable row level security;

-- MVP policy: any authenticated employee can use the app.
-- Later, split this into Admin / Manager / Warehouse roles.
do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers','parts','products','product_variations','bom_items','purchase_orders',
    'purchase_order_items','receiving_events','inventory_movements','damage_reports',
    'replacement_orders','cycle_counts','platform_connections','sync_logs'
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
grant select on public.part_stock to authenticated;
grant select on public.part_incoming to authenticated;
grant select on public.inventory_status to authenticated;
grant select on public.open_po_items to authenticated;
