create or replace function public.admin_get_admin_management()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can view admin accounts';
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

revoke all on function public.admin_get_admin_management() from public, anon;
grant execute on function public.admin_get_admin_management() to authenticated;
