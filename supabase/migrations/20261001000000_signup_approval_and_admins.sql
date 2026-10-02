create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null,
  full_name text not null,
  phone text not null default '',
  role text not null default 'pharmacy_user'
    check (role in ('pharmacy_user', 'admin', 'superadmin')),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_profiles_email_lower_key
  on public.user_profiles (lower(email));
create unique index if not exists user_profiles_username_lower_key
  on public.user_profiles (lower(username));

create table if not exists public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique
    references public.user_profiles(id) on delete cascade,
  store_name text not null,
  company_name text not null default '',
  address text not null default '',
  city text not null default '',
  country text not null default '',
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_invites (
  email text primary key,
  invited_by uuid not null references public.user_profiles(id),
  accepted_user_id uuid unique references public.user_profiles(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'superadmin'
      and profile.approval_status = 'approved'
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_email text := lower(coalesce(new.email, ''));
  invited_by uuid;
  profile_role text := 'pharmacy_user';
  profile_status text := 'pending';
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  registration_type text := coalesce(metadata ->> 'registration_type', 'pharmacy_user');
  new_user_name text := trim(coalesce(metadata ->> 'username', ''));
begin
  if registration_type = 'admin' then
    select invite.invited_by
    into invited_by
    from public.admin_invites as invite
    where invite.email = new_email
      and invite.accepted_user_id is null;

    if invited_by is null then
      raise exception 'No admin invitation exists for this email';
    end if;

    profile_role := 'admin';
    profile_status := 'approved';
  elsif registration_type <> 'pharmacy_user' then
    raise exception 'Unsupported registration type';
  end if;

  if new_user_name = '' then
    new_user_name := split_part(new_email, '@', 1);
  end if;

  insert into public.user_profiles (
    id, email, username, full_name, phone, role, approval_status
  ) values (
    new.id,
    new_email,
    new_user_name,
    trim(coalesce(metadata ->> 'full_name', '')),
    trim(coalesce(metadata ->> 'phone', '')),
    profile_role,
    profile_status
  );

  if invited_by is not null then
    update public.admin_invites
    set accepted_user_id = new.id,
        accepted_at = now()
    where email = new_email;
  end if;

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
  current_role text;
begin
  if current_user_id is null then
    raise exception 'Sign in before setting up a pharmacy';
  end if;

  if trim(coalesce(requested_store_name, '')) = '' then
    raise exception 'Store name is required';
  end if;

  select profile.role
  into current_role
  from public.user_profiles as profile
  where profile.id = current_user_id;

  if current_role is distinct from 'pharmacy_user' then
    raise exception 'Only pharmacy accounts can complete store setup';
  end if;

  insert into public.pharmacies (
    owner_user_id, store_name, company_name, address, city, country
  ) values (
    current_user_id,
    trim(requested_store_name),
    trim(coalesce(requested_company_name, '')),
    trim(coalesce(requested_address, '')),
    trim(coalesce(requested_city, '')),
    trim(coalesce(requested_country, ''))
  )
  on conflict (owner_user_id) do update
  set store_name = excluded.store_name,
      company_name = excluded.company_name,
      address = excluded.address,
      city = excluded.city,
      country = excluded.country,
      updated_at = now();
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.review_pharmacy_signup(
  target_user_id uuid,
  decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a superadmin can review pharmacy signups';
  end if;

  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  if not exists (
    select 1 from public.pharmacies
    where owner_user_id = target_user_id
  ) then
    raise exception 'The pharmacy must complete store setup before review';
  end if;

  update public.user_profiles
  set approval_status = decision,
      updated_at = now()
  where id = target_user_id
    and role = 'pharmacy_user';

  if not found then
    raise exception 'Pharmacy signup not found';
  end if;

  update public.pharmacies
  set approval_status = decision,
      updated_at = now()
  where owner_user_id = target_user_id;
end;
$$;

create or replace function public.add_admin_user(target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(target_email));
  existing_user_id uuid;
begin
  if not public.is_superadmin() then
    raise exception 'Only a superadmin can add admin users';
  end if;

  if normalized_email = '' or position('@' in normalized_email) < 2 then
    raise exception 'A valid email address is required';
  end if;

  select id into existing_user_id
  from public.user_profiles
  where lower(email) = normalized_email;

  if existing_user_id is not null then
    update public.user_profiles
    set role = 'admin',
        approval_status = 'approved',
        updated_at = now()
    where id = existing_user_id
      and role <> 'superadmin';

    if not found then
      raise exception 'A superadmin account cannot be changed to admin';
    end if;

    delete from public.admin_invites where email = normalized_email;
  else
    insert into public.admin_invites (email, invited_by)
    values (normalized_email, (select auth.uid()))
    on conflict (email) do update
      set invited_by = excluded.invited_by,
          accepted_user_id = null,
          created_at = now(),
          accepted_at = null;
  end if;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists user_profiles_set_updated_at
  on public.user_profiles;
create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists pharmacies_set_updated_at
  on public.pharmacies;
create trigger pharmacies_set_updated_at
before update on public.pharmacies
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.pharmacies enable row level security;
alter table public.admin_invites enable row level security;
alter table public.medicine_catalog enable row level security;
alter table public.pharmacy_products enable row level security;

drop policy if exists user_profiles_read_self_or_superadmin
  on public.user_profiles;
create policy user_profiles_read_self_or_superadmin
on public.user_profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_superadmin()));

drop policy if exists pharmacies_read_owner_or_superadmin
  on public.pharmacies;
create policy pharmacies_read_owner_or_superadmin
on public.pharmacies
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or (select public.is_superadmin())
);

drop policy if exists pharmacies_update_approved_owner
  on public.pharmacies;
create policy pharmacies_update_approved_owner
on public.pharmacies
for update to authenticated
using (
  owner_user_id = (select auth.uid())
  and approval_status = 'approved'
  and exists (
    select 1 from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.approval_status = 'approved'
  )
)
with check (
  owner_user_id = (select auth.uid())
  and approval_status = 'approved'
);

drop policy if exists admin_invites_read_superadmin
  on public.admin_invites;
create policy admin_invites_read_superadmin
on public.admin_invites
for select to authenticated
using ((select public.is_superadmin()));

drop policy if exists medicine_catalog_owner_access
  on public.medicine_catalog;
create policy medicine_catalog_owner_access
on public.medicine_catalog
for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);

drop policy if exists pharmacy_products_owner_access
  on public.pharmacy_products;
create policy pharmacy_products_owner_access
on public.pharmacy_products
for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);

grant select on public.user_profiles, public.pharmacies, public.admin_invites
  to authenticated;
grant update on public.pharmacies to authenticated;
revoke all on function public.is_superadmin() from public;
revoke all on function public.review_pharmacy_signup(uuid, text) from public;
revoke all on function public.add_admin_user(text) from public;
revoke all on function public.complete_pharmacy_setup(text, text, text, text, text) from public;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.review_pharmacy_signup(uuid, text)
  to authenticated;
grant execute on function public.add_admin_user(text) to authenticated;
grant execute on function public.complete_pharmacy_setup(text, text, text, text, text)
  to authenticated;

-- Bootstrap the first superadmin after signing up with this email:
-- update public.user_profiles
-- set role = 'superadmin', approval_status = 'approved'
-- where lower(email) = lower('YOUR_EMAIL');