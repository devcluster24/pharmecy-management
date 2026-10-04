alter table public.admin_medicine_catalog
  add column if not exists pack_size text not null default '-',
  add column if not exists unit_price text not null default '-',
  add column if not exists pack_price text not null default '-';

update public.admin_medicine_catalog
set unit_price = retail_price
where unit_price = '-'
  and retail_price <> '-';

notify pgrst, 'reload schema';
