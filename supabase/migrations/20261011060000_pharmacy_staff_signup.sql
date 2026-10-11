create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('pharmacy_user', 'pharmacy_staff', 'admin', 'superadmin'));

create table if not exists public.pharmacy_staff_invites (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_by uuid unique references auth.users(id) on delete set null,
  used_at timestamptz
);

alter table public.pharmacy_staff_invites enable row level security;
revoke all on public.pharmacy_staff_invites from anon, authenticated;

create or replace function public.create_pharmacy_staff_invite(requested_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Sign in before creating a staff signup link';
  end if;

  if requested_token_hash is null or requested_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid staff invitation token';
  end if;

  if not exists (
    select 1
    from public.user_profiles as profile
    join public.pharmacies as pharmacy
      on pharmacy.owner_user_id = profile.id
    where profile.id = current_user_id
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
      and pharmacy.approval_status = 'approved'
  ) then
    raise exception 'Only an approved pharmacy owner can create staff signup links';
  end if;

  insert into public.pharmacy_staff_invites (owner_user_id, token_hash)
  values (current_user_id, requested_token_hash);
end;
$$;

revoke all on function public.create_pharmacy_staff_invite(text) from public, anon;
grant execute on function public.create_pharmacy_staff_invite(text) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_email text := lower(coalesce(new.email, ''));
  invitation_id uuid;
  staff_phone text;
  invite_hash text;
  profile_role text := 'pharmacy_user';
  profile_status text := 'pending';
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  registration_type text := coalesce(metadata ->> 'registration_type', 'pharmacy_user');
  new_user_name text := lower(trim(coalesce(metadata ->> 'username', '')));
begin
  if registration_type = 'pharmacy_staff' then
    staff_phone := trim(coalesce(metadata ->> 'phone', new.phone, ''));
    if staff_phone = '' or new.phone is null then
      raise exception 'A verified phone number is required for staff registration';
    end if;

    invite_hash := encode(
      extensions.digest(
        convert_to(coalesce(metadata ->> 'staff_invite_token', ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    );

    select invite.id
    into invitation_id
    from public.pharmacy_staff_invites as invite
    where invite.token_hash = invite_hash
      and invite.used_by is null
      and invite.used_at is null
      and invite.expires_at > now()
    for update;

    if invitation_id is null then
      raise exception 'This staff signup link is invalid, expired, or already used';
    end if;

    profile_role := 'pharmacy_staff';
    profile_status := 'approved';
    new_email := 'staff-' || replace(new.id::text, '-', '') || '@staff.pharmecycluster.invalid';
    new_user_name := 'staff_' || replace(new.id::text, '-', '');
  elsif registration_type <> 'pharmacy_user' then
    raise exception 'Admin users must be created by an approved superadmin';
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
    coalesce(nullif(trim(metadata ->> 'full_name'), ''), split_part(new_email, '@', 1)),
    coalesce(staff_phone, trim(coalesce(metadata ->> 'phone', ''))),
    profile_role,
    profile_status
  );

  if invitation_id is not null then
    update public.pharmacy_staff_invites
    set used_by = new.id,
        used_at = now()
    where id = invitation_id;
  end if;

  return new;
end;
$$;
