do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pharmacy_subscription_plans'
      and column_name = 'amount'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pharmacy_subscription_plans'
      and column_name = 'recurring_fee'
  ) then
    alter table public.pharmacy_subscription_plans
      rename column amount to recurring_fee;
  end if;
end;
$$;

alter table public.pharmacy_subscription_plans
  add column if not exists setup_fee numeric(12, 2) not null default 0,
  add column if not exists recurring_fee numeric(12, 2) not null default 0,
  add column if not exists billing_interval integer not null default 1;

alter table public.pharmacy_subscription_plans
  drop constraint if exists pharmacy_subscription_plans_billing_period_check,
  drop constraint if exists pharmacy_subscription_plans_supported_period_check,
  drop constraint if exists pharmacy_subscription_plans_billing_interval_check,
  drop constraint if exists pharmacy_subscription_plans_fees_nonnegative_check,
  add constraint pharmacy_subscription_plans_supported_period_check
    check (billing_period in ('days', 'month', 'year', 'one-time')),
  add constraint pharmacy_subscription_plans_fees_nonnegative_check
    check (setup_fee >= 0 and recurring_fee >= 0),
  add constraint pharmacy_subscription_plans_billing_interval_check
    check (
      (billing_period = 'days' and billing_interval >= 1)
      or (billing_period = 'month' and billing_interval between 1 and 12)
      or (billing_period = 'year' and billing_interval between 1 and 3)
      or (billing_period = 'one-time' and billing_interval = 1)
    );

create or replace function public.admin_get_pharmacy_subscriptions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plans_json jsonb;
  owners_json jsonb;
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscriptions';
  end if;

  select coalesce(jsonb_agg(to_jsonb(plan_row) order by plan_row.recurring_fee, plan_row.name), '[]'::jsonb)
  into plans_json
  from (
    select id, name, setup_fee, recurring_fee, billing_period, billing_interval, description
    from public.pharmacy_subscription_plans
  ) as plan_row;

  select coalesce(jsonb_agg(to_jsonb(owner_row) order by owner_row.created_at desc), '[]'::jsonb)
  into owners_json
  from (
    select profile.id as owner_user_id,
           pharmacy.store_name as pharmacy_name,
           profile.full_name,
           profile.email,
           profile.created_at,
           subscription.plan_id,
           plan.name as plan_name,
           coalesce(subscription.payment_method, '') as payment_method,
           coalesce(subscription.pay_amount, 0) as pay_amount,
           coalesce(subscription.status, 'Inactive') as status,
           profile.approval_status = 'suspended' as is_suspended
    from public.user_profiles as profile
    join public.pharmacies as pharmacy
      on pharmacy.owner_user_id = profile.id
    left join public.pharmacy_subscriptions as subscription
      on subscription.owner_user_id = profile.id
    left join public.pharmacy_subscription_plans as plan
      on plan.id = subscription.plan_id
    where profile.role = 'pharmacy_user'
  ) as owner_row;

  return jsonb_build_object('plans', plans_json, 'owners', owners_json);
end;
$$;

drop function if exists public.admin_save_pharmacy_subscription_plan(uuid, text, numeric, text, text);

create function public.admin_save_pharmacy_subscription_plan(
  target_plan_id uuid,
  requested_name text,
  requested_setup_fee numeric,
  requested_recurring_fee numeric,
  requested_billing_period text,
  requested_billing_interval integer,
  requested_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_plan_id uuid;
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscription plans';
  end if;
  if requested_name is null or length(btrim(requested_name)) not between 1 and 80 then
    raise exception 'Plan name must contain between 1 and 80 characters';
  end if;
  if requested_setup_fee is null or requested_setup_fee < 0
    or requested_recurring_fee is null or requested_recurring_fee < 0 then
    raise exception 'Plan fees must be zero or greater';
  end if;
  if requested_billing_period is null
    or requested_billing_period not in ('days', 'month', 'year', 'one-time') then
    raise exception 'Invalid plan billing period';
  end if;
  if requested_billing_interval is null
    or (requested_billing_period = 'days' and requested_billing_interval < 1)
    or (requested_billing_period = 'month' and requested_billing_interval not between 1 and 12)
    or (requested_billing_period = 'year' and requested_billing_interval not between 1 and 3)
    or (requested_billing_period = 'one-time' and requested_billing_interval <> 1) then
    raise exception 'Billing interval is invalid for the selected period';
  end if;

  if target_plan_id is null then
    insert into public.pharmacy_subscription_plans (
      name, setup_fee, recurring_fee, billing_period, billing_interval, description
    ) values (
      btrim(requested_name),
      requested_setup_fee,
      requested_recurring_fee,
      requested_billing_period,
      requested_billing_interval,
      coalesce(requested_description, '')
    )
    returning id into saved_plan_id;
  else
    update public.pharmacy_subscription_plans
    set name = btrim(requested_name),
        setup_fee = requested_setup_fee,
        recurring_fee = requested_recurring_fee,
        billing_period = requested_billing_period,
        billing_interval = requested_billing_interval,
        description = coalesce(requested_description, ''),
        updated_at = now()
    where id = target_plan_id
    returning id into saved_plan_id;
    if saved_plan_id is null then
      raise exception 'Subscription plan not found';
    end if;
  end if;

  return saved_plan_id;
end;
$$;

revoke all on function public.admin_save_pharmacy_subscription_plan(uuid, text, numeric, numeric, text, integer, text)
  from public, anon;
grant execute on function public.admin_save_pharmacy_subscription_plan(uuid, text, numeric, numeric, text, integer, text)
  to authenticated;
