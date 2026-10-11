alter table public.pharmacy_subscriptions
  add column if not exists started_at timestamptz;

update public.pharmacy_subscriptions
set started_at = updated_at
where started_at is null;

alter table public.pharmacy_subscriptions
  alter column started_at set default now(),
  alter column started_at set not null;

create or replace function public.set_pharmacy_subscription_started_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.started_at := coalesce(new.started_at, new.updated_at, now());
  elsif new.plan_id is distinct from old.plan_id then
    new.started_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_subscription_started_at_trigger
  on public.pharmacy_subscriptions;
create trigger pharmacy_subscription_started_at_trigger
  before insert or update on public.pharmacy_subscriptions
  for each row
  execute function public.set_pharmacy_subscription_started_at();

alter table public.pharmacy_subscription_payment_history
  add column if not exists expires_at timestamptz;

update public.pharmacy_subscription_payment_history as history
set expires_at = case plan.billing_period
  when 'minutes' then history.occurred_at + plan.billing_interval * interval '1 minute'
  when 'days' then history.occurred_at + plan.billing_interval * interval '1 day'
  when 'month' then history.occurred_at + plan.billing_interval * interval '1 month'
  when 'year' then history.occurred_at + plan.billing_interval * interval '1 year'
  else null
end
from public.pharmacy_subscription_plans as plan
where plan.id = history.plan_id
  and history.expires_at is null;

create or replace function public.record_pharmacy_subscription_payment_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_plan_name text;
  selected_plan_period text;
  selected_plan_interval integer;
  should_record boolean := false;
begin
  if new.plan_id is null or new.status <> 'Active' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_record := true;
  else
    should_record := old.plan_id is distinct from new.plan_id
      or old.pay_amount is distinct from new.pay_amount
      or old.payment_method is distinct from new.payment_method
      or old.status is distinct from new.status;
  end if;

  if should_record then
    select plan.name, plan.billing_period, plan.billing_interval
    into selected_plan_name, selected_plan_period, selected_plan_interval
    from public.pharmacy_subscription_plans as plan
    where plan.id = new.plan_id;

    insert into public.pharmacy_subscription_payment_history (
      owner_user_id,
      plan_id,
      plan_name,
      amount,
      payment_method,
      status,
      expires_at
    ) values (
      new.owner_user_id,
      new.plan_id,
      coalesce(selected_plan_name, 'Removed subscription plan'),
      new.pay_amount,
      new.payment_method,
      new.status,
      case selected_plan_period
        when 'minutes' then now() + selected_plan_interval * interval '1 minute'
        when 'days' then now() + selected_plan_interval * interval '1 day'
        when 'month' then now() + selected_plan_interval * interval '1 month'
        when 'year' then now() + selected_plan_interval * interval '1 year'
        else null
      end
    );
  end if;

  return new;
end;
$$;

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
  subscription_started_at timestamptz;
  plan_expires_at timestamptz;
  assigned_billing_period text;
  assigned_billing_interval integer;
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
         subscription.pay_amount,
         subscription.started_at
  into assigned_plan_id, subscription_status, payment_method, pay_amount, subscription_started_at
  from public.pharmacy_subscriptions as subscription
  where subscription.owner_user_id = current_user_id;

  if assigned_plan_id is not null then
    select to_jsonb(plan_row),
           plan_row.billing_period,
           plan_row.billing_interval
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
    'pay_amount', coalesce(pay_amount, 0),
    'assigned_at', subscription_started_at,
    'expires_at', plan_expires_at
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

    update public.pharmacy_subscriptions
    set status = 'Inactive'
    where owner_user_id = current_user_id;
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

create or replace function public.get_my_pharmacy_subscription_payment_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  history_json jsonb;
begin
  if current_user_id is null then
    raise exception 'Sign in to view payment history';
  end if;

  if not exists (
    select 1
    from public.user_profiles as profile
    join public.pharmacies as pharmacy on pharmacy.owner_user_id = profile.id
    where profile.id = current_user_id
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  ) then
    raise exception 'An approved pharmacy owner account is required to view payment history';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', history.id,
        'plan_name', history.plan_name,
        'amount', history.amount,
        'payment_method', history.payment_method,
        'status', history.status,
        'occurred_at', history.occurred_at,
        'expires_at', history.expires_at
      )
      order by history.occurred_at desc, history.id desc
    ),
    '[]'::jsonb
  )
  into history_json
  from public.pharmacy_subscription_payment_history as history
  where history.owner_user_id = current_user_id;

  return history_json;
end;
$$;

revoke all on function public.get_my_pharmacy_subscription_plan() from public, anon;
grant execute on function public.get_my_pharmacy_subscription_plan() to authenticated;
revoke all on function public.complete_my_pharmacy_demo_subscription(uuid, text) from public, anon;
grant execute on function public.complete_my_pharmacy_demo_subscription(uuid, text) to authenticated;
revoke all on function public.get_my_pharmacy_subscription_payment_history() from public, anon;
grant execute on function public.get_my_pharmacy_subscription_payment_history() to authenticated;
