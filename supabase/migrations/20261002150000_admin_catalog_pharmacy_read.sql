drop policy if exists admin_medicine_catalog_pharmacy_read
  on public.admin_medicine_catalog;
create policy admin_medicine_catalog_pharmacy_read
on public.admin_medicine_catalog
for select to authenticated
using (
  exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);
