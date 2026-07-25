-- 0009_usage_aggregate_views.sql
-- Run after 0008_edit_delete_archive_records.sql.
--
-- WHY THIS EXISTS
-- The Usage and Prediction pages used to pull every row of inventory_movements
-- into the app and aggregate in JavaScript. The Supabase Data API caps any
-- single response at max-rows (1000 by default), and a client-side .limit(50000)
-- does NOT raise that cap. With 3,800+ usage rows the pages silently received
-- only the oldest 1000 and computed their "latest imported usage date" from
-- that truncated slice -- which is why the app was stuck on 2025-01-12 while the
-- database actually held data through 2026-06-14.
--
-- The fix is to aggregate in Postgres and return a small result set:
--   * weekly_usage_grid   -> one row per WEEK (~125 rows), parts as a jsonb map
--   * part_usage_windows  -> one row per PART (~91 rows)
-- Both stay far below any max-rows cap no matter how much history accumulates.

-- ---------------------------------------------------------------------------
-- Indexes: every view below filters on these columns.
-- ---------------------------------------------------------------------------
create index if not exists inventory_movements_movement_date_idx
  on public.inventory_movements (movement_date);

create index if not exists inventory_movements_part_date_idx
  on public.inventory_movements (part_id, movement_date);

create index if not exists inventory_movements_usage_idx
  on public.inventory_movements (movement_type, movement_date)
  where archived_at is null and quantity < 0;

-- ---------------------------------------------------------------------------
-- usage_anchor: the newest real usage date in the system.
-- Everything date-relative anchors here instead of the server clock, so the
-- app keeps working when usage is imported in batches that lag real time.
-- It advances by itself as soon as newer usage is imported.
-- ---------------------------------------------------------------------------
create or replace view public.usage_anchor
with (security_invoker = true)
as
select
  max(movement_date)                        as anchor_date,
  min(movement_date)                        as earliest_date,
  count(*)::bigint                          as usage_row_count
from public.inventory_movements
where archived_at is null
  and quantity < 0
  and movement_type = 'order_consumption'
  and movement_date is not null;

-- ---------------------------------------------------------------------------
-- weekly_usage_grid: one row per Sunday-to-Saturday week.
-- `usage` maps part_id -> quantity used that week, so the whole timeline is
-- ~125 rows instead of ~11,000 part/week combinations.
-- ---------------------------------------------------------------------------
create or replace view public.weekly_usage_grid
with (security_invoker = true)
as
select
  w.week_start,
  (w.week_start + 6)                            as week_end,
  extract(year from w.week_start)::int          as year,
  to_char(w.week_start, 'FMMonth')              as month_name,
  (floor((w.week_start
          - (date_trunc('year', w.week_start)::date
             - extract(dow from date_trunc('year', w.week_start))::int)
         ) / 7) + 1)::int                       as week_number,
  jsonb_object_agg(w.part_id::text, w.used_qty) as usage,
  sum(w.used_qty)::numeric                      as total_used
from (
  select
    (im.movement_date - extract(dow from im.movement_date)::int)::date as week_start,
    im.part_id,
    sum(abs(im.quantity))::numeric as used_qty
  from public.inventory_movements im
  where im.archived_at is null
    and im.quantity < 0
    and im.movement_type = 'order_consumption'
    and im.movement_date is not null
  group by 1, 2
) w
group by w.week_start;

-- ---------------------------------------------------------------------------
-- part_usage_windows: per-part usage over the trailing windows the prediction
-- pages need, measured back from usage_anchor.anchor_date (not now()).
-- ---------------------------------------------------------------------------
create or replace view public.part_usage_windows
with (security_invoker = true)
as
select
  p.id                       as part_id,
  p.name,
  p.sku,
  p.category,
  a.anchor_date,
  coalesce(sum(abs(im.quantity)) filter (
    where im.movement_date > a.anchor_date - 7), 0)::numeric    as usage_7,
  coalesce(sum(abs(im.quantity)) filter (
    where im.movement_date > a.anchor_date - 28), 0)::numeric   as usage_28,
  coalesce(sum(abs(im.quantity)) filter (
    where im.movement_date > a.anchor_date - 91), 0)::numeric   as usage_91,
  coalesce(sum(abs(im.quantity)) filter (
    where im.movement_date > a.anchor_date - 365), 0)::numeric  as usage_365,
  -- same calendar window one year earlier, for seasonal comparison
  coalesce(sum(abs(im.quantity)) filter (
    where im.movement_date >  a.anchor_date - 365 - 23
      and im.movement_date <= a.anchor_date - 365 + 22), 0)::numeric as usage_same_period_last_year,
  max(im.movement_date)                                          as last_used_on
from public.parts p
cross join public.usage_anchor a
left join public.inventory_movements im
  on  im.part_id       = p.id
  and im.archived_at   is null
  and im.quantity      < 0
  and im.movement_type = 'order_consumption'
  and im.movement_date is not null
group by p.id, p.name, p.sku, p.category, a.anchor_date;

-- ---------------------------------------------------------------------------
-- part_usage_peaks: biggest single week per part, for spike-aware reordering.
-- ---------------------------------------------------------------------------
create or replace view public.part_usage_peaks
with (security_invoker = true)
as
select
  part_id,
  max(used_qty)::numeric              as largest_week_qty,
  avg(used_qty)::numeric              as average_week_qty,
  count(*)::bigint                    as weeks_with_usage
from (
  select
    im.part_id,
    (im.movement_date - extract(dow from im.movement_date)::int)::date as week_start,
    sum(abs(im.quantity))::numeric as used_qty
  from public.inventory_movements im
  where im.archived_at is null
    and im.quantity < 0
    and im.movement_type = 'order_consumption'
    and im.movement_date is not null
  group by 1, 2
) weekly
group by part_id;

-- ---------------------------------------------------------------------------
-- dead_stock_candidates: was keyed on created_at, which for imported history is
-- the moment the import ran, not when the stock was actually used. Every
-- back-filled part therefore looked freshly active. Re-keyed on movement_date.
-- ---------------------------------------------------------------------------
create or replace view public.dead_stock_candidates
with (security_invoker = true)
as
select
  ist.part_id,
  ist.name,
  ist.sku,
  ist.on_hand,
  max(im.movement_date) filter (where im.quantity < 0) as last_used_at,
  case
    when max(im.movement_date) filter (where im.quantity < 0) is null
      then 'never_used'
    when max(im.movement_date) filter (where im.quantity < 0)
         < (select anchor_date from public.usage_anchor) - 365
      then 'no_usage_12_months'
    when max(im.movement_date) filter (where im.quantity < 0)
         < (select anchor_date from public.usage_anchor) - 182
      then 'no_usage_6_months'
    else 'active'
  end as dead_stock_status
from public.inventory_status ist
left join public.inventory_movements im
  on im.part_id = ist.part_id and im.archived_at is null
group by ist.part_id, ist.name, ist.sku, ist.on_hand;

-- ---------------------------------------------------------------------------
-- negative_stock_parts: parts whose movement history sums below zero. These are
-- data faults (usage imported with no opening balance), not real quantities,
-- and the app should surface them rather than quietly display a negative.
-- ---------------------------------------------------------------------------
create or replace view public.negative_stock_parts
with (security_invoker = true)
as
select
  ps.part_id,
  ps.name,
  ps.sku,
  ps.on_hand,
  coalesce(sum(im.quantity) filter (where im.movement_type = 'starting_balance'), 0)::numeric  as starting_balance,
  coalesce(sum(im.quantity) filter (where im.movement_type = 'supplier_received'), 0)::numeric as total_received,
  coalesce(sum(im.quantity) filter (where im.movement_type = 'order_consumption'), 0)::numeric as total_used
from public.part_stock ps
join public.inventory_movements im on im.part_id = ps.part_id and im.archived_at is null
group by ps.part_id, ps.name, ps.sku, ps.on_hand
having ps.on_hand < 0;

grant select on public.usage_anchor          to authenticated;
grant select on public.weekly_usage_grid     to authenticated;
grant select on public.part_usage_windows    to authenticated;
grant select on public.part_usage_peaks      to authenticated;
grant select on public.negative_stock_parts  to authenticated;
grant select on public.dead_stock_candidates to authenticated;
