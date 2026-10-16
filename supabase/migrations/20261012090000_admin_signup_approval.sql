alter table public.user_profiles
  drop constraint if exists user_profiles_approval_status_check;

alter table public.user_profiles
  add constraint user_profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected', 'suspended', 'inactive'));

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
  profile_status text := 'approved';
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
    profile_status := 'pending';
    new_user_name := 'staff_' || replace(new.id::text, '-', '');
  elsif registration_type = 'admin' then
    profile_role := 'admin';
    profile_status := 'pending';
  elsif registration_type <> 'pharmacy_user' then
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

create or replace function public.admin_get_admin_management()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only an approved superadmin can manage admin accounts';
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(admin_row) order by admin_row.created_at desc)
      from (
        select profile.id,
               profile.full_name,
               profile.username,
               profile.email,
               profile.phone,
               profile.approval_status,
               profile.created_at
        from public.user_profiles as profile
        where profile.role = 'admin'
      ) as admin_row
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_review_admin_signup(
  target_admin_user_id uuid,
  decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only an approved superadmin can review admin requests';
  end if;

  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  update public.user_profiles
  set approval_status = decision,
      updated_at = now()
  where id = target_admin_user_id
    and role = 'admin'
    and approval_status = 'pending';

  if not found then
    raise exception 'Pending admin request not found';
  end if;
end;
$$;

create or replace function public.admin_set_admin_active(
  target_admin_user_id uuid,
  should_be_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only an approved superadmin can manage admin accounts';
  end if;

  update public.user_profiles
  set approval_status = case when should_be_active then 'approved' else 'inactive' end,
      updated_at = now()
  where id = target_admin_user_id
    and role = 'admin'
    and approval_status in ('approved', 'inactive');

  if not found then
    raise exception 'Active or inactive admin account not found';
  end if;
end;
$$;

revoke all on function public.admin_get_admin_management() from public, anon;
revoke all on function public.admin_review_admin_signup(uuid, text) from public, anon;
revoke all on function public.admin_set_admin_active(uuid, boolean) from public, anon;
grant execute on function public.admin_get_admin_management() to authenticated;
grant execute on function public.admin_review_admin_signup(uuid, text) to authenticated;
grant execute on function public.admin_set_admin_active(uuid, boolean) to authenticated;
