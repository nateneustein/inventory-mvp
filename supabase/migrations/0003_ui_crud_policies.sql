-- v3 adds delete permissions for the internal MVP CRUD screens.
-- Keep this internal-only. Later, replace these with role-based policies.
do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers','parts','products','product_variations','bom_items','purchase_orders','purchase_order_items',
    'upload_batches','imported_order_rows','product_mapping_rules','inventory_switches','zero_stock_reports',
    'notifications','slack_notification_settings','prediction_snapshots','damage_reports','replacement_orders','cycle_counts','receiving_events','inventory_movements'
  ] loop
    execute format('drop policy if exists "authenticated_delete" on public.%I', t);
    execute format('create policy "authenticated_delete" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

grant delete on all tables in schema public to authenticated;
