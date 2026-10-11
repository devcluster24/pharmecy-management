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
  where history.owner_user_id = current_user_id;

  return history_json;
end;
$$;

revoke all on function public.get_my_pharmacy_subscription_payment_history() from public, anon;
grant execute on function public.get_my_pharmacy_subscription_payment_history() to authenticated;
