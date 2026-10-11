create table if not exists public.pharmacy_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  billing_period text not null default 'month'
    check (billing_period in ('month', 'year', 'one-time')),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pharmacy_subscriptions (
  owner_user_id uuid primary key references public.user_profiles(id) on delete cascade,
  plan_id uuid references public.pharmacy_subscription_plans(id) on delete set null,
  payment_method text not null default '',
  pay_amount numeric(12, 2) not null default 0 check (pay_amount >= 0),
  status text not null default 'Inactive'
    check (status in ('Active', 'Inactive', 'Past Due')),
  updated_at timestamptz not null default now()
);

alter table public.pharmacy_subscription_plans enable row level security;
alter table public.pharmacy_subscriptions enable row level security;
revoke all on public.pharmacy_subscription_plans from anon, authenticated;
revoke all on public.pharmacy_subscriptions from anon, authenticated;

alter table public.user_profiles
  drop constraint if exists user_profiles_approval_status_check;
alter table public.user_profiles
  add constraint user_profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected', 'suspended'));

insert into public.pharmacy_subscription_plans (name, amount, billing_period, description)
select 'Free Plan', 0, 'month', 'A free plan for getting started.'
where not exists (select 1 from public.pharmacy_subscription_plans);

create or replace function public.is_subscription_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'superadmin')
      and profile.approval_status = 'approved'
  );
$$;

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

  select coalesce(jsonb_agg(to_jsonb(plan_row) order by plan_row.amount, plan_row.name), '[]'::jsonb)
  into plans_json
  from (
    select id, name, amount, billing_period, description
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

create or replace function public.admin_save_pharmacy_subscription_plan(
  target_plan_id uuid,
  requested_name text,
  requested_amount numeric,
  requested_billing_period text,
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
  if requested_amount is null or requested_amount < 0 then
    raise exception 'Plan amount must be zero or greater';
  end if;
  if requested_billing_period not in ('month', 'year', 'one-time') then
    raise exception 'Invalid plan billing period';
  end if;

  if target_plan_id is null then
    insert into public.pharmacy_subscription_plans (name, amount, billing_period, description)
    values (btrim(requested_name), requested_amount, requested_billing_period, coalesce(requested_description, ''))
    returning id into saved_plan_id;
  else
    update public.pharmacy_subscription_plans
    set name = btrim(requested_name),
        amount = requested_amount,
        billing_period = requested_billing_period,
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

create or replace function public.admin_delete_pharmacy_subscription_plan(target_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscription plans';
  end if;
  delete from public.pharmacy_subscription_plans where id = target_plan_id;
  if not found then
    raise exception 'Subscription plan not found';
  end if;
end;
$$;

create or replace function public.admin_save_pharmacy_subscription(
  target_owner_user_id uuid,
  requested_plan_id uuid,
  requested_payment_method text,
  requested_pay_amount numeric,
  requested_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscriptions';
  end if;
  if not exists (
    select 1
    from public.user_profiles as profile
    join public.pharmacies as pharmacy on pharmacy.owner_user_id = profile.id
    where profile.id = target_owner_user_id
      and profile.role = 'pharmacy_user'
  ) then
    raise exception 'Pharmacy owner account not found';
  end if;
  if requested_plan_id is not null
    and not exists (select 1 from public.pharmacy_subscription_plans where id = requested_plan_id) then
    raise exception 'Subscription plan not found';
  end if;
  if requested_pay_amount is null or requested_pay_amount < 0 then
    raise exception 'Payment amount must be zero or greater';
  end if;
  if requested_status not in ('Active', 'Inactive', 'Past Due') then
    raise exception 'Invalid subscription status';
  end if;

  insert into public.pharmacy_subscriptions (
    owner_user_id, plan_id, payment_method, pay_amount, status, updated_at
  ) values (
    target_owner_user_id,
    requested_plan_id,
    coalesce(requested_payment_method, ''),
    requested_pay_amount,
    requested_status,
    now()
  )
  on conflict (owner_user_id) do update
    set plan_id = excluded.plan_id,
        payment_method = excluded.payment_method,
        pay_amount = excluded.pay_amount,
        status = excluded.status,
        updated_at = now();
end;
$$;

create or replace function public.admin_delete_pharmacy_subscription(target_owner_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscriptions';
  end if;
  delete from public.pharmacy_subscriptions where owner_user_id = target_owner_user_id;
  if not found then
    raise exception 'Pharmacy subscription not found';
  end if;
end;
$$;

create or replace function public.admin_set_pharmacy_account_suspended(
  target_owner_user_id uuid,
  should_suspend boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can change pharmacy account status';
  end if;

  if should_suspend then
    update public.user_profiles as profile
    set approval_status = 'suspended',
        updated_at = now()
    where profile.id = target_owner_user_id
      and profile.role = 'pharmacy_user'
      and profile.approval_status in ('approved', 'suspended');
  else
    update public.user_profiles as profile
    set approval_status = 'approved',
        updated_at = now()
    where profile.id = target_owner_user_id
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'suspended';
  end if;
  if not found then
    raise exception 'Pharmacy owner account is not in an active or suspended state';
  end if;
end;
$$;

revoke all on function public.is_subscription_admin() from public, anon;
revoke all on function public.admin_get_pharmacy_subscriptions() from public, anon;
revoke all on function public.admin_save_pharmacy_subscription_plan(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.admin_delete_pharmacy_subscription_plan(uuid) from public, anon;
revoke all on function public.admin_save_pharmacy_subscription(uuid, uuid, text, numeric, text) from public, anon;
revoke all on function public.admin_delete_pharmacy_subscription(uuid) from public, anon;
revoke all on function public.admin_set_pharmacy_account_suspended(uuid, boolean) from public, anon;

grant execute on function public.admin_get_pharmacy_subscriptions() to authenticated;
grant execute on function public.admin_save_pharmacy_subscription_plan(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.admin_delete_pharmacy_subscription_plan(uuid) to authenticated;
grant execute on function public.admin_save_pharmacy_subscription(uuid, uuid, text, numeric, text) to authenticated;
grant execute on function public.admin_delete_pharmacy_subscription(uuid) to authenticated;
grant execute on function public.admin_set_pharmacy_account_suspended(uuid, boolean) to authenticated;
