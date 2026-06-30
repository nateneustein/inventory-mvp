-- Make sure the manual-entries table exists and the app is allowed to use it
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

-- The usage page also reads this column
alter table public.inventory_movements add column if not exists movement_date date;
update public.inventory_movements set movement_date = created_at::date where movement_date is null;

-- Allow logged-in users to use the table
alter table public.manual_units_sold enable row level security;
drop policy if exists "authenticated_select" on public.manual_units_sold;
drop policy if exists "authenticated_insert" on public.manual_units_sold;
drop policy if exists "authenticated_update" on public.manual_units_sold;
drop policy if exists "authenticated_delete" on public.manual_units_sold;
create policy "authenticated_select" on public.manual_units_sold for select to authenticated using (true);
create policy "authenticated_insert" on public.manual_units_sold for insert to authenticated with check (auth.uid() is not null);
create policy "authenticated_update" on public.manual_units_sold for update to authenticated using (true) with check (auth.uid() is not null);
create policy "authenticated_delete" on public.manual_units_sold for delete to authenticated using (true);
grant select, insert, update, delete on public.manual_units_sold to authenticated;
