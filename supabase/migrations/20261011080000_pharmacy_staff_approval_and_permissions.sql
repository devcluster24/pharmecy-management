create table if not exists public.pharmacy_staff_permissions (
  staff_user_id uuid primary key references public.user_profiles(id) on delete cascade,
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(permissions) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.pharmacy_staff_permissions enable row level security;
revoke all on public.pharmacy_staff_permissions from anon, authenticated;

create or replace function public.pharmacy_staff_owner_id(staff_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select invite.owner_user_id
  from public.pharmacy_staff_invites as invite
  join public.user_profiles as staff
    on staff.id = invite.used_by
  where invite.used_by = staff_id
    and staff.role = 'pharmacy_staff'
    and staff.approval_status = 'approved'
  limit 1;
$$;

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
    select (access.permissions -> requested_page ->> requested_action)::boolean
    from public.pharmacy_staff_permissions as access
    join public.user_profiles as staff
      on staff.id = access.staff_user_id
    where access.staff_user_id = (select auth.uid())
      and access.owner_user_id = requested_owner_id
      and staff.role = 'pharmacy_staff'
      and staff.approval_status = 'approved'
  ), false);
$$;

create or replace function public.pharmacy_user_can_access_page(
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
  select (
    requested_owner_id = (select auth.uid())
    and exists (
      select 1
      from public.user_profiles as owner
      join public.pharmacies as pharmacy
        on pharmacy.owner_user_id = owner.id
      where owner.id = (select auth.uid())
        and owner.role = 'pharmacy_user'
        and owner.approval_status = 'approved'
        and pharmacy.approval_status = 'approved'
    )
  ) or (
    requested_action in ('view', 'create', 'edit', 'delete')
    and (select public.pharmacy_staff_has_permission(
      requested_owner_id,
      requested_page,
      requested_action
    ))
  );
$$;

create or replace function public.pharmacy_data_page(requested_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case requested_key
    when 'pharmecy-sales-list-v1' then 'sales'
    when 'pharmecy-purchase-list-v1' then 'purchase'
    when 'pharmecy-place-order-list-v1' then 'purchase'
    when 'pharmecy-expenses-v1' then 'expenses'
    when 'pharmecy-return-records-v1' then 'returns'
    when 'pharmecy-low-stock-threshold-v1' then 'settings'
    when 'pharmecy-payment-methods-v1' then 'settings'
    when 'pharmecy-vat-tax-settings-v1' then 'settings'
    when 'pharmecy-return-deduction-settings-v1' then 'settings'
    when 'pharmecy-supplier-status-v1' then 'suppliers'
    when 'pharmecy-supplier-due-adjustments-v1' then 'suppliers'
    when 'pharmecy-supplier-due-payments-v1' then 'suppliers'
  end;
$$;

create or replace function public.pharmacy_staff_can_write_data(
  requested_owner_id uuid,
  requested_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.pharmacy_user_can_access_page(
    requested_owner_id, public.pharmacy_data_page(requested_key), 'view'
  )) and (
    (select public.pharmacy_user_can_access_page(
      requested_owner_id, public.pharmacy_data_page(requested_key), 'create'
    )) or (select public.pharmacy_user_can_access_page(
      requested_owner_id, public.pharmacy_data_page(requested_key), 'edit'
    )) or (select public.pharmacy_user_can_access_page(
      requested_owner_id, public.pharmacy_data_page(requested_key), 'delete'
    ))
  );
$$;

create or replace function public.enforce_pharmacy_staff_data_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  page_name text := public.pharmacy_data_page(old.data_key);
  is_staff boolean := public.pharmacy_staff_owner_id((select auth.uid())) = old.owner_user_id;
begin
  if not is_staff then
    return new;
  end if;

  if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'view') then
    raise exception 'Staff access denied: view permission is required for this page';
  end if;

  if old.payload = new.payload then
    return new;
  end if;

  if new.payload @> old.payload then
    if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'create') then
      raise exception 'Staff access denied: create permission is required for this page';
    end if;
    return new;
  end if;

  if old.payload @> new.payload then
    if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'delete') then
      raise exception 'Staff access denied: delete permission is required for this page';
    end if;
    return new;
  end if;

  if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'edit') then
    raise exception 'Staff access denied: edit permission is required for this page';
  end if;

  return new;
end;
$$;

drop trigger if exists pharmacy_app_data_enforce_staff_action
  on public.pharmacy_app_data;
create trigger pharmacy_app_data_enforce_staff_action
before update on public.pharmacy_app_data
for each row execute function public.enforce_pharmacy_staff_data_action();

create or replace function public.get_my_pharmacy_dashboard_context()
returns table (
  owner_user_id uuid,
  store_name text,
  role text,
  approval_status text,
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
  if current_user_id is null then
    raise exception 'Sign in to load dashboard access';
  end if;

  return query
  select pharmacy.owner_user_id,
         pharmacy.store_name,
         profile.role,
         profile.approval_status,
         '{}'::jsonb
  from public.user_profiles as profile
  join public.pharmacies as pharmacy
    on pharmacy.owner_user_id = profile.id
  where profile.id = current_user_id
    and profile.role = 'pharmacy_user'
    and profile.approval_status = 'approved'
    and pharmacy.approval_status = 'approved';

  if found then
    return;
  end if;

  return query
  select invite.owner_user_id,
         pharmacy.store_name,
         staff.role,
         staff.approval_status,
         coalesce(access.permissions, '{}'::jsonb)
  from public.user_profiles as staff
  join public.pharmacy_staff_invites as invite
    on invite.used_by = staff.id
  join public.pharmacies as pharmacy
    on pharmacy.owner_user_id = invite.owner_user_id
  left join public.pharmacy_staff_permissions as access
    on access.staff_user_id = staff.id
   and access.owner_user_id = invite.owner_user_id
  where staff.id = current_user_id
    and staff.role = 'pharmacy_staff'
    and staff.approval_status = 'approved'
    and pharmacy.approval_status = 'approved'
  limit 1;
end;
$$;

create or replace function public.get_pharmacy_staff_members()
returns table (
  staff_user_id uuid,
  email text,
  full_name text,
  approval_status text,
  created_at timestamptz,
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
         profile.approval_status,
         profile.created_at,
         coalesce(access.permissions, '{}'::jsonb)
  from public.pharmacy_staff_invites as invite
  join public.user_profiles as profile
    on profile.id = invite.used_by
  left join public.pharmacy_staff_permissions as access
    on access.staff_user_id = profile.id
   and access.owner_user_id = current_user_id
  where invite.owner_user_id = current_user_id
    and profile.role = 'pharmacy_staff'
  order by profile.created_at desc;
end;
$$;

create or replace function public.manage_pharmacy_staff_access(
  target_staff_user_id uuid,
  requested_decision text,
  requested_permissions jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  page_entry record;
  action_entry record;
  allowed_pages text[] := array[
    'overview', 'product-management', 'sales', 'invoice', 'purchase',
    'inventory', 'returns', 'customers', 'suppliers', 'reports',
    'expenses', 'settings'
  ];
  allowed_actions text[] := array['view', 'create', 'edit', 'delete'];
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

  if requested_decision not in ('approve', 'reject', 'update_permissions') then
    raise exception 'Unsupported staff access decision';
  end if;

  if jsonb_typeof(coalesce(requested_permissions, '{}'::jsonb)) <> 'object' then
    raise exception 'Staff permissions must be an object';
  end if;

  for page_entry in
    select key, value
    from jsonb_each(coalesce(requested_permissions, '{}'::jsonb))
  loop
    if not (page_entry.key = any(allowed_pages))
      or jsonb_typeof(page_entry.value) <> 'object' then
      raise exception 'Invalid staff page permission';
    end if;

    for action_entry in select key, value from jsonb_each(page_entry.value)
    loop
      if not (action_entry.key = any(allowed_actions))
        or jsonb_typeof(action_entry.value) <> 'boolean' then
        raise exception 'Invalid staff action permission';
      end if;
    end loop;

    if exists (
      select 1
      from jsonb_each_text(page_entry.value) as setting(action_name, is_enabled)
      where setting.action_name <> 'view'
        and setting.is_enabled = 'true'
    ) and coalesce((page_entry.value ->> 'view')::boolean, false) is not true then
      raise exception 'View access is required before assigning page actions';
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

  if requested_decision = 'reject' then
    update public.user_profiles
    set approval_status = 'rejected',
        updated_at = now()
    where id = target_staff_user_id
      and approval_status = 'pending';
    if not found then
      raise exception 'Only pending staff applications can be rejected';
    end if;
    delete from public.pharmacy_staff_permissions
    where staff_user_id = target_staff_user_id;
    return;
  end if;

  if requested_decision = 'approve' then
    update public.user_profiles
    set role = 'pharmacy_staff',
        approval_status = 'approved',
        updated_at = now()
    where id = target_staff_user_id
      and approval_status in ('pending', 'rejected');
    if not found then
      raise exception 'This staff account is already approved';
    end if;
  elsif not exists (
    select 1
    from public.user_profiles as staff
    where staff.id = target_staff_user_id
      and staff.role = 'pharmacy_staff'
      and staff.approval_status = 'approved'
  ) then
    raise exception 'Only approved staff permissions can be updated';
  end if;

  insert into public.pharmacy_staff_permissions (
    staff_user_id, owner_user_id, permissions, updated_at
  ) values (
    target_staff_user_id,
    current_user_id,
    coalesce(requested_permissions, '{}'::jsonb),
    now()
  )
  on conflict (staff_user_id) do update
    set owner_user_id = excluded.owner_user_id,
        permissions = excluded.permissions,
        updated_at = excluded.updated_at;
end;
$$;

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
      approval_status = 'pending',
      username = 'staff_' || replace(current_user_id::text, '-', ''),
      full_name = coalesce(
        nullif(trim((select raw_user_meta_data ->> 'full_name' from auth.users where id = current_user_id)), ''),
        split_part(current_email, '@', 1)
      ),
      updated_at = now()
  where id = current_user_id
    and role = 'pharmacy_user'
    and approval_status in ('pending', 'approved')
    and not exists (
      select 1
      from public.pharmacies as pharmacy
      where pharmacy.owner_user_id = current_user_id
    );

  if not found then
    raise exception 'This account cannot be used to complete a staff invitation';
  end if;

  update public.pharmacy_staff_invites
  set used_by = current_user_id,
      used_at = now()
  where id = invitation_id;
end;
$$;

drop policy if exists pharmacies_read_owner_or_superadmin
  on public.pharmacies;
create policy pharmacies_read_owner_or_superadmin
on public.pharmacies
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or (select public.is_superadmin())
  or (select public.pharmacy_staff_owner_id((select auth.uid()))) = owner_user_id
);

drop policy if exists pharmacy_app_data_owner_access
  on public.pharmacy_app_data;
create policy pharmacy_app_data_owner_access
on public.pharmacy_app_data
for select to authenticated
using (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1
      from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    (select public.pharmacy_user_can_access_page(
    owner_user_id,
    public.pharmacy_data_page(data_key),
    'view'
    ))
    or (
      data_key in (
        'pharmecy-supplier-status-v1',
        'pharmecy-supplier-due-adjustments-v1',
        'pharmecy-supplier-due-payments-v1'
      )
      and (select public.pharmacy_user_can_access_page(owner_user_id, 'reports', 'view'))
    )
  )
);

drop policy if exists pharmacy_app_data_staff_insert
  on public.pharmacy_app_data;
create policy pharmacy_app_data_staff_insert
on public.pharmacy_app_data
for insert to authenticated
with check (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1
      from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_user_can_access_page(
      owner_user_id,
      public.pharmacy_data_page(data_key),
      'create'
    ))
  )
);

drop policy if exists pharmacy_app_data_staff_update
  on public.pharmacy_app_data;
create policy pharmacy_app_data_staff_update
on public.pharmacy_app_data
for update to authenticated
using (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_user_can_access_page(owner_user_id, public.pharmacy_data_page(data_key), 'view'))
  )
);

drop policy if exists pharmacy_catalog_products_staff_insert
  on public.pharmacy_catalog_products;
create policy pharmacy_catalog_products_staff_insert
on public.pharmacy_catalog_products
for insert to authenticated
with check (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_staff_has_permission(owner_user_id, 'product-management', 'create'))
  )
);

drop policy if exists pharmacy_app_data_staff_delete
  on public.pharmacy_app_data;
create policy pharmacy_app_data_staff_delete
on public.pharmacy_app_data
for delete to authenticated
using (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_user_can_access_page(owner_user_id, public.pharmacy_data_page(data_key), 'view'))
    and (select public.pharmacy_user_can_access_page(owner_user_id, public.pharmacy_data_page(data_key), 'delete'))
  )
);

drop policy if exists pharmacy_catalog_products_owner_access
  on public.pharmacy_catalog_products;
create policy pharmacy_catalog_products_owner_access
on public.pharmacy_catalog_products
for select to authenticated
using (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1
      from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_staff_has_permission(owner_user_id, 'product-management', 'view'))
  )
);

drop policy if exists pharmacy_catalog_products_staff_update
  on public.pharmacy_catalog_products;
create policy pharmacy_catalog_products_staff_update
on public.pharmacy_catalog_products
for update to authenticated
using (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_staff_has_permission(owner_user_id, 'product-management', 'view'))
  )
)
with check (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_staff_has_permission(owner_user_id, 'product-management', 'edit'))
  )
);

drop policy if exists pharmacy_catalog_products_staff_delete
  on public.pharmacy_catalog_products;
create policy pharmacy_catalog_products_staff_delete
on public.pharmacy_catalog_products
for delete to authenticated
using (
  (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'pharmacy_user'
        and profile.approval_status = 'approved'
    )
  )
  or (
    owner_user_id = (select public.pharmacy_staff_owner_id((select auth.uid())))
    and (select public.pharmacy_staff_has_permission(owner_user_id, 'product-management', 'view'))
    and (select public.pharmacy_staff_has_permission(owner_user_id, 'product-management', 'delete'))
  )
);

revoke all on function public.pharmacy_staff_owner_id(uuid) from public, anon;
revoke all on function public.pharmacy_staff_has_permission(uuid, text, text) from public, anon;
revoke all on function public.pharmacy_user_can_access_page(uuid, text, text) from public, anon;
revoke all on function public.pharmacy_data_page(text) from public, anon;
revoke all on function public.pharmacy_staff_can_write_data(uuid, text) from public, anon;
revoke all on function public.enforce_pharmacy_staff_data_action() from public, anon;
revoke all on function public.get_my_pharmacy_dashboard_context() from public, anon;
revoke all on function public.get_pharmacy_staff_members() from public, anon;
revoke all on function public.manage_pharmacy_staff_access(uuid, text, jsonb) from public, anon;
grant execute on function public.pharmacy_staff_owner_id(uuid) to authenticated;
grant execute on function public.pharmacy_staff_has_permission(uuid, text, text) to authenticated;
grant execute on function public.pharmacy_user_can_access_page(uuid, text, text) to authenticated;
grant execute on function public.pharmacy_data_page(text) to authenticated;
grant execute on function public.pharmacy_staff_can_write_data(uuid, text) to authenticated;
grant execute on function public.get_my_pharmacy_dashboard_context() to authenticated;
grant execute on function public.get_pharmacy_staff_members() to authenticated;
grant execute on function public.manage_pharmacy_staff_access(uuid, text, jsonb) to authenticated;
