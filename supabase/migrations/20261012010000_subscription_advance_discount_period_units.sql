update public.pharmacy_subscription_plans as plan
set advance_payment_discounts = coalesce(
  (
    select jsonb_agg(
      jsonb_build_object(
        'before_due', coalesce(discount.rule -> 'before_due', discount.rule -> 'days_before_due'),
        'discount_amount', discount.rule -> 'discount_amount'
      )
      order by discount.ordinality
    )
    from jsonb_array_elements(plan.advance_payment_discounts) with ordinality as discount(rule, ordinality)
  ),
  '[]'::jsonb
)
where jsonb_array_length(plan.advance_payment_discounts) > 0;

drop function if exists public.admin_save_pharmacy_subscription_plan(
  uuid, text, text, numeric, numeric, text, integer, text, jsonb
);

create function public.admin_save_pharmacy_subscription_plan(
  target_plan_id uuid,
  requested_name text,
  requested_setup_fee_label text,
  requested_setup_fee numeric,
  requested_recurring_fee numeric,
  requested_billing_period text,
  requested_billing_interval integer,
  requested_description text,
  requested_advance_payment_discounts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_plan_id uuid;
  normalized_discounts jsonb := coalesce(requested_advance_payment_discounts, '[]'::jsonb);
  sanitized_discounts jsonb := '[]'::jsonb;
  discount_rule jsonb;
  lead_time numeric;
  discount_amount numeric;
  max_lead_time integer;
  seen_lead_times integer[] := array[]::integer[];
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
  if jsonb_typeof(normalized_discounts) <> 'array' then
    raise exception 'Advance payment discounts must be a list of rules';
  end if;
  if jsonb_array_length(normalized_discounts) > 20 then
    raise exception 'A plan can have at most 20 advance payment discount rules';
  end if;
  if requested_billing_period = 'one-time' and jsonb_array_length(normalized_discounts) > 0 then
    raise exception 'Advance payment discounts are only available for recurring plans';
  end if;

  max_lead_time := case when requested_billing_period = 'minutes' then 525600 else 365 end;
  for discount_rule in
    select rule.value
    from jsonb_array_elements(normalized_discounts) as rule(value)
  loop
    if jsonb_typeof(discount_rule) <> 'object'
      or jsonb_typeof(discount_rule -> 'before_due') is distinct from 'number'
      or jsonb_typeof(discount_rule -> 'discount_amount') is distinct from 'number' then
      raise exception 'Each advance discount must include before_due and discount_amount numbers';
    end if;

    lead_time := (discount_rule ->> 'before_due')::numeric;
    discount_amount := (discount_rule ->> 'discount_amount')::numeric;
    if lead_time <> trunc(lead_time) or lead_time not between 1 and max_lead_time then
      raise exception 'Advance payment lead time is outside the allowed range for this billing period';
    end if;
    if discount_amount <= 0
      or discount_amount <> round(discount_amount, 2)
      or discount_amount > requested_recurring_fee then
      raise exception 'Advance payment discount must be positive, up to two decimals, and no more than the recurring fee';
    end if;
    if lead_time::integer = any(seen_lead_times) then
      raise exception 'Advance payment lead times must be unique';
    end if;

    seen_lead_times := array_append(seen_lead_times, lead_time::integer);
    sanitized_discounts := sanitized_discounts || jsonb_build_array(
      jsonb_build_object(
        'before_due', lead_time::integer,
        'discount_amount', discount_amount
      )
    );
  end loop;

  if target_plan_id is null then
    insert into public.pharmacy_subscription_plans (
      name, setup_fee_label, setup_fee, recurring_fee, billing_period, billing_interval,
      description, advance_payment_discounts
    ) values (
      btrim(requested_name),
      btrim(requested_setup_fee_label),
      requested_setup_fee,
      requested_recurring_fee,
      requested_billing_period,
      requested_billing_interval,
      coalesce(requested_description, ''),
      sanitized_discounts
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
        advance_payment_discounts = sanitized_discounts,
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

revoke all on function public.admin_save_pharmacy_subscription_plan(
  uuid, text, text, numeric, numeric, text, integer, text, jsonb
) from public, anon;
grant execute on function public.admin_save_pharmacy_subscription_plan(
  uuid, text, text, numeric, numeric, text, integer, text, jsonb
) to authenticated;

drop function if exists public.complete_my_pharmacy_demo_subscription(uuid, text, integer);

create function public.complete_my_pharmacy_demo_subscription(
  target_plan_id uuid,
  requested_payment_method text,
  requested_billing_cycles integer
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
  selected_plan_period text;
  selected_setup_fee numeric;
  selected_recurring_fee numeric;
  selected_total numeric;
  selected_advance_discounts jsonb;
  selected_advance_discount numeric := 0;
  lead_time_until_expiry integer;
  current_plan_id uuid;
  current_plan_name text;
  existing_plan_period text;
  existing_plan_interval integer;
  existing_subscription_started_at timestamptz;
  existing_plan_expires_at timestamptz;
  effective_subscription_started_at timestamptz := now();
  effective_billing_period text;
  effective_billing_interval integer;
  standard_recurring_fee numeric;
  normalized_payment_method text := coalesce(requested_payment_method, '');
begin
  if current_user_id is null then
    raise exception 'Sign in to activate a pharmacy subscription';
  end if;

  if requested_billing_cycles is null or requested_billing_cycles not between 1 and 12 then
    raise exception 'Billing period must be between 1 and 12 plan periods';
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
         plan.billing_period,
         plan.setup_fee,
         plan.recurring_fee,
         plan.advance_payment_discounts
  into selected_plan_id,
       selected_plan_name,
       selected_plan_period,
       selected_setup_fee,
       selected_recurring_fee,
       selected_advance_discounts
  from public.pharmacy_subscription_plans as plan
  where plan.id = target_plan_id;
  if not found then
    raise exception 'The selected subscription plan was not found';
  end if;

  select subscription.plan_id,
         lower(btrim(plan.name)),
         coalesce(subscription.billing_period_override, plan.billing_period),
         coalesce(subscription.billing_interval_override, plan.billing_interval),
         subscription.started_at
  into current_plan_id,
       current_plan_name,
       existing_plan_period,
       existing_plan_interval,
       existing_subscription_started_at
  from public.pharmacy_subscriptions as subscription
  left join public.pharmacy_subscription_plans as plan on plan.id = subscription.plan_id
  where subscription.owner_user_id = current_user_id
  for update of subscription;

  if existing_plan_period is not null
    and existing_plan_period <> 'one-time'
    and existing_subscription_started_at is not null then
    existing_plan_expires_at := existing_subscription_started_at + case existing_plan_period
      when 'minutes' then existing_plan_interval * interval '1 minute'
      when 'days' then existing_plan_interval * interval '1 day'
      when 'month' then existing_plan_interval * interval '1 month'
      when 'year' then existing_plan_interval * interval '1 year'
    end;
  end if;

  if current_plan_id is null then
    if selected_plan_name not in ('starter access', 'one-time setup') then
      raise exception 'New accounts can start with Starter Access or One-Time Setup';
    end if;
  elsif current_plan_name = 'starter access' then
    raise exception 'Claim Extended Access from Settings before selecting a paid plan';
  elsif current_plan_name = 'extended access' then
    if selected_plan_name <> 'one-time setup' then
      raise exception 'Extended Access can only be followed by One-Time Setup';
    end if;
  elsif current_plan_name in ('one-time setup', 'standard subscription') then
    if selected_plan_name <> 'standard subscription' then
      raise exception 'This plan can only be followed by Standard Subscription';
    end if;
    if existing_plan_expires_at is not null and existing_plan_expires_at > now() then
      effective_subscription_started_at := existing_plan_expires_at;
    end if;
  else
    if existing_plan_expires_at is null then
      raise exception 'An active subscription is already assigned to this pharmacy account';
    end if;
    if existing_plan_expires_at > now() then
      raise exception 'The current subscription must expire before choosing a new plan';
    end if;
  end if;

  if selected_plan_name = 'one-time setup' then
    select plan.recurring_fee, plan.billing_period, plan.billing_interval
    into standard_recurring_fee, effective_billing_period, effective_billing_interval
    from public.pharmacy_subscription_plans as plan
    where lower(btrim(plan.name)) = 'standard subscription'
    order by (plan.name = 'Standard Subscription') desc, plan.created_at asc
    limit 1;
    if not found then
      raise exception 'The Standard Subscription plan is required to calculate One-Time Setup';
    end if;
    if effective_billing_period = 'one-time' then
      raise exception 'Standard Subscription must have a recurring billing period';
    end if;
    selected_total := selected_setup_fee + standard_recurring_fee * requested_billing_cycles;
  elsif selected_plan_name = 'standard subscription' then
    select plan.billing_period, plan.billing_interval
    into effective_billing_period, effective_billing_interval
    from public.pharmacy_subscription_plans as plan
    where plan.id = selected_plan_id;
    if effective_billing_period = 'one-time' then
      raise exception 'Standard Subscription must have a recurring billing period';
    end if;
    selected_total := selected_recurring_fee * requested_billing_cycles;
  else
    if requested_billing_cycles <> 1 then
      raise exception 'This plan does not support selecting multiple billing periods';
    end if;
    select plan.billing_period, plan.billing_interval
    into effective_billing_period, effective_billing_interval
    from public.pharmacy_subscription_plans as plan
    where plan.id = selected_plan_id;
    selected_total := selected_setup_fee + selected_recurring_fee;
  end if;

  if selected_plan_name in ('one-time setup', 'standard subscription') then
    if effective_billing_interval::bigint * requested_billing_cycles > 2147483647 then
      raise exception 'The selected billing period is too long';
    end if;
    effective_billing_interval := effective_billing_interval * requested_billing_cycles;
    if selected_total <= 0 then
      raise exception '% must have a payment amount greater than zero', initcap(selected_plan_name);
    end if;
  end if;

  if selected_plan_name = 'standard subscription'
    and current_plan_name in ('one-time setup', 'standard subscription')
    and existing_plan_expires_at > now() then
    lead_time_until_expiry := floor(
      extract(epoch from (existing_plan_expires_at - now()))
      / case when selected_plan_period = 'minutes' then 60 else 86400 end
    )::integer;
    select (discount.rule ->> 'discount_amount')::numeric
    into selected_advance_discount
    from jsonb_array_elements(coalesce(selected_advance_discounts, '[]'::jsonb)) as discount(rule)
    where (discount.rule ->> 'before_due')::integer <= lead_time_until_expiry
    order by (discount.rule ->> 'discount_amount')::numeric desc,
             (discount.rule ->> 'before_due')::integer desc
    limit 1;
    if found then
      selected_total := greatest(
        0,
        selected_total - selected_advance_discount * requested_billing_cycles
      );
    end if;
  end if;

  if selected_total < 0 or selected_total > 9999999999.99 then
    raise exception 'The selected subscription plan has an invalid amount';
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
    owner_user_id,
    plan_id,
    payment_method,
    pay_amount,
    status,
    started_at,
    updated_at,
    billing_period_override,
    billing_interval_override
  ) values (
    current_user_id,
    selected_plan_id,
    normalized_payment_method,
    selected_total,
    'Active',
    effective_subscription_started_at,
    now(),
    effective_billing_period,
    effective_billing_interval
  )
  on conflict (owner_user_id) do update
    set plan_id = excluded.plan_id,
        payment_method = excluded.payment_method,
        pay_amount = excluded.pay_amount,
        status = excluded.status,
        started_at = excluded.started_at,
        updated_at = now(),
        billing_period_override = excluded.billing_period_override,
        billing_interval_override = excluded.billing_interval_override;

  return selected_plan_id;
end;
$$;

revoke all on function public.complete_my_pharmacy_demo_subscription(uuid, text, integer) from public, anon;
grant execute on function public.complete_my_pharmacy_demo_subscription(uuid, text, integer) to authenticated;
