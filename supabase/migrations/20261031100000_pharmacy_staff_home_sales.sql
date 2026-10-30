create or replace function public.get_my_pharmacy_staff_sales()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  owner_id uuid;
  sales_payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Sign in to view your sales';
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
    or not public.pharmacy_user_can_access_page(owner_id, 'sales', 'view') then
    raise exception 'Approved staff sales access is required';
  end if;

  select data.payload
  into sales_payload
  from public.pharmacy_app_data as data
  where data.owner_user_id = owner_id
    and data.data_key = 'pharmacy-sales-list-v1';

  if sales_payload is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(sales_payload) <> 'array' then
    raise exception 'Saved sales data has an invalid format';
  end if;

  return coalesce(
    (
      select jsonb_agg(sale.value order by sale.ordinality)
      from jsonb_array_elements(sales_payload) with ordinality as sale(value, ordinality)
      where sale.value ->> 'createdByUserId' = current_user_id::text
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_my_pharmacy_staff_sales() from public, anon;
grant execute on function public.get_my_pharmacy_staff_sales() to authenticated;
