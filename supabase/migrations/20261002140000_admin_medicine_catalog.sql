create table if not exists public.admin_medicine_catalog (
  id text primary key,
  serial_number text not null default '-',
  pharmaceutical_company text not null default '-',
  brand_name text not null default '-',
  generic_name text not null default '-',
  strength text not null default '-',
  dosage_form_description text not null default '-',
  retail_price text not null default '-',
  usage_type text not null default '-',
  dar_code text not null default '-',
  medicine_type_category text not null default '-',
  registration_information text not null default '-',
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_medicine_catalog enable row level security;

drop policy if exists admin_medicine_catalog_admin_access
  on public.admin_medicine_catalog;
drop policy if exists admin_medicine_catalog_admin_read
  on public.admin_medicine_catalog;
create policy admin_medicine_catalog_admin_read
on public.admin_medicine_catalog
for select to authenticated
using (
  exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'superadmin')
      and profile.approval_status = 'approved'
  )
);

drop policy if exists admin_medicine_catalog_admin_insert
  on public.admin_medicine_catalog;
create policy admin_medicine_catalog_admin_insert
on public.admin_medicine_catalog
for insert to authenticated
with check (
  exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'superadmin')
      and profile.approval_status = 'approved'
  )
  and created_by = (select auth.uid())
);

drop policy if exists admin_medicine_catalog_admin_update
  on public.admin_medicine_catalog;
create policy admin_medicine_catalog_admin_update
on public.admin_medicine_catalog
for update to authenticated
using (
  exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'superadmin')
      and profile.approval_status = 'approved'
  )
)
with check (
  exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'superadmin')
      and profile.approval_status = 'approved'
  )
);

drop policy if exists admin_medicine_catalog_admin_delete
  on public.admin_medicine_catalog;
create policy admin_medicine_catalog_admin_delete
on public.admin_medicine_catalog
for delete to authenticated
using (
  exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'superadmin')
      and profile.approval_status = 'approved'
  )
);

grant select, insert, update, delete on public.admin_medicine_catalog
  to authenticated;
