-- Run after 0007_order_line_dedupe.sql.

alter table public.inventory_movements add column if not exists movement_date date;
alter table public.inventory_movements add column if not exists archived_at timestamptz;
alter table public.inventory_movements add column if not exists updated_at timestamptz;
update public.inventory_movements set movement_date = created_at::date where movement_date is null;

alter table public.manual_units_sold add column if not exists archived_at timestamptz;
alter table public.manual_units_sold add column if not exists updated_at timestamptz;

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
left join public.inventory_movements im on im.part_id = p.id and im.archived_at is null
group by p.id, p.name, p.sku, p.category, p.unit, p.critical, p.reorder_point, p.target_stock, p.default_order_quantity, p.active;

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

grant select, insert, update, delete on public.parts to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_variations to authenticated;
grant select, insert, update, delete on public.inventory_movements to authenticated;
grant select, insert, update, delete on public.zero_stock_reports to authenticated;
grant select, insert, update, delete on public.manual_units_sold to authenticated;
