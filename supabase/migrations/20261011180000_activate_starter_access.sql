create or replace function public.activate_my_pharmacy_starter_access()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_plan_id uuid;
  current_plan_id uuid;
begin
  if current_user_id is null then
    raise exception 'Sign in to set up your pharmacy subscription';
  end if;

  perform 1
  from public.user_profiles as profile
  join public.pharmacies as pharmacy on pharmacy.owner_user_id = profile.id
  where profile.id = current_user_id
    and profile.role = 'pharmacy_user'
    and profile.approval_status = 'approved'
  for update of profile;
  if not found then
    raise exception 'An approved pharmacy account is required to set up this subscription';
  end if;

  select plan.id
  into selected_plan_id
  from public.pharmacy_subscription_plans as plan
  where lower(btrim(plan.name)) = 'starter access'
  order by (plan.name = 'Starter Access') desc, plan.created_at asc
  limit 1;
  if selected_plan_id is null then
    raise exception 'Starter Access plan was not found. Ask an administrator to add it.';
  end if;

  select subscription.plan_id
  into current_plan_id
  from public.pharmacy_subscriptions as subscription
  where subscription.owner_user_id = current_user_id
  for update;

  if current_plan_id is not null then
    return current_plan_id;
  end if;

  insert into public.pharmacy_subscriptions (
    owner_user_id, plan_id, payment_method, pay_amount, status, updated_at
  ) values (
    current_user_id, selected_plan_id, '', 0, 'Active', now()
  )
  on conflict (owner_user_id) do update
    set plan_id = excluded.plan_id,
        pay_amount = 0,
        status = 'Active',
        updated_at = now();

  return selected_plan_id;
end;
$$;

revoke all on function public.activate_my_pharmacy_starter_access() from public, anon;
grant execute on function public.activate_my_pharmacy_starter_access() to authenticated;
