-- Optional example data. Run only after you create your first Supabase Auth user and sign in once.
-- You can also just enter this data through the app forms.

insert into public.suppliers (name, contact_name, website, notes)
values
  ('Example Alibaba Supplier', 'Supplier contact', 'https://www.alibaba.com', 'Example only. Replace with real supplier.'),
  ('Example Acrylic Supplier', 'Nicole', null, 'Example only. Replace with real supplier.')
on conflict do nothing;

-- Parts should usually be entered through the app so you can choose the real supplier.
