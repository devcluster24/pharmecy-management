create or replace function public.claim_my_pharmacy_extended_access()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_plan_name text;
  extended_plan_id uuid;
  extended_plan_total numeric;
begin
  if current_user_id is null then
    raise exception 'Sign in to claim Extended Access';
  end if;

  perform 1
  from public.user_profiles as profile
  join public.pharmacies as pharmacy on pharmacy.owner_user_id = profile.id
  where profile.id = current_user_id
    and profile.role = 'pharmacy_user'
    and profile.approval_status = 'approved'
  for update of profile;
  if not found then
    raise exception 'An approved pharmacy owner account is required to claim Extended Access';
  end if;

  select lower(btrim(plan.name))
  into current_plan_name
  from public.pharmacy_subscriptions as subscription
  join public.pharmacy_subscription_plans as plan on plan.id = subscription.plan_id
  where subscription.owner_user_id = current_user_id
  for update of subscription;

  if current_plan_name is distinct from 'starter access' then
    raise exception 'Extended Access can only be claimed from the Starter Access plan';
  end if;

  select plan.id, plan.setup_fee + plan.recurring_fee
  into extended_plan_id, extended_plan_total
  from public.pharmacy_subscription_plans as plan
  where lower(btrim(plan.name)) = 'extended access'
  order by (plan.name = 'Extended Access') desc, plan.created_at asc
  limit 1;

  if extended_plan_id is null then
    raise exception 'The Extended Access plan is not configured. Ask an administrator to add it';
  end if;

  if extended_plan_total <> 0 then
    raise exception 'Extended Access must be a free plan to claim it automatically';
  end if;

  update public.pharmacy_subscriptions
  set plan_id = extended_plan_id,
      payment_method = '',
      pay_amount = 0,
      status = 'Active',
      started_at = now(),
      updated_at = now()
  where owner_user_id = current_user_id;

  if not found then
    raise exception 'The Starter Access subscription could not be found';
  end if;

  return extended_plan_id;
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
  selected_plan_name text;
  selected_total numeric;
  current_plan_id uuid;
  current_plan_name text;
  existing_plan_period text;
  existing_plan_interval integer;
  existing_subscription_started_at timestamptz;
  existing_plan_expires_at timestamptz;
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
         lower(btrim(plan.name)),
         plan.setup_fee + plan.recurring_fee
  into selected_plan_id, selected_plan_name, selected_total
  from public.pharmacy_subscription_plans as plan
  where plan.id = target_plan_id;
  if not found then
    raise exception 'The selected subscription plan was not found';
  end if;

  select subscription.plan_id,
         lower(btrim(plan.name))
  into current_plan_id, current_plan_name
  from public.pharmacy_subscriptions as subscription
  left join public.pharmacy_subscription_plans as plan on plan.id = subscription.plan_id
  where subscription.owner_user_id = current_user_id
  for update of subscription;

  if current_plan_id is null then
    if selected_plan_name not in ('starter access', 'one-time setup') then
      raise exception 'New accounts can start with Starter Access or One-Time Setup';
    end if;
  elsif current_plan_name = 'starter access' then
    raise exception 'Claim Extended Access from Settings before selecting another plan';
  elsif current_plan_name = 'extended access' then
    if selected_plan_name <> 'one-time setup' then
      raise exception 'Extended Access can only be followed by One-Time Setup';
    end if;
  elsif current_plan_name in ('one-time setup', 'standard subscription') then
    if selected_plan_name <> 'standard subscription' then
      raise exception 'This plan can only be followed by Standard Subscription';
    end if;
  else
    select plan.billing_period,
           plan.billing_interval,
           subscription.started_at
    into existing_plan_period, existing_plan_interval, existing_subscription_started_at
    from public.pharmacy_subscriptions as subscription
    join public.pharmacy_subscription_plans as plan on plan.id = subscription.plan_id
    where subscription.owner_user_id = current_user_id;

    if existing_plan_period is null or existing_plan_period = 'one-time' then
      raise exception 'An active subscription is already assigned to this pharmacy account';
    end if;

    existing_plan_expires_at := existing_subscription_started_at + case existing_plan_period
      when 'minutes' then existing_plan_interval * interval '1 minute'
      when 'days' then existing_plan_interval * interval '1 day'
      when 'month' then existing_plan_interval * interval '1 month'
      when 'year' then existing_plan_interval * interval '1 year'
    end;

    if existing_plan_expires_at > now() then
      raise exception 'The current subscription must expire before choosing a new plan';
    end if;
  end if;

  if selected_total < 0 then
    raise exception 'The selected subscription plan has an invalid amount';
  end if;

  if selected_plan_name in ('one-time setup', 'standard subscription') and selected_total <= 0 then
    raise exception '% must have a payment amount greater than zero', initcap(selected_plan_name);
  end if;

  if selected_plan_name = 'extended access' then
    raise exception 'Extended Access must be claimed from Settings without payment';
  end if;

  if selected_total = 0 and normalized_payment_method <> '' then
    raise exception 'A payment method is not required for a free plan';
  elsif selected_total > 0 and normalized_payment_method not in ('bKash', 'Nagad') then
    raise exception 'Choose bKash or Nagad to complete the demo payment';
  end if;

  insert into public.pharmacy_subscriptions (
    owner_user_id, plan_id, payment_method, pay_amount, status, started_at, updated_at
  ) values (
    current_user_id,
    selected_plan_id,
    normalized_payment_method,
    selected_total,
    'Active',
    now(),
    now()
  )
  on conflict (owner_user_id) do update
    set plan_id = excluded.plan_id,
        payment_method = excluded.payment_method,
        pay_amount = excluded.pay_amount,
        status = excluded.status,
        started_at = now(),
        updated_at = now();

  return selected_plan_id;
end;
$$;

revoke all on function public.claim_my_pharmacy_extended_access() from public, anon;
grant execute on function public.claim_my_pharmacy_extended_access() to authenticated;
revoke all on function public.complete_my_pharmacy_demo_subscription(uuid, text) from public, anon;
grant execute on function public.complete_my_pharmacy_demo_subscription(uuid, text) to authenticated;
