create sequence if not exists public.pharmacy_subscription_invoice_number_seq;

alter table public.pharmacy_subscription_payment_history
  add column if not exists invoice_number text;

with numbered_invoices as (
  select history.id,
         row_number() over (order by history.occurred_at, history.id) as invoice_sequence
  from public.pharmacy_subscription_payment_history as history
  where history.invoice_number is null
)
update public.pharmacy_subscription_payment_history as history
set invoice_number = 'PHINV-' || lpad(numbered_invoices.invoice_sequence::text, 8, '0')
from numbered_invoices
where history.id = numbered_invoices.id;

select setval(
  'public.pharmacy_subscription_invoice_number_seq'::regclass,
  coalesce(max(substring(history.invoice_number from 7)::bigint), 1),
  coalesce(max(substring(history.invoice_number from 7)::bigint), 0) > 0
)
from public.pharmacy_subscription_payment_history as history;

alter table public.pharmacy_subscription_payment_history
  alter column invoice_number set not null,
  alter column invoice_number set default (
    'PHINV-' || lpad(nextval('public.pharmacy_subscription_invoice_number_seq'::regclass)::text, 8, '0')
  );

create unique index if not exists pharmacy_subscription_payment_history_invoice_number_key
  on public.pharmacy_subscription_payment_history (invoice_number);

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
  payments_json jsonb;
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscriptions';
  end if;

  select coalesce(jsonb_agg(to_jsonb(plan_row) order by plan_row.recurring_fee, plan_row.name), '[]'::jsonb)
  into plans_json
  from (
    select id, name, setup_fee_label, setup_fee, recurring_fee,
           billing_period, billing_interval, description, advance_payment_discounts
    from public.pharmacy_subscription_plans
  ) as plan_row;

  select coalesce(jsonb_agg(to_jsonb(owner_row) order by owner_row.created_at desc), '[]'::jsonb)
  into owners_json
  from (
    select profile.id as owner_user_id,
           coalesce(pharmacy.store_name, 'Pharmacy') as pharmacy_name,
           coalesce(profile.full_name, '') as full_name,
           coalesce(profile.email, '') as email,
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

  select coalesce(
    jsonb_agg(
      to_jsonb(payment_row)
      order by payment_row.occurred_at desc, payment_row.invoice_number desc
    ),
    '[]'::jsonb
  )
  into payments_json
  from (
    select history.id,
           history.invoice_number,
           history.owner_user_id,
           coalesce(pharmacy.store_name, 'Pharmacy') as pharmacy_name,
           coalesce(profile.full_name, '') as full_name,
           coalesce(profile.email, '') as email,
           history.plan_name,
           history.amount,
           history.payment_method,
           history.status,
           history.occurred_at,
           history.expires_at,
           coalesce(history.billing_period, plan.billing_period, 'one-time') as billing_period,
           coalesce(history.billing_interval, plan.billing_interval, 1) as billing_interval
    from public.pharmacy_subscription_payment_history as history
    join public.user_profiles as profile
      on profile.id = history.owner_user_id
    left join public.pharmacies as pharmacy
      on pharmacy.owner_user_id = history.owner_user_id
    left join public.pharmacy_subscription_plans as plan
      on plan.id = history.plan_id
  ) as payment_row;

  return jsonb_build_object(
    'plans', plans_json,
    'owners', owners_json,
    'payments', payments_json
  );
end;
$$;

revoke all on function public.admin_get_pharmacy_subscriptions() from public, anon;
grant execute on function public.admin_get_pharmacy_subscriptions() to authenticated;
