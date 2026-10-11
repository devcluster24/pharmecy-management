alter table public.pharmacy_subscription_plans
  drop constraint if exists pharmacy_subscription_plans_supported_period_check,
  drop constraint if exists pharmacy_subscription_plans_billing_interval_check,
  add constraint pharmacy_subscription_plans_supported_period_check
    check (billing_period in ('minutes', 'days', 'month', 'year', 'one-time')),
  add constraint pharmacy_subscription_plans_billing_interval_check
    check (
      (billing_period in ('minutes', 'days') and billing_interval >= 1)
      or (billing_period = 'month' and billing_interval between 1 and 12)
      or (billing_period = 'year' and billing_interval between 1 and 3)
      or (billing_period = 'one-time' and billing_interval = 1)
    );

create or replace function public.admin_save_pharmacy_subscription_plan(
  target_plan_id uuid,
  requested_name text,
  requested_setup_fee_label text,
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
  if requested_setup_fee_label is null
    or length(btrim(requested_setup_fee_label)) not between 1 and 40 then
    raise exception 'Setup fee title must contain between 1 and 40 characters';
  end if;
  if requested_setup_fee is null or requested_setup_fee < 0
    or requested_recurring_fee is null or requested_recurring_fee < 0 then
    raise exception 'Plan fees must be zero or greater';
  end if;
  if requested_billing_period is null
    or requested_billing_period not in ('minutes', 'days', 'month', 'year', 'one-time') then
    raise exception 'Invalid plan billing period';
  end if;
  if requested_billing_interval is null
    or (requested_billing_period in ('minutes', 'days') and requested_billing_interval < 1)
    or (requested_billing_period = 'month' and requested_billing_interval not between 1 and 12)
    or (requested_billing_period = 'year' and requested_billing_interval not between 1 and 3)
    or (requested_billing_period = 'one-time' and requested_billing_interval <> 1) then
    raise exception 'Billing interval is invalid for the selected period';
  end if;

  if target_plan_id is null then
    insert into public.pharmacy_subscription_plans (
      name, setup_fee_label, setup_fee, recurring_fee, billing_period, billing_interval, description
    ) values (
      btrim(requested_name),
      btrim(requested_setup_fee_label),
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
        setup_fee_label = btrim(requested_setup_fee_label),
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

revoke all on function public.admin_save_pharmacy_subscription_plan(uuid, text, text, numeric, numeric, text, integer, text)
  from public, anon;
grant execute on function public.admin_save_pharmacy_subscription_plan(uuid, text, text, numeric, numeric, text, integer, text)
  to authenticated;
