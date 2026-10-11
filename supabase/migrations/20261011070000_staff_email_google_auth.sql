create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_email text := lower(coalesce(new.email, ''));
  invitation_id uuid;
  invite_hash text;
  profile_role text := 'pharmacy_user';
  profile_status text := 'pending';
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  registration_type text := coalesce(metadata ->> 'registration_type', 'pharmacy_user');
  new_user_name text := lower(trim(coalesce(metadata ->> 'username', '')));
begin
  if registration_type = 'pharmacy_staff' then
    if new_email = '' then
      raise exception 'A valid email address is required for staff registration';
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
    new_user_name := 'staff_' || replace(new.id::text, '-', '');
  elsif registration_type <> 'pharmacy_user' then
    raise exception 'Admin users must be created by an approved superadmin';
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

create or replace function public.complete_pharmacy_staff_oauth_signup(
  requested_invite_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  invite_hash text;
  invitation_id uuid;
  current_email text;
  current_provider text;
begin
  if current_user_id is null then
    raise exception 'Sign in with Google before completing staff signup';
  end if;

  if requested_invite_token is null or requested_invite_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid staff invitation token';
  end if;

  select lower(coalesce(auth_user.email, '')),
         auth_user.raw_app_meta_data ->> 'provider'
  into current_email, current_provider
  from auth.users as auth_user
  where auth_user.id = current_user_id;

  if current_email is null or current_email = '' then
    raise exception 'A Google account with an email address is required';
  end if;

  if current_provider is distinct from 'google' then
    raise exception 'Sign in with Google to complete this staff signup';
  end if;

  if not exists (
    select 1
    from public.user_profiles as profile
    where profile.id = current_user_id
      and lower(profile.email) = current_email
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'pending'
  ) then
    raise exception 'This account cannot be used to complete a staff invitation';
  end if;

  if exists (
    select 1
    from public.pharmacies as pharmacy
    where pharmacy.owner_user_id = current_user_id
  ) then
    raise exception 'A pharmacy owner account cannot be changed into a staff account';
  end if;

  invite_hash := encode(
    extensions.digest(convert_to(requested_invite_token, 'UTF8'), 'sha256'),
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

  update public.user_profiles
  set role = 'pharmacy_staff',
      approval_status = 'approved',
      username = 'staff_' || replace(current_user_id::text, '-', ''),
      updated_at = now()
  where id = current_user_id;

  update public.pharmacy_staff_invites
  set used_by = current_user_id,
      used_at = now()
  where id = invitation_id;
end;
$$;

revoke all on function public.complete_pharmacy_staff_oauth_signup(text) from public, anon;
grant execute on function public.complete_pharmacy_staff_oauth_signup(text) to authenticated;
