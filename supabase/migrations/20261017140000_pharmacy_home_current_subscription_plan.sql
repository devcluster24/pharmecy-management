create or replace function public.get_pharmacy_home_current_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  pharmacy_owner_id uuid;
  assigned_plan_id uuid;
  subscription_status text;
  subscription_started_at timestamptz;
  billing_period_override text;
  billing_interval_override integer;
  assigned_billing_period text;
  assigned_billing_interval integer;
  plan_expires_at timestamptz;
  selected_plan jsonb;
  has_assigned_plan boolean := false;
begin
  if current_user_id is null then
    raise exception 'Sign in to view the current subscription plan';
  end if;

  pharmacy_owner_id := public.pharmacy_staff_owner_id(current_user_id);
  if pharmacy_owner_id is null then
    pharmacy_owner_id := current_user_id;
  end if;

  if not exists (
    select 1
    from public.user_profiles as owner
    join public.pharmacies as pharmacy on pharmacy.owner_user_id = owner.id
    where owner.id = pharmacy_owner_id
      and owner.role = 'pharmacy_user'
      and owner.approval_status = 'approved'
  ) then
    raise exception 'An approved pharmacy account is required to view the current plan';
  end if;

  if current_user_id <> pharmacy_owner_id
    and not public.pharmacy_user_can_access_page(pharmacy_owner_id, 'settings', 'view') then
    raise exception 'You do not have permission to view subscription settings';
  end if;

  select subscription.plan_id,
         subscription.status,
         subscription.started_at,
         subscription.billing_period_override,
         subscription.billing_interval_override
  into assigned_plan_id,
       subscription_status,
       subscription_started_at,
       billing_period_override,
       billing_interval_override
  from public.pharmacy_subscriptions as subscription
  where subscription.owner_user_id = pharmacy_owner_id;

  if assigned_plan_id is not null then
    select to_jsonb(plan_row),
           coalesce(billing_period_override, plan_row.billing_period),
           coalesce(billing_interval_override, plan_row.billing_interval)
    into selected_plan, assigned_billing_period, assigned_billing_interval
    from (
      select id, name, setup_fee_label, setup_fee, recurring_fee,
             billing_period, billing_interval, description
      from public.pharmacy_subscription_plans
      where id = assigned_plan_id
    ) as plan_row;
    has_assigned_plan := found;
  end if;

  if has_assigned_plan and assigned_billing_period <> 'one-time' then
    plan_expires_at := subscription_started_at + case assigned_billing_period
      when 'minutes' then assigned_billing_interval * interval '1 minute'
      when 'days' then assigned_billing_interval * interval '1 day'
      when 'month' then assigned_billing_interval * interval '1 month'
      when 'year' then assigned_billing_interval * interval '1 year'
    end;
  end if;

  if selected_plan is null then
    select to_jsonb(plan_row)
    into selected_plan
    from (
      select id, name, setup_fee_label, setup_fee, recurring_fee,
             billing_period, billing_interval, description
      from public.pharmacy_subscription_plans
      where lower(btrim(name)) = 'starter access'
      order by (name = 'Starter Access') desc, created_at asc
      limit 1
    ) as plan_row;
  end if;

  return jsonb_build_object(
    'plan', selected_plan,
    'is_assigned', has_assigned_plan,
    'status', subscription_status,
    'expires_at', plan_expires_at
  );
end;
$$;

revoke all on function public.get_pharmacy_home_current_plan() from public, anon;
grant execute on function public.get_pharmacy_home_current_plan() to authenticated;
