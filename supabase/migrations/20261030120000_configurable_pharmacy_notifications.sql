create table if not exists public.pharmacy_notification_settings (
  id smallint primary key default 1 check (id = 1),
  rules jsonb not null default '{
    "inventory_expiring_soon": {"enabled": true, "days_before": 30},
    "inventory_expired": {"enabled": true},
    "inventory_low_stock": {"enabled": true},
    "inventory_out_of_stock": {"enabled": true},
    "catalog_new_products": {"enabled": true},
    "backup_completed": {"enabled": true},
    "subscription_expiring": {"enabled": true, "days_before": 7}
  }'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null
);

insert into public.pharmacy_notification_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.pharmacy_notifications
  add column if not exists notification_type text not null default 'system',
  add column if not exists source_key text;

create unique index if not exists pharmacy_notifications_user_source_key_idx
  on public.pharmacy_notifications (user_id, source_key)
  where source_key is not null;

alter table public.pharmacy_notification_settings enable row level security;
revoke all on public.pharmacy_notification_settings from public, anon, authenticated;
grant select, insert, update on public.pharmacy_notification_settings to authenticated;
grant execute on function public.is_subscription_admin() to authenticated;

drop policy if exists pharmacy_notification_settings_admin_read
  on public.pharmacy_notification_settings;
create policy pharmacy_notification_settings_admin_read
on public.pharmacy_notification_settings
for select to authenticated
using (public.is_subscription_admin());

drop policy if exists pharmacy_notification_settings_admin_insert
  on public.pharmacy_notification_settings;
create policy pharmacy_notification_settings_admin_insert
on public.pharmacy_notification_settings
for insert to authenticated
with check (public.is_subscription_admin());

drop policy if exists pharmacy_notification_settings_admin_update
  on public.pharmacy_notification_settings;
create policy pharmacy_notification_settings_admin_update
on public.pharmacy_notification_settings
for update to authenticated
using (public.is_subscription_admin())
with check (public.is_subscription_admin());

drop policy if exists pharmacy_notifications_owner_read
  on public.pharmacy_notifications;
create policy pharmacy_notifications_owner_read
on public.pharmacy_notifications
for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('pharmacy_user', 'pharmacy_staff')
      and profile.approval_status = 'approved'
  )
);

drop policy if exists pharmacy_notifications_owner_update
  on public.pharmacy_notifications;
create policy pharmacy_notifications_owner_update
on public.pharmacy_notifications
for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('pharmacy_user', 'pharmacy_staff')
      and profile.approval_status = 'approved'
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('pharmacy_user', 'pharmacy_staff')
      and profile.approval_status = 'approved'
  )
);

create or replace function public.pharmacy_notification_rule_enabled(rule_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select settings.rules -> rule_key ->> 'enabled'
     from public.pharmacy_notification_settings as settings
     where settings.id = 1),
    'false'
  ) = 'true';
$$;

create or replace function public.create_pharmacy_account_notification(
  requested_owner_id uuid,
  requested_title text,
  requested_body text,
  requested_type text,
  requested_source_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pharmacy_notifications (
    user_id,
    title,
    body,
    notification_type,
    source_key
  )
  select recipient.id,
         requested_title,
         requested_body,
         requested_type,
         requested_source_key
  from (
    select requested_owner_id as id
    union
    select invite.used_by
    from public.pharmacy_staff_invites as invite
    join public.user_profiles as staff
      on staff.id = invite.used_by
    where invite.owner_user_id = requested_owner_id
      and invite.used_by is not null
      and staff.role = 'pharmacy_staff'
      and staff.approval_status = 'approved'
  ) as recipients
  join public.user_profiles as recipient on recipient.id = recipients.id
  where recipient.role in ('pharmacy_user', 'pharmacy_staff')
    and recipient.approval_status = 'approved'
  on conflict (user_id, source_key) where source_key is not null do nothing;
$$;

create or replace function public.broadcast_pharmacy_notification(
  requested_title text,
  requested_body text,
  requested_type text,
  requested_source_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pharmacy_notifications (
    user_id,
    title,
    body,
    notification_type,
    source_key
  )
  select profile.id,
         requested_title,
         requested_body,
         requested_type,
         requested_source_key
  from public.user_profiles as profile
  where profile.role in ('pharmacy_user', 'pharmacy_staff')
    and profile.approval_status = 'approved'
  on conflict (user_id, source_key) where source_key is not null do nothing;
$$;

create or replace function public.pharmacy_notification_expiry_date(raw_expiry text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  expiry_month integer;
  expiry_year integer;
begin
  if raw_expiry is null then
    return null;
  end if;

  if raw_expiry ~ '^[0-9]{4}-[0-9]{2}$' then
    expiry_year := substring(raw_expiry from 1 for 4)::integer;
    expiry_month := substring(raw_expiry from 6 for 2)::integer;
  elsif raw_expiry ~ '^[0-9]{2}/[0-9]{2}$' then
    expiry_month := substring(raw_expiry from 1 for 2)::integer;
    expiry_year := 2000 + substring(raw_expiry from 4 for 2)::integer;
  elsif raw_expiry ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      return raw_expiry::date;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        return null;
    end;
  else
    return null;
  end if;

  if expiry_year < 1 or expiry_month < 1 or expiry_month > 12 then
    return null;
  end if;

  return (make_date(expiry_year, expiry_month, 1) + interval '1 month - 1 day')::date;
end;
$$;

create table if not exists public.pharmacy_notification_states (
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  item_key text not null,
  notification_type text not null,
  is_active boolean not null default false,
  event_version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, item_key, notification_type)
);

alter table public.pharmacy_notification_states enable row level security;
revoke all on public.pharmacy_notification_states from public, anon, authenticated;

create or replace function public.advance_pharmacy_notification_state(
  requested_owner_id uuid,
  requested_item_key text,
  requested_type text,
  requested_active boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_state boolean;
  next_version bigint;
begin
  insert into public.pharmacy_notification_states (
    owner_user_id,
    item_key,
    notification_type
  )
  values (requested_owner_id, requested_item_key, requested_type)
  on conflict (owner_user_id, item_key, notification_type) do nothing;

  select state.is_active
  into current_state
  from public.pharmacy_notification_states as state
  where state.owner_user_id = requested_owner_id
    and state.item_key = requested_item_key
    and state.notification_type = requested_type
  for update;

  if requested_active and not current_state then
    update public.pharmacy_notification_states as state
    set is_active = true,
        event_version = state.event_version + 1,
        updated_at = now()
    where state.owner_user_id = requested_owner_id
      and state.item_key = requested_item_key
      and state.notification_type = requested_type
    returning state.event_version into next_version;
    return next_version;
  end if;

  if not requested_active and current_state then
    update public.pharmacy_notification_states as state
    set is_active = false,
        updated_at = now()
    where state.owner_user_id = requested_owner_id
      and state.item_key = requested_item_key
      and state.notification_type = requested_type;
  end if;

  return null;
end;
$$;

create or replace function public.emit_pharmacy_inventory_notifications(
  requested_owner_id uuid,
  inventory_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inventory_row jsonb;
  item_id text;
  item_name text;
  item_batch text;
  item_expiry_text text;
  item_expiry date;
  item_quantity numeric;
  low_stock_threshold numeric;
  expiry_days integer;
  threshold_payload jsonb;
  state_version bigint;
begin
  if jsonb_typeof(inventory_payload) <> 'array' then
    return;
  end if;

  select data.payload
  into threshold_payload
  from public.pharmacy_app_data as data
  where data.owner_user_id = requested_owner_id
    and data.data_key = 'pharmacy-low-stock-threshold-v1';

  if jsonb_typeof(threshold_payload) = 'number'
    or jsonb_typeof(threshold_payload) = 'string' then
    if (threshold_payload #>> '{}') ~ '^[0-9]+([.][0-9]+)?$' then
      low_stock_threshold := (threshold_payload #>> '{}')::numeric;
    end if;
  end if;

  select case
    when (settings.rules -> 'inventory_expiring_soon' ->> 'days_before') ~ '^[0-9]+$'
    then least((settings.rules -> 'inventory_expiring_soon' ->> 'days_before')::integer, 3650)
    else 30
  end
  into expiry_days
  from public.pharmacy_notification_settings as settings
  where settings.id = 1;
  expiry_days := coalesce(expiry_days, 30);

  for inventory_row in
    select value
    from jsonb_array_elements(inventory_payload)
  loop
    item_id := coalesce(
      nullif(inventory_row ->> 'id', ''),
      md5(inventory_row::text)
    );
    item_name := coalesce(nullif(inventory_row ->> 'brand', ''), 'Inventory item');
    item_batch := coalesce(nullif(inventory_row ->> 'batchNumber', ''), '-');
    item_expiry_text := nullif(inventory_row ->> 'expDate', '');
    item_expiry := public.pharmacy_notification_expiry_date(item_expiry_text);

    if coalesce(inventory_row ->> 'availableQuantity', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
      item_quantity := (inventory_row ->> 'availableQuantity')::numeric;
    else
      item_quantity := null;
    end if;

    state_version := public.advance_pharmacy_notification_state(
      requested_owner_id,
      item_id || ':expired:' || coalesce(item_expiry::text, 'unknown'),
      'inventory_expired',
      item_expiry is not null
        and item_expiry < current_date
        and public.pharmacy_notification_rule_enabled('inventory_expired')
    );
    if state_version is not null then
      perform public.create_pharmacy_account_notification(
        requested_owner_id,
        'Expired inventory',
        item_name || ' (batch ' || item_batch || ') expired on ' || item_expiry::text || '.',
        'inventory_expired',
        'inventory:expired:' || requested_owner_id::text || ':' || item_id || ':' || state_version::text
      );
    end if;

    state_version := public.advance_pharmacy_notification_state(
      requested_owner_id,
      item_id || ':expiring:' || coalesce(item_expiry::text, 'unknown'),
      'inventory_expiring_soon',
      item_expiry is not null
        and item_expiry >= current_date
        and item_expiry <= current_date + expiry_days
        and public.pharmacy_notification_rule_enabled('inventory_expiring_soon')
    );
    if state_version is not null then
      perform public.create_pharmacy_account_notification(
        requested_owner_id,
        'Inventory expiring soon',
        item_name || ' (batch ' || item_batch || ') expires on ' || item_expiry::text || '.',
        'inventory_expiring_soon',
        'inventory:expiring:' || requested_owner_id::text || ':' || item_id || ':' || state_version::text
      );
    end if;

    state_version := public.advance_pharmacy_notification_state(
      requested_owner_id,
      item_id,
      'inventory_out_of_stock',
      item_quantity is not null
        and item_quantity <= 0
        and public.pharmacy_notification_rule_enabled('inventory_out_of_stock')
    );
    if state_version is not null then
      perform public.create_pharmacy_account_notification(
        requested_owner_id,
        'Out of stock',
        item_name || ' (batch ' || item_batch || ') is out of stock.',
        'inventory_out_of_stock',
        'inventory:out-of-stock:' || requested_owner_id::text || ':' || item_id || ':' || state_version::text
      );
    end if;

    state_version := public.advance_pharmacy_notification_state(
      requested_owner_id,
      item_id,
      'inventory_low_stock',
      item_quantity is not null
        and item_quantity > 0
        and low_stock_threshold is not null
        and item_quantity <= low_stock_threshold
        and public.pharmacy_notification_rule_enabled('inventory_low_stock')
    );
    if state_version is not null then
      perform public.create_pharmacy_account_notification(
        requested_owner_id,
        'Low stock',
        item_name || ' (batch ' || item_batch || ') has ' || item_quantity::text || ' left.',
        'inventory_low_stock',
        'inventory:low-stock:' || requested_owner_id::text || ':' || item_id || ':' || state_version::text
      );
    end if;
  end loop;
end;
$$;

create or replace function public.refresh_pharmacy_inventory_notifications(requested_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inventory_payload jsonb;
begin
  select data.payload
  into inventory_payload
  from public.pharmacy_app_data as data
  where data.owner_user_id = requested_owner_id
    and data.data_key = 'pharmacy-purchase-list-v1';

  if inventory_payload is not null then
    perform public.emit_pharmacy_inventory_notifications(requested_owner_id, inventory_payload);
  end if;
end;
$$;

create or replace function public.handle_pharmacy_inventory_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data_key = 'pharmacy-purchase-list-v1' then
    perform public.emit_pharmacy_inventory_notifications(new.owner_user_id, new.payload);
  elsif new.data_key = 'pharmacy-low-stock-threshold-v1' then
    perform public.refresh_pharmacy_inventory_notifications(new.owner_user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_inventory_notifications_trigger
  on public.pharmacy_app_data;
create trigger pharmacy_inventory_notifications_trigger
after insert or update of payload on public.pharmacy_app_data
for each row
execute function public.handle_pharmacy_inventory_notifications();

create or replace function public.handle_pharmacy_catalog_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.pharmacy_notification_rule_enabled('catalog_new_products') then
    perform public.broadcast_pharmacy_notification(
      'New company products available',
      'New products have been added to Import Company Products.',
      'catalog_new_products',
      'catalog-new-products:' || current_date::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_catalog_notification_trigger
  on public.admin_medicine_catalog;
create trigger pharmacy_catalog_notification_trigger
after insert on public.admin_medicine_catalog
for each row
execute function public.handle_pharmacy_catalog_notification();

create or replace function public.handle_pharmacy_backup_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Success'
    and public.pharmacy_notification_rule_enabled('backup_completed') then
    perform public.create_pharmacy_account_notification(
      new.owner_user_id,
      'Backup completed',
      'Your Google Drive backup completed successfully.',
      'backup_completed',
      'backup-completed:' || new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_backup_notification_trigger
  on public.pharmacy_drive_backup_history;
create trigger pharmacy_backup_notification_trigger
after insert on public.pharmacy_drive_backup_history
for each row
execute function public.handle_pharmacy_backup_notification();

create or replace function public.emit_pharmacy_subscription_expiry_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reminder_days integer;
  active_subscription record;
begin
  if not public.pharmacy_notification_rule_enabled('subscription_expiring') then
    return;
  end if;

  select case
    when (settings.rules -> 'subscription_expiring' ->> 'days_before') ~ '^[0-9]+$'
    then least(greatest((settings.rules -> 'subscription_expiring' ->> 'days_before')::integer, 1), 3650)
    else 7
  end
  into reminder_days
  from public.pharmacy_notification_settings as settings
  where settings.id = 1;
  reminder_days := coalesce(reminder_days, 7);

  for active_subscription in
    select subscription.owner_user_id,
           history.expires_at,
           history.plan_name
    from public.pharmacy_subscriptions as subscription
    join lateral (
      select payment.expires_at, payment.plan_name
      from public.pharmacy_subscription_payment_history as payment
      where payment.owner_user_id = subscription.owner_user_id
        and payment.status = 'Active'
        and payment.expires_at is not null
      order by payment.occurred_at desc, payment.id desc
      limit 1
    ) as history on true
    where subscription.status = 'Active'
      and history.expires_at > now()
      and history.expires_at <= now() + reminder_days * interval '1 day'
  loop
    perform public.create_pharmacy_account_notification(
      active_subscription.owner_user_id,
      'Subscription expiring soon',
      coalesce(active_subscription.plan_name, 'Your subscription')
        || ' expires on '
        || to_char(active_subscription.expires_at, 'Mon DD, YYYY')
        || '.',
      'subscription_expiring',
      'subscription-expiring:' || active_subscription.owner_user_id::text
        || ':' || active_subscription.expires_at::text
    );
  end loop;
end;
$$;

create or replace function public.handle_pharmacy_notification_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_row record;
begin
  for owner_row in
    select data.owner_user_id
    from public.pharmacy_app_data as data
    where data.data_key = 'pharmacy-purchase-list-v1'
  loop
    perform public.refresh_pharmacy_inventory_notifications(owner_row.owner_user_id);
  end loop;

  perform public.emit_pharmacy_subscription_expiry_notifications();
  return new;
end;
$$;

drop trigger if exists pharmacy_notification_settings_change_trigger
  on public.pharmacy_notification_settings;
create trigger pharmacy_notification_settings_change_trigger
after insert or update of rules on public.pharmacy_notification_settings
for each row
execute function public.handle_pharmacy_notification_settings_change();

create table if not exists public.pharmacy_notification_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.pharmacy_notification_announcements enable row level security;
revoke all on public.pharmacy_notification_announcements from public, anon, authenticated;
grant select, insert on public.pharmacy_notification_announcements to authenticated;

drop policy if exists pharmacy_notification_announcements_admin_read
  on public.pharmacy_notification_announcements;
create policy pharmacy_notification_announcements_admin_read
on public.pharmacy_notification_announcements
for select to authenticated
using (public.is_subscription_admin());

drop policy if exists pharmacy_notification_announcements_admin_insert
  on public.pharmacy_notification_announcements;
create policy pharmacy_notification_announcements_admin_insert
on public.pharmacy_notification_announcements
for insert to authenticated
with check (
  public.is_subscription_admin()
  and created_by = (select auth.uid())
);

create or replace function public.handle_pharmacy_notification_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.broadcast_pharmacy_notification(
    new.title,
    new.body,
    'custom',
    'custom-announcement:' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists pharmacy_notification_announcement_trigger
  on public.pharmacy_notification_announcements;
create trigger pharmacy_notification_announcement_trigger
after insert on public.pharmacy_notification_announcements
for each row
execute function public.handle_pharmacy_notification_announcement();

revoke all on function public.pharmacy_notification_rule_enabled(text) from public, anon, authenticated;
revoke all on function public.create_pharmacy_account_notification(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.broadcast_pharmacy_notification(text, text, text, text) from public, anon, authenticated;
revoke all on function public.pharmacy_notification_expiry_date(text) from public, anon, authenticated;
revoke all on function public.advance_pharmacy_notification_state(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.emit_pharmacy_inventory_notifications(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.refresh_pharmacy_inventory_notifications(uuid) from public, anon, authenticated;
revoke all on function public.emit_pharmacy_subscription_expiry_notifications() from public, anon, authenticated;
revoke all on function public.handle_pharmacy_inventory_notifications() from public, anon, authenticated;
revoke all on function public.handle_pharmacy_catalog_notification() from public, anon, authenticated;
revoke all on function public.handle_pharmacy_backup_notification() from public, anon, authenticated;
revoke all on function public.handle_pharmacy_notification_settings_change() from public, anon, authenticated;
revoke all on function public.handle_pharmacy_notification_announcement() from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pharmacy_notifications'
  ) then
    alter publication supabase_realtime
      add table public.pharmacy_notifications;
  end if;
end;
$$;

create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'pharmacy-subscription-notifications'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'pharmacy-subscription-notifications',
    '17 3 * * *',
    'select public.emit_pharmacy_subscription_expiry_notifications();'
  );
end;
$$;
