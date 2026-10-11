create table if not exists public.pharmacy_subscription_payment_history (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  plan_id uuid references public.pharmacy_subscription_plans(id) on delete set null,
  plan_name text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  payment_method text not null default '',
  status text not null check (status in ('Active', 'Inactive', 'Past Due')),
  occurred_at timestamptz not null default now()
);

create index if not exists pharmacy_subscription_payment_history_owner_date_idx
  on public.pharmacy_subscription_payment_history (owner_user_id, occurred_at desc);

alter table public.pharmacy_subscription_payment_history enable row level security;
revoke all on public.pharmacy_subscription_payment_history from anon, authenticated;

insert into public.pharmacy_subscription_payment_history (
  owner_user_id,
  plan_id,
  plan_name,
  amount,
  payment_method,
  status,
  occurred_at
)
select subscription.owner_user_id,
       subscription.plan_id,
       coalesce(plan.name, 'Removed subscription plan'),
       subscription.pay_amount,
       subscription.payment_method,
       subscription.status,
       subscription.updated_at
from public.pharmacy_subscriptions as subscription
left join public.pharmacy_subscription_plans as plan
  on plan.id = subscription.plan_id
where subscription.plan_id is not null
  and not exists (
    select 1
    from public.pharmacy_subscription_payment_history as history
    where history.owner_user_id = subscription.owner_user_id
  );

create or replace function public.record_pharmacy_subscription_payment_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_plan_name text;
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
    select plan.name
    into selected_plan_name
    from public.pharmacy_subscription_plans as plan
    where plan.id = new.plan_id;

    insert into public.pharmacy_subscription_payment_history (
      owner_user_id,
      plan_id,
      plan_name,
      amount,
      payment_method,
      status
    ) values (
      new.owner_user_id,
      new.plan_id,
      coalesce(selected_plan_name, 'Removed subscription plan'),
      new.pay_amount,
      new.payment_method,
      new.status
    );
  end if;

  return new;
end;
$$;

drop trigger if exists pharmacy_subscription_payment_history_trigger
  on public.pharmacy_subscriptions;
create trigger pharmacy_subscription_payment_history_trigger
  after insert or update on public.pharmacy_subscriptions
  for each row
  execute function public.record_pharmacy_subscription_payment_history();

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
        'occurred_at', history.occurred_at
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

revoke all on function public.get_my_pharmacy_subscription_payment_history() from public, anon;
grant execute on function public.get_my_pharmacy_subscription_payment_history() to authenticated;
