create index if not exists pharmacy_activity_feed_owner_actor_created_idx
  on public.pharmacy_activity_feed (owner_user_id, actor_user_id, created_at desc);

create or replace function public.get_my_pharmacy_staff_dashboard_context()
returns table (
  owner_user_id uuid,
  store_name text,
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
  if current_user_id is null or not exists (
    select 1
    from public.user_profiles as staff
    join public.pharmacy_staff_invites as invite
      on invite.used_by = staff.id
    join public.pharmacies as pharmacy
      on pharmacy.owner_user_id = invite.owner_user_id
    where staff.id = current_user_id
      and staff.role = 'pharmacy_staff'
      and staff.approval_status = 'approved'
      and pharmacy.approval_status = 'approved'
  ) then
    raise exception 'An approved pharmacy staff account is required';
  end if;

  return query
  select pharmacy.owner_user_id,
         pharmacy.store_name,
         coalesce(access.staff_role, 'Staff'),
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

create or replace function public.get_my_pharmacy_staff_activity_for_day(
  requested_start timestamptz,
  requested_end timestamptz
)
returns table (
  id uuid,
  event_type text,
  title text,
  description text,
  metadata jsonb,
  created_at timestamptz,
  actor_username text,
  actor_photo_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  owner_id uuid;
begin
  if current_user_id is null then
    raise exception 'Sign in to view staff activity';
  end if;
  if requested_start is null
    or requested_end is null
    or requested_start >= requested_end
    or requested_end - requested_start > interval '2 days' then
    raise exception 'A valid one-day activity date range is required';
  end if;

  select invite.owner_user_id
  into owner_id
  from public.user_profiles as staff
  join public.pharmacy_staff_invites as invite
    on invite.used_by = staff.id
  join public.pharmacies as pharmacy
    on pharmacy.owner_user_id = invite.owner_user_id
  where staff.id = current_user_id
    and staff.role = 'pharmacy_staff'
    and staff.approval_status = 'approved'
    and pharmacy.approval_status = 'approved'
  limit 1;

  if owner_id is null then
    raise exception 'An approved pharmacy staff account is required';
  end if;

  return query
  select feed.id,
         feed.event_type,
         feed.title,
         feed.description,
         feed.metadata,
         feed.created_at,
         coalesce(nullif(profile.username, ''), nullif(profile.full_name, ''), 'User'),
         coalesce(
           auth_user.raw_user_meta_data ->> 'avatar_url',
           auth_user.raw_user_meta_data ->> 'picture',
           auth_user.raw_user_meta_data ->> 'profile_photo_url',
           auth_user.raw_user_meta_data ->> 'photo_url'
         )
  from public.pharmacy_activity_feed as feed
  left join public.user_profiles as profile
    on profile.id = feed.actor_user_id
  left join auth.users as auth_user
    on auth_user.id = feed.actor_user_id
  where feed.owner_user_id = owner_id
    and feed.actor_user_id = current_user_id
    and feed.created_at >= requested_start
    and feed.created_at < requested_end
  order by feed.created_at desc;
end;
$$;

create or replace function public.get_my_pharmacy_staff_home_inventory()
returns table (
  purchase_payload jsonb,
  low_stock_threshold jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  owner_id uuid;
  inventory_payload jsonb;
  threshold_payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Sign in to view pharmacy inventory';
  end if;

  select invite.owner_user_id
  into owner_id
  from public.user_profiles as staff
  join public.pharmacy_staff_invites as invite
    on invite.used_by = staff.id
  join public.pharmacies as pharmacy
    on pharmacy.owner_user_id = invite.owner_user_id
  where staff.id = current_user_id
    and staff.role = 'pharmacy_staff'
    and staff.approval_status = 'approved'
    and pharmacy.approval_status = 'approved'
  limit 1;

  if owner_id is null
    or (
      not public.pharmacy_user_can_access_page(owner_id, 'inventory', 'view')
      and not public.pharmacy_user_can_access_page(owner_id, 'purchase', 'view')
    ) then
    raise exception 'Staff access denied: inventory permission is required';
  end if;

  select data.payload
  into inventory_payload
  from public.pharmacy_app_data as data
  where data.owner_user_id = owner_id
    and data.data_key = 'pharmacy-purchase-list-v1';

  select data.payload
  into threshold_payload
  from public.pharmacy_app_data as data
  where data.owner_user_id = owner_id
    and data.data_key = 'pharmacy-low-stock-threshold-v1';

  return query
  select coalesce(inventory_payload, '[]'::jsonb),
         threshold_payload;
end;
$$;

revoke all on function public.get_my_pharmacy_staff_dashboard_context() from public, anon;
revoke all on function public.get_my_pharmacy_staff_activity_for_day(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.get_my_pharmacy_staff_home_inventory() from public, anon;
grant execute on function public.get_my_pharmacy_staff_dashboard_context() to authenticated;
grant execute on function public.get_my_pharmacy_staff_activity_for_day(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.get_my_pharmacy_staff_home_inventory() to authenticated;
