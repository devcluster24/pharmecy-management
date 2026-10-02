create table if not exists public.pharmacy_catalog_products (
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  id text not null,
  source_catalog_id text references public.admin_medicine_catalog(id) on delete set null,
  serial_number text not null default '-',
  medicine_name text not null,
  brand text not null default '',
  generic_name text not null default '',
  manufacturer text not null default '',
  product_type text not null default '',
  category text not null default '',
  dosage_form text not null default '',
  strength text not null default '',
  pack_size text not null default '',
  unit text not null default '',
  barcode text not null default '',
  retail_price text not null default '-',
  usage_type text not null default '',
  dar_code text not null default '-',
  medicine_type_category text not null default '',
  registration_information text not null default '-',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, id),
  unique (owner_user_id, source_catalog_id)
);

create index if not exists pharmacy_catalog_products_owner_idx
  on public.pharmacy_catalog_products (owner_user_id);

alter table public.pharmacy_catalog_products enable row level security;

drop policy if exists pharmacy_catalog_products_owner_access
  on public.pharmacy_catalog_products;
create policy pharmacy_catalog_products_owner_access
on public.pharmacy_catalog_products
for all to authenticated
using (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
)
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);

grant select, insert, update, delete on public.pharmacy_catalog_products
  to authenticated;
