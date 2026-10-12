create or replace function public.get_public_pharmacy_pricing()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', plan.id,
        'name', case lower(btrim(plan.name))
          when 'starter access' then 'Starter Access'
          when 'one-time setup' then 'One-Time Setup'
        end,
        'setup_fee_label', plan.setup_fee_label,
        'setup_fee', plan.setup_fee,
        'recurring_fee', plan.recurring_fee,
        'billing_period', plan.billing_period,
        'billing_interval', plan.billing_interval,
        'description', plan.description,
        'standard_subscription_fee', (
          select standard_plan.recurring_fee
          from public.pharmacy_subscription_plans as standard_plan
          where lower(btrim(standard_plan.name)) = 'standard subscription'
          order by (standard_plan.name = 'Standard Subscription') desc, standard_plan.created_at
          limit 1
        ),
        'standard_subscription_billing_period', (
          select standard_plan.billing_period
          from public.pharmacy_subscription_plans as standard_plan
          where lower(btrim(standard_plan.name)) = 'standard subscription'
          order by (standard_plan.name = 'Standard Subscription') desc, standard_plan.created_at
          limit 1
        ),
        'standard_subscription_billing_interval', (
          select standard_plan.billing_interval
          from public.pharmacy_subscription_plans as standard_plan
          where lower(btrim(standard_plan.name)) = 'standard subscription'
          order by (standard_plan.name = 'Standard Subscription') desc, standard_plan.created_at
          limit 1
        )
      )
      order by
        case lower(btrim(plan.name))
          when 'starter access' then 1
          when 'one-time setup' then 2
          else 3
        end,
        plan.created_at
    ),
    '[]'::jsonb
  )
  from public.pharmacy_subscription_plans as plan
  where lower(btrim(plan.name)) in ('starter access', 'one-time setup');
$$;

revoke all on function public.get_public_pharmacy_pricing() from public;
grant execute on function public.get_public_pharmacy_pricing() to anon, authenticated;
