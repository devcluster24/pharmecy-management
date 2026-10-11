create table if not exists public.pharmacy_subscription_payment_accounts (
  is_primary boolean primary key default true check (is_primary),
  bkash_account_number text not null default '',
  nagad_account_number text not null default '',
  updated_at timestamptz not null default now(),
  constraint pharmacy_subscription_payment_accounts_number_length_check
    check (length(bkash_account_number) <= 32 and length(nagad_account_number) <= 32)
);

insert into public.pharmacy_subscription_payment_accounts (is_primary)
values (true)
on conflict (is_primary) do nothing;

alter table public.pharmacy_subscription_payment_accounts enable row level security;
revoke all on public.pharmacy_subscription_payment_accounts from public, anon, authenticated;

create or replace function public.admin_get_subscription_payment_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account_json jsonb;
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscription payment accounts';
  end if;

  select jsonb_build_object(
    'bkash', accounts.bkash_account_number,
    'nagad', accounts.nagad_account_number
  )
  into account_json
  from public.pharmacy_subscription_payment_accounts as accounts
  where accounts.is_primary;

  return coalesce(account_json, jsonb_build_object('bkash', '', 'nagad', ''));
end;
$$;

create or replace function public.admin_save_subscription_payment_accounts(
  requested_bkash_account_number text,
  requested_nagad_account_number text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_bkash text := trim(coalesce(requested_bkash_account_number, ''));
  normalized_nagad text := trim(coalesce(requested_nagad_account_number, ''));
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can manage subscription payment accounts';
  end if;

  if length(normalized_bkash) > 32 or length(normalized_nagad) > 32 then
    raise exception 'Payment account numbers cannot exceed 32 characters';
  end if;

  insert into public.pharmacy_subscription_payment_accounts (
    is_primary,
    bkash_account_number,
    nagad_account_number,
    updated_at
  ) values (
    true,
    normalized_bkash,
    normalized_nagad,
    now()
  )
  on conflict (is_primary) do update
    set bkash_account_number = excluded.bkash_account_number,
        nagad_account_number = excluded.nagad_account_number,
        updated_at = excluded.updated_at;
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
        'invoice_number', history.invoice_number,
        'plan_name', history.plan_name,
        'amount', history.amount,
        'payment_method', history.payment_method,
        'account_number',
          case lower(history.payment_method)
            when 'bkash' then coalesce(accounts.bkash_account_number, '')
            when 'nagad' then coalesce(accounts.nagad_account_number, '')
            else ''
          end,
        'status', history.status,
        'occurred_at', history.occurred_at,
        'expires_at', history.expires_at,
        'billing_period', coalesce(history.billing_period, plan.billing_period, 'one-time'),
        'billing_interval', coalesce(history.billing_interval, plan.billing_interval, 1)
      )
      order by history.occurred_at desc, history.id desc
    ),
    '[]'::jsonb
  )
  into history_json
  from public.pharmacy_subscription_payment_history as history
  left join public.pharmacy_subscription_plans as plan
    on plan.id = history.plan_id
  left join public.pharmacy_subscription_payment_accounts as accounts
    on accounts.is_primary
  where history.owner_user_id = current_user_id;

  return history_json;
end;
$$;

revoke all on function public.admin_get_subscription_payment_accounts() from public, anon;
grant execute on function public.admin_get_subscription_payment_accounts() to authenticated;
revoke all on function public.admin_save_subscription_payment_accounts(text, text) from public, anon;
grant execute on function public.admin_save_subscription_payment_accounts(text, text) to authenticated;
revoke all on function public.get_my_pharmacy_subscription_payment_history() from public, anon;
grant execute on function public.get_my_pharmacy_subscription_payment_history() to authenticated;
