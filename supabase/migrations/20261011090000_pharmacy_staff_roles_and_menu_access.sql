alter table public.user_profiles
  drop constraint if exists user_profiles_approval_status_check;

alter table public.user_profiles
  add constraint user_profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected', 'suspended'));

alter table public.pharmacy_staff_permissions
  add column if not exists staff_role text not null default 'Staff'
  check (staff_role in (
    'Manager', 'Pharmacist', 'Cashier', 'Inventory Staff', 'Sales Staff', 'Staff'
  ));

update public.pharmacy_staff_permissions as access
set permissions = coalesce((
  select jsonb_object_agg(
    page.key,
    case
      when jsonb_typeof(page.value) = 'boolean' then page.value
      else to_jsonb(coalesce((page.value ->> 'view')::boolean, false))
    end
  )
  from jsonb_each(access.permissions) as page
), '{}'::jsonb);

create or replace function public.pharmacy_staff_has_permission(
  requested_owner_id uuid,
  requested_page text,
  requested_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case jsonb_typeof(access.permissions -> requested_page)
      when 'boolean' then (access.permissions ->> requested_page)::boolean
      when 'object' then (access.permissions -> requested_page ->> requested_action)::boolean
      else false
    end
    from public.pharmacy_staff_permissions as access
    join public.user_profiles as staff
      on staff.id = access.staff_user_id
    where access.staff_user_id = (select auth.uid())
      and access.owner_user_id = requested_owner_id
      and staff.role = 'pharmacy_staff'
      and staff.approval_status = 'approved'
  ), false);
$$;

drop function if exists public.get_pharmacy_staff_members();
create function public.get_pharmacy_staff_members()
returns table (
  staff_user_id uuid,
  email text,
  full_name text,
  photo_url text,
  approval_status text,
  created_at timestamptz,
  staff_role text,
  permissions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if not exists (
    select 1
    from public.user_profiles as owner
    join public.pharmacies as pharmacy
      on pharmacy.owner_user_id = owner.id
    where owner.id = current_user_id
      and owner.role = 'pharmacy_user'
      and owner.approval_status = 'approved'
      and pharmacy.approval_status = 'approved'
  ) then
    raise exception 'Only an approved pharmacy owner can view staff applications';
  end if;

  return query
  select profile.id,
         profile.email,
         profile.full_name,
         coalesce(
           auth_user.raw_user_meta_data ->> 'avatar_url',
           auth_user.raw_user_meta_data ->> 'picture',
           auth_user.raw_user_meta_data ->> 'profile_photo_url',
           auth_user.raw_user_meta_data ->> 'photo_url'
         ),
         profile.approval_status,
         profile.created_at,
         coalesce(access.staff_role, 'Staff'),
         coalesce(access.permissions, '{}'::jsonb)
  from public.pharmacy_staff_invites as invite
  join public.user_profiles as profile
    on profile.id = invite.used_by
  join auth.users as auth_user
    on auth_user.id = profile.id
  left join public.pharmacy_staff_permissions as access
    on access.staff_user_id = profile.id
   and access.owner_user_id = current_user_id
  where invite.owner_user_id = current_user_id
    and profile.role = 'pharmacy_staff'
  order by profile.created_at desc;
end;
$$;

drop function if exists public.manage_pharmacy_staff_access(uuid, text, jsonb);
drop function if exists public.manage_pharmacy_staff_access(uuid, text, jsonb, text, text, text);
create function public.manage_pharmacy_staff_access(
  target_staff_user_id uuid,
  requested_decision text,
  requested_permissions jsonb default '{}'::jsonb,
  requested_role text default 'Staff',
  requested_status text default 'suspended',
  requested_full_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  page_entry record;
  allowed_pages text[] := array[
    'overview', 'product-management', 'sales', 'invoice', 'purchase',
    'inventory', 'returns', 'customers', 'suppliers', 'reports',
    'expenses', 'settings'
  ];
  allowed_roles text[] := array[
    'Manager', 'Pharmacist', 'Cashier', 'Inventory Staff', 'Sales Staff', 'Staff'
  ];
begin
  if not exists (
    select 1
    from public.user_profiles as owner
    join public.pharmacies as pharmacy
      on pharmacy.owner_user_id = owner.id
    where owner.id = current_user_id
      and owner.role = 'pharmacy_user'
      and owner.approval_status = 'approved'
      and pharmacy.approval_status = 'approved'
  ) then
    raise exception 'Only an approved pharmacy owner can manage staff access';
  end if;

  if requested_decision is distinct from 'update' then
    raise exception 'Unsupported staff access decision';
  end if;

  if requested_status is null
    or requested_status not in ('pending', 'approved', 'rejected', 'suspended') then
    raise exception 'Invalid staff account status';
  end if;

  if requested_role is null or not (requested_role = any(allowed_roles)) then
    raise exception 'Invalid staff role';
  end if;

  if requested_full_name is not null
    and (length(trim(requested_full_name)) = 0 or length(trim(requested_full_name)) > 120) then
    raise exception 'Staff name must contain between 1 and 120 characters';
  end if;

  if jsonb_typeof(coalesce(requested_permissions, '{}'::jsonb)) <> 'object' then
    raise exception 'Staff menu permissions must be an object';
  end if;

  for page_entry in
    select key, value
    from jsonb_each(coalesce(requested_permissions, '{}'::jsonb))
  loop
    if not (page_entry.key = any(allowed_pages))
      or jsonb_typeof(page_entry.value) <> 'boolean' then
      raise exception 'Invalid staff menu permission';
    end if;
  end loop;

  if not exists (
    select 1
    from public.pharmacy_staff_invites as invite
    join public.user_profiles as staff
      on staff.id = invite.used_by
    where invite.owner_user_id = current_user_id
      and invite.used_by = target_staff_user_id
      and staff.role = 'pharmacy_staff'
  ) then
    raise exception 'This staff account does not belong to your pharmacy';
  end if;

  update public.user_profiles
  set role = 'pharmacy_staff',
      approval_status = requested_status,
      full_name = coalesce(nullif(trim(requested_full_name), ''), full_name),
      updated_at = now()
  where id = target_staff_user_id;

  insert into public.pharmacy_staff_permissions (
    staff_user_id, owner_user_id, staff_role, permissions, updated_at
  ) values (
    target_staff_user_id,
    current_user_id,
    requested_role,
    coalesce(requested_permissions, '{}'::jsonb),
    now()
  )
  on conflict (staff_user_id) do update
    set owner_user_id = excluded.owner_user_id,
        staff_role = excluded.staff_role,
        permissions = excluded.permissions,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.delete_pharmacy_staff_member(target_staff_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if not exists (
    select 1
    from public.user_profiles as owner
    join public.pharmacies as pharmacy
      on pharmacy.owner_user_id = owner.id
    where owner.id = current_user_id
      and owner.role = 'pharmacy_user'
      and owner.approval_status = 'approved'
      and pharmacy.approval_status = 'approved'
  ) then
    raise exception 'Only an approved pharmacy owner can delete staff accounts';
  end if;

  delete from auth.users as auth_user
  using public.pharmacy_staff_invites as invite
  where auth_user.id = target_staff_user_id
    and invite.used_by = target_staff_user_id
    and invite.owner_user_id = current_user_id;

  if not found then
    raise exception 'This staff account does not belong to your pharmacy';
  end if;
end;
$$;

revoke all on function public.pharmacy_staff_has_permission(uuid, text, text) from public, anon;
revoke all on function public.get_pharmacy_staff_members() from public, anon;
revoke all on function public.manage_pharmacy_staff_access(uuid, text, jsonb, text, text, text) from public, anon;
revoke all on function public.delete_pharmacy_staff_member(uuid) from public, anon;
grant execute on function public.pharmacy_staff_has_permission(uuid, text, text) to authenticated;
grant execute on function public.get_pharmacy_staff_members() to authenticated;
grant execute on function public.manage_pharmacy_staff_access(uuid, text, jsonb, text, text, text) to authenticated;
grant execute on function public.delete_pharmacy_staff_member(uuid) to authenticated;
