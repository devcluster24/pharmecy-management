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
  plans_json jsonb;
  has_assigned_plan boolean := false;
begin
  if current_user_id is null then
    raise exception 'Sign in to view subscription plans';
  end if;

  if not exists (
    select 1
    from public.user_profiles as profile
    join public.pharmacies as pharmacy on pharmacy.owner_user_id = profile.id
    where profile.id = current_user_id
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  ) then
    raise exception 'An approved pharmacy owner account is required to view subscription plans';
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', plan_row.id,
        'name', plan_row.name,
        'setup_fee_label', plan_row.setup_fee_label,
        'setup_fee', plan_row.setup_fee,
        'recurring_fee', plan_row.recurring_fee,
        'billing_period', plan_row.billing_period,
        'billing_interval', plan_row.billing_interval,
        'description', plan_row.description
      )
      order by plan_row.created_at, plan_row.name
    ),
    '[]'::jsonb
  )
  into plans_json
  from (
    select id, name, setup_fee_label, setup_fee, recurring_fee,
           billing_period, billing_interval, description, created_at
    from public.pharmacy_subscription_plans
  ) as plan_row;

  return jsonb_build_object(
    'plan', selected_plan,
    'plans', plans_json,
    'is_assigned', has_assigned_plan,
    'status', subscription_status,
    'payment_method', coalesce(payment_method, ''),
    'pay_amount', coalesce(pay_amount, 0)
  );
end;
$$;

create or replace function public.complete_my_pharmacy_demo_subscription(
  target_plan_id uuid,
  requested_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_plan_id uuid;
  selected_total numeric;
  current_plan_id uuid;
  normalized_payment_method text := coalesce(requested_payment_method, '');
begin
  if current_user_id is null then
    raise exception 'Sign in to activate a pharmacy subscription';
  end if;

  perform 1
  from public.user_profiles as profile
  join public.pharmacies as pharmacy on pharmacy.owner_user_id = profile.id
  where profile.id = current_user_id
    and profile.role = 'pharmacy_user'
    and profile.approval_status = 'approved'
  for update of profile;
  if not found then
    raise exception 'An approved pharmacy owner account is required to activate a subscription';
  end if;

  select plan.id,
         plan.setup_fee + plan.recurring_fee
  into selected_plan_id, selected_total
  from public.pharmacy_subscription_plans as plan
  where plan.id = target_plan_id;
  if not found then
    raise exception 'The selected subscription plan was not found';
  end if;

  if selected_total < 0 then
    raise exception 'The selected subscription plan has an invalid amount';
  end if;

  if selected_total = 0 and normalized_payment_method <> '' then
    raise exception 'A payment method is not required for a free plan';
  elsif selected_total > 0 and normalized_payment_method not in ('bKash', 'Nagad') then
    raise exception 'Choose bKash or Nagad to complete the demo payment';
  end if;

  select subscription.plan_id
  into current_plan_id
  from public.pharmacy_subscriptions as subscription
  where subscription.owner_user_id = current_user_id
  for update;

  if current_plan_id is not null then
    raise exception 'A subscription is already assigned to this pharmacy account';
  end if;

  insert into public.pharmacy_subscriptions (
    owner_user_id, plan_id, payment_method, pay_amount, status, updated_at
  ) values (
    current_user_id,
    selected_plan_id,
    normalized_payment_method,
    selected_total,
    'Active',
    now()
  )
  on conflict (owner_user_id) do update
    set plan_id = excluded.plan_id,
        payment_method = excluded.payment_method,
        pay_amount = excluded.pay_amount,
        status = excluded.status,
        updated_at = now()
  where public.pharmacy_subscriptions.plan_id is null;

  if not found then
    raise exception 'A subscription is already assigned to this pharmacy account';
  end if;

  return selected_plan_id;
end;
$$;

revoke all on function public.get_my_pharmacy_subscription_plan() from public, anon;
grant execute on function public.get_my_pharmacy_subscription_plan() to authenticated;
revoke all on function public.complete_my_pharmacy_demo_subscription(uuid, text) from public, anon;
grant execute on function public.complete_my_pharmacy_demo_subscription(uuid, text) to authenticated;
