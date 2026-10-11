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
      when 'boolean' then (access.permissions -> requested_page) = 'true'::jsonb
      when 'object' then (access.permissions -> requested_page ->> requested_action) = 'true'
      else false
    end
    from public.pharmacy_staff_permissions as access
    join public.user_profiles as staff
      on staff.id = access.staff_user_id
    where access.staff_user_id = (select auth.uid())
      and access.owner_user_id = requested_owner_id
      and staff.role = 'pharmacy_staff'
      and staff.approval_status = 'approved'
      and requested_action in ('view', 'create', 'edit', 'delete')
  ), false);
$$;

revoke all on function public.pharmacy_staff_has_permission(uuid, text, text) from public, anon;
grant execute on function public.pharmacy_staff_has_permission(uuid, text, text) to authenticated;
