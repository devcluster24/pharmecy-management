create or replace function public.complete_pharmacy_setup(
  requested_store_name text,
  requested_company_name text,
  requested_address text,
  requested_city text,
  requested_country text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  pharmacy_role text;
begin
  if current_user_id is null then
    raise exception 'Sign in before setting up a pharmacy';
  end if;

  if trim(coalesce(requested_store_name, '')) = '' then
    raise exception 'Store name is required';
  end if;

  select profile.role into pharmacy_role
  from public.user_profiles as profile
  where profile.id = current_user_id;

  if pharmacy_role is distinct from 'pharmacy_user' then
    raise exception 'Only pharmacy accounts can complete store setup';
  end if;

  insert into public.pharmacies (
    owner_user_id, store_name, company_name, address, city, country, approval_status
  ) values (
    current_user_id,
    trim(requested_store_name),
    trim(coalesce(requested_company_name, '')),
    trim(coalesce(requested_address, '')),
    trim(coalesce(requested_city, '')),
    trim(coalesce(requested_country, '')),
    'approved'
  )
  on conflict (owner_user_id) do update
  set store_name = excluded.store_name,
      company_name = excluded.company_name,
      address = excluded.address,
      city = excluded.city,
      country = excluded.country,
      approval_status = 'approved',
      updated_at = now();
end;
$$;

revoke all on function public.complete_pharmacy_setup(text, text, text, text, text) from public;
grant execute on function public.complete_pharmacy_setup(text, text, text, text, text) to authenticated;