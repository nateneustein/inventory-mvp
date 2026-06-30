-- Run after 0006. Adds order-line dedupe so overlapping CSV uploads do not count the same marketplace line twice.
-- Important: dedupe is by order LINE, not order number. Same order can still contain multiple real rows.

alter table public.imported_order_rows
  add column if not exists external_line_key text,
  add column if not exists external_line_key_source text,
  add column if not exists dedupe_status text not null default 'new',
  add column if not exists duplicate_of_row_id uuid references public.imported_order_rows(id) on delete set null;

do $$
begin
  alter table public.imported_order_rows
    add constraint imported_order_rows_dedupe_status_check check (dedupe_status in ('new','duplicate'));
exception when duplicate_object then null;
end $$;

-- Backfill stable line keys for existing imported rows.
update public.imported_order_rows
set
  external_line_key = case
    when platform = 'etsy' and coalesce(raw_data->>'Transaction ID','') <> '' then 'etsy:transaction:' || (raw_data->>'Transaction ID')
    when platform = 'amazon' and coalesce(raw_data->>'order-item-id','') <> '' then 'amazon:order-item:' || (raw_data->>'order-item-id')
    when platform = 'tiktok' and coalesce(raw_data->>'Order ID','') <> '' and coalesce(raw_data->>'SKU ID','') <> '' then 'tiktok:order-sku:' || lower(concat_ws('|', raw_data->>'Order ID', raw_data->>'SKU ID'))
    when platform = 'shopify' then 'shopify:line:' || lower(concat_ws('|', coalesce(raw_data->>'Id', raw_data->>'Name', platform_order_id, ''), coalesce(raw_data->>'Lineitem sku', platform_sku, ''), coalesce(raw_data->>'Lineitem name', item_name, ''), coalesce(raw_data->>'Lineitem quantity', quantity::text, ''), coalesce(raw_data->>'Created at', order_date, '')))
    else platform || ':fallback:' || lower(concat_ws('|', coalesce(platform_order_id,''), coalesce(platform_sku,''), coalesce(item_name,''), coalesce(variation_text,''), quantity::text, coalesce(order_date_parsed::text, order_date, '')))
  end,
  external_line_key_source = case
    when platform = 'etsy' and coalesce(raw_data->>'Transaction ID','') <> '' then 'Transaction ID'
    when platform = 'amazon' and coalesce(raw_data->>'order-item-id','') <> '' then 'order-item-id'
    when platform = 'tiktok' and coalesce(raw_data->>'Order ID','') <> '' and coalesce(raw_data->>'SKU ID','') <> '' then 'Order ID + SKU ID'
    when platform = 'shopify' then 'Order ID + line item composite'
    else 'fallback composite'
  end
where external_line_key is null;

-- Mark older duplicates. The earliest imported row for each marketplace line stays new; later rows are ignored duplicates.
with ranked as (
  select
    id,
    first_value(id) over (partition by platform, account_name, external_line_key order by created_at asc, source_row_number asc, id asc) as first_id,
    row_number() over (partition by platform, account_name, external_line_key order by created_at asc, source_row_number asc, id asc) as rn
  from public.imported_order_rows
  where external_line_key is not null
)
update public.imported_order_rows r
set
  dedupe_status = case when ranked.rn = 1 then 'new' else 'duplicate' end,
  duplicate_of_row_id = case when ranked.rn = 1 then null else ranked.first_id end,
  mapping_status = case when ranked.rn = 1 then r.mapping_status else 'ignored' end,
  mapped_variation_id = case when ranked.rn = 1 then r.mapped_variation_id else null end,
  demand_variation_id = case when ranked.rn = 1 then r.demand_variation_id else null end
from ranked
where r.id = ranked.id;

-- Remove the old row-number-based unique constraint. It blocked uploading overlapping files instead of marking duplicates.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.imported_order_rows'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%source_row_number%'
  loop
    execute format('alter table public.imported_order_rows drop constraint if exists %I', c.conname);
  end loop;
end $$;

create index if not exists idx_imported_order_rows_external_line_key on public.imported_order_rows(platform, account_name, external_line_key);
create index if not exists idx_imported_order_rows_dedupe_status on public.imported_order_rows(dedupe_status);

-- Only one active/new row is allowed for each marketplace order line. Duplicate audit rows are still allowed.
create unique index if not exists imported_order_rows_one_new_per_line
on public.imported_order_rows(platform, account_name, external_line_key)
where dedupe_status = 'new' and external_line_key is not null;

-- Rebuild summary so duplicates do not inflate imported/mapped/unmapped counts.
drop view if exists public.imported_order_summary;
create or replace view public.imported_order_summary
with (security_invoker = true)
as
select
  platform,
  account_name,
  count(*) filter (where coalesce(dedupe_status, 'new') <> 'duplicate')::integer as imported_rows,
  count(*) filter (where coalesce(dedupe_status, 'new') <> 'duplicate' and mapping_status = 'mapped')::integer as mapped_rows,
  count(*) filter (where coalesce(dedupe_status, 'new') <> 'duplicate' and mapping_status = 'unmapped')::integer as unmapped_rows,
  max(created_at) as last_imported_at,
  count(*) filter (where dedupe_status = 'duplicate')::integer as duplicate_rows
from public.imported_order_rows
group by platform, account_name;

-- Convenience view for future usage/prediction calculations.
create or replace view public.active_imported_order_rows
with (security_invoker = true)
as
select *
from public.imported_order_rows
where coalesce(dedupe_status, 'new') <> 'duplicate';

grant select on public.imported_order_summary to authenticated;
grant select on public.active_imported_order_rows to authenticated;
grant select, insert, update, delete on public.imported_order_rows to authenticated;
