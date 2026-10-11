create or replace function public.get_my_pharmacy_subscription_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assigned_plan_id uuid;
  subscription_status text;
  payment_method text;
  pay_amount numeric;
  selected_plan jsonb;
  has_assigned_plan boolean := false;
begin
  if current_user_id is null then
    raise exception 'Sign in to view your subscription plan';
  end if;

  if not exists (
    select 1
    from public.user_profiles as profile
    join public.pharmacies as pharmacy on pharmacy.owner_user_id = profile.id
    where profile.id = current_user_id
      and profile.role = 'pharmacy_user'
  ) then
    raise exception 'A pharmacy owner account is required to view this subscription plan';
  end if;

  select subscription.plan_id,
         subscription.status,
         subscription.payment_method,
         subscription.pay_amount
  into assigned_plan_id, subscription_status, payment_method, pay_amount
  from public.pharmacy_subscriptions as subscription
  where subscription.owner_user_id = current_user_id;

  if assigned_plan_id is not null then
    select to_jsonb(plan_row)
    into selected_plan
    from (
      select id, name, setup_fee_label, setup_fee, recurring_fee,
             billing_period, billing_interval, description
      from public.pharmacy_subscription_plans
      where id = assigned_plan_id
    ) as plan_row;
    has_assigned_plan := found;
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
    'payment_method', coalesce(payment_method, ''),
    'pay_amount', coalesce(pay_amount, 0)
  );
end;
$$;

revoke all on function public.get_my_pharmacy_subscription_plan() from public, anon;
grant execute on function public.get_my_pharmacy_subscription_plan() to authenticated;
