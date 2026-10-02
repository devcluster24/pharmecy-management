alter table public.user_profiles
  alter column approval_status set default 'approved';
alter table public.pharmacies
  alter column approval_status set default 'approved';

update public.user_profiles
set approval_status = 'approved',
    updated_at = now()
where approval_status <> 'approved';

update public.pharmacies
set approval_status = 'approved',
    updated_at = now()
where approval_status <> 'approved';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_email text := lower(coalesce(new.email, ''));
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  registration_type text := coalesce(metadata ->> 'registration_type', 'pharmacy_user');
  new_user_name text := lower(trim(coalesce(metadata ->> 'username', '')));
begin
  if registration_type not in ('pharmacy_user', 'admin') then
    raise exception 'Unsupported registration type';
  end if;

  if new_user_name = '' then
    new_user_name := split_part(new_email, '@', 1) || '_' || left(replace(new.id::text, '-', ''), 6);
  end if;

  insert into public.user_profiles (
    id, email, username, full_name, phone, role, approval_status
  ) values (
    new.id,
    new_email,
    new_user_name,
    coalesce(nullif(trim(metadata ->> 'full_name'), ''), split_part(new_email, '@', 1)),
    trim(coalesce(metadata ->> 'phone', '')),
    registration_type,
    'approved'
  );

  return new;
end;
$$;

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

drop function if exists public.review_pharmacy_signup(uuid, text);
