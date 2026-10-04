alter table public.pharmacy_catalog_products
  add column if not exists unit_price text not null default '-',
  add column if not exists pack_price text not null default '-';

update public.pharmacy_catalog_products
set unit_price = retail_price
where unit_price = '-'
  and retail_price <> '-';

notify pgrst, 'reload schema';
