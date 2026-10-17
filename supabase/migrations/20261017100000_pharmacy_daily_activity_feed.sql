create table if not exists public.pharmacy_activity_feed (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  description text not null default '',
  event_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_user_id, event_key)
);

create index if not exists pharmacy_activity_feed_owner_created_idx
  on public.pharmacy_activity_feed (owner_user_id, created_at desc);

alter table public.pharmacy_activity_feed enable row level security;
revoke all on public.pharmacy_activity_feed from anon, authenticated;
grant select on public.pharmacy_activity_feed to authenticated;

drop policy if exists pharmacy_activity_feed_owner_read
  on public.pharmacy_activity_feed;
create policy pharmacy_activity_feed_owner_read
on public.pharmacy_activity_feed
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);

create or replace function public.audit_pharmacy_daily_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  previous_payload jsonb := '[]'::jsonb;
  previous_object jsonb := '{}'::jsonb;
  current_payload jsonb;
  activity_item jsonb;
  previous_item jsonb;
  payment_item jsonb;
  collection_entry record;
  due_item jsonb;
  event_id text;
  activity_event_key text;
  event_title text;
  event_description text;
  event_type text;
  event_time timestamptz;
  invoice_amount numeric;
  old_due_amount numeric;
  new_due_amount numeric;
  old_paid_amount numeric;
  new_paid_amount numeric;
  payment_method text;
  row_found boolean;
begin
  if tg_op = 'UPDATE' then
    if old.payload is not distinct from new.payload then
      return new;
    end if;
    previous_payload := case
      when jsonb_typeof(old.payload) = 'array' then old.payload
      else '[]'::jsonb
    end;
    previous_object := case
      when jsonb_typeof(old.payload) = 'object' then old.payload
      else '{}'::jsonb
    end;
  end if;

  if jsonb_typeof(new.payload) = 'array' then
    current_payload := new.payload;
  elsif jsonb_typeof(new.payload) = 'object' then
    current_payload := new.payload;
  else
    return new;
  end if;

  if new.data_key = 'pharmacy-sales-list-v1'
     and jsonb_typeof(current_payload) = 'array' then
    for activity_item in select value from jsonb_array_elements(current_payload)
    loop
      event_id := coalesce(activity_item ->> 'id', activity_item ->> 'invoice', '');
      if event_id = '' then
        continue;
      end if;

      select previous.value
      into previous_item
      from jsonb_array_elements(previous_payload) as previous(value)
      where coalesce(previous.value ->> 'id', previous.value ->> 'invoice', '') = event_id
      limit 1;
      row_found := found;

      if not row_found then
        event_time := now();
        if coalesce(activity_item ->> 'createdAt', '') ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
          event_time := (activity_item ->> 'createdAt')::timestamptz;
        end if;

        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description,
          event_key, metadata, created_at
        )
        values (
          new.owner_user_id,
          actor_id,
          'sale',
          'Sales',
          'Invoice: ' || coalesce(activity_item ->> 'invoice', 'N/A')
            || ' · Payment: ' || coalesce(activity_item ->> 'paymentMethodName', 'Cash')
            || ' · Amount: ৳' || coalesce(activity_item ->> 'amount', '0'),
          'sale:' || event_id,
          jsonb_build_object(
            'invoice', activity_item ->> 'invoice',
            'customer', activity_item ->> 'customer',
            'amount', activity_item ->> 'amount',
            'payment_method', coalesce(activity_item ->> 'paymentMethodName', 'Cash')
          ),
          event_time
        )
        on conflict (owner_user_id, event_key) do nothing;
      else
        old_paid_amount := 0;
        new_paid_amount := 0;
        old_due_amount := null;
        new_due_amount := null;
        invoice_amount := null;
        if coalesce(previous_item ->> 'paidAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
          old_paid_amount := (previous_item ->> 'paidAmount')::numeric;
        else
          if coalesce(previous_item ->> 'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
            invoice_amount := (previous_item ->> 'amount')::numeric;
          end if;
          if coalesce(previous_item ->> 'dueAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
            old_due_amount := (previous_item ->> 'dueAmount')::numeric;
          end if;
          old_paid_amount := case
            when invoice_amount is not null and old_due_amount is not null
              then greatest(invoice_amount - old_due_amount, 0)
            when invoice_amount is not null then invoice_amount
            else 0
          end;
        end if;
        if coalesce(activity_item ->> 'paidAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
          new_paid_amount := (activity_item ->> 'paidAmount')::numeric;
        else
          invoice_amount := null;
          if coalesce(activity_item ->> 'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
            invoice_amount := (activity_item ->> 'amount')::numeric;
          end if;
          if coalesce(activity_item ->> 'dueAmount', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
            new_due_amount := (activity_item ->> 'dueAmount')::numeric;
          end if;
          new_paid_amount := case
            when invoice_amount is not null and new_due_amount is not null
              then greatest(invoice_amount - new_due_amount, 0)
            when invoice_amount is not null then invoice_amount
            else 0
          end;
        end if;

        if new_paid_amount > old_paid_amount then
          payment_item := null;
          if jsonb_typeof(activity_item -> 'payments') = 'array'
             and jsonb_array_length(activity_item -> 'payments') > 0 then
            payment_item := activity_item -> 'payments'
              -> (jsonb_array_length(activity_item -> 'payments') - 1);
          end if;
          payment_method := coalesce(
            nullif(payment_item ->> 'methodName', ''),
            nullif(activity_item ->> 'paymentMethodName', ''),
            'Unknown'
          );
          event_id := coalesce(activity_item ->> 'invoice', event_id);
          activity_event_key := 'customer-due-payment:' || event_id || ':' || new_paid_amount::text;
          event_description := 'Customer: ' || coalesce(activity_item ->> 'customer', 'Customer')
            || ' · Invoice: ' || coalesce(activity_item ->> 'invoice', 'N/A')
            || ' · Payment: ' || payment_method
            || ' · Amount: ৳' || (new_paid_amount - old_paid_amount)::text;

          insert into public.pharmacy_activity_feed (
            owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
          )
          values (
            new.owner_user_id,
            actor_id,
            'customer_due_payment',
            'Customer Due Payment',
            event_description,
            activity_event_key,
            jsonb_build_object(
              'invoice', activity_item ->> 'invoice',
              'customer', activity_item ->> 'customer',
              'amount', (new_paid_amount - old_paid_amount)::text,
              'payment_method', payment_method
            )
          )
          on conflict (owner_user_id, event_key) do nothing;
        end if;
      end if;
    end loop;
  elsif new.data_key in (
    'pharmacy-place-order-list-v1',
    'pharmacy-purchase-list-v1',
    'pharmacy-return-records-v1',
    'pharmacy-expenses-v1'
  ) and jsonb_typeof(current_payload) = 'array' then
    for activity_item in select value from jsonb_array_elements(current_payload)
    loop
      event_id := coalesce(activity_item ->> 'id', activity_item ->> 'order', '');
      if event_id = '' then
        continue;
      end if;

      select exists (
        select 1
        from jsonb_array_elements(previous_payload) as previous(value)
        where coalesce(previous.value ->> 'id', previous.value ->> 'order', '') = event_id
      ) into row_found;
      if row_found then
        continue;
      end if;

      if new.data_key = 'pharmacy-place-order-list-v1' then
        event_type := 'purchase_order';
        event_title := 'Purchase Order';
        event_description := coalesce(activity_item ->> 'order', 'Order')
          || ' · ' || coalesce(activity_item ->> 'supplier', 'Supplier');
        activity_event_key := 'purchase-order:' || event_id;
      elsif new.data_key = 'pharmacy-purchase-list-v1' then
        event_type := 'purchase_received';
        event_title := 'Purchase Received';
        event_description := coalesce(activity_item ->> 'brand', 'Product')
          || ' · ' || coalesce(activity_item ->> 'order', 'Purchase');
        activity_event_key := 'purchase-received:' || event_id;
      elsif new.data_key = 'pharmacy-return-records-v1' then
        event_type := 'return';
        event_title := 'Return';
        event_description := coalesce(activity_item ->> 'product', 'Product')
          || ' · ' || coalesce(activity_item ->> 'invoice', 'Invoice')
          || ' · ৳' || coalesce(activity_item ->> 'amount', '0');
        activity_event_key := 'return:' || event_id;
      else
        event_type := 'expense';
        event_title := 'Expense';
        event_description := coalesce(activity_item ->> 'category', 'Expense')
          || ' · ৳' || coalesce(activity_item ->> 'amount', '0');
        activity_event_key := 'expense:' || event_id;
      end if;

      insert into public.pharmacy_activity_feed (
        owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
      )
      values (
        new.owner_user_id,
        actor_id,
        event_type,
        event_title,
        event_description,
        activity_event_key,
        activity_item
      )
      on conflict (owner_user_id, event_key) do nothing;
    end loop;
  elsif new.data_key in (
    'pharmacy-supplier-due-adjustments-v1',
    'pharmacy-supplier-due-payments-v1'
  ) and jsonb_typeof(current_payload) = 'object' then
    for collection_entry in select key, value from jsonb_each(current_payload)
    loop
      if jsonb_typeof(collection_entry.value) <> 'array' then
        continue;
      end if;
      for due_item in select value from jsonb_array_elements(collection_entry.value)
      loop
        if coalesce(previous_object -> collection_entry.key, '[]'::jsonb) @> jsonb_build_array(due_item) then
          continue;
        end if;

        event_type := case
          when new.data_key = 'pharmacy-supplier-due-adjustments-v1' then 'supplier_due_added'
          else 'supplier_due_payment'
        end;
        event_title := case
          when new.data_key = 'pharmacy-supplier-due-adjustments-v1' then 'Supplier Due Amount Added'
          else 'Supplier Due Payment'
        end;
        event_id := coalesce(due_item ->> 'createdAt', clock_timestamp()::text)
          || ':' || coalesce(due_item ->> 'amount', '');

        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          new.owner_user_id,
          actor_id,
          event_type,
          event_title,
          event_title || ' · ৳' || coalesce(due_item ->> 'amount', '0'),
          new.data_key || ':' || collection_entry.key || ':' || event_id,
          jsonb_build_object(
            'amount', due_item ->> 'amount',
            'payment_method', due_item ->> 'paymentMethod',
            'supplier_key', collection_entry.key
          )
        )
        on conflict (owner_user_id, event_key) do nothing;
      end loop;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.audit_pharmacy_daily_activity() from public, anon, authenticated;
drop trigger if exists pharmacy_app_data_activity_audit on public.pharmacy_app_data;
create trigger pharmacy_app_data_activity_audit
after insert or update on public.pharmacy_app_data
for each row
execute function public.audit_pharmacy_daily_activity();

create or replace function public.audit_pharmacy_catalog_product_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pharmacy_activity_feed (
    owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
  )
  values (
    new.owner_user_id,
    (select auth.uid()),
    'new_product',
    'New Product Added',
    coalesce(nullif(new.brand, ''), nullif(new.generic_name, ''), new.medicine_name)
      || ' added to product management.',
    'new-product:' || new.id,
    jsonb_build_object(
      'product_id', new.id,
      'brand', new.brand,
      'generic_name', new.generic_name,
      'manufacturer', new.manufacturer
    )
  )
  on conflict (owner_user_id, event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.audit_pharmacy_catalog_product_activity()
  from public, anon, authenticated;
drop trigger if exists pharmacy_catalog_product_activity_audit
  on public.pharmacy_catalog_products;
create trigger pharmacy_catalog_product_activity_audit
after insert on public.pharmacy_catalog_products
for each row
execute function public.audit_pharmacy_catalog_product_activity();

create or replace function public.record_pharmacy_session_activity(requested_event_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  owner_id uuid;
  actor_name text;
  actor_role text;
begin
  if current_user_id is null then
    raise exception 'Sign in to record session activity';
  end if;
  if requested_event_type is null or requested_event_type not in ('login', 'logout') then
    raise exception 'Unsupported session activity';
  end if;

  select profile.username, profile.role
  into actor_name, actor_role
  from public.user_profiles as profile
  where profile.id = current_user_id
    and profile.approval_status = 'approved';

  if actor_role = 'pharmacy_user' then
    owner_id := current_user_id;
  elsif actor_role = 'pharmacy_staff' then
    owner_id := public.pharmacy_staff_owner_id(current_user_id);
  end if;

  if owner_id is null then
    raise exception 'An approved pharmacy account is required to record session activity';
  end if;

  insert into public.pharmacy_activity_feed (
    owner_user_id, actor_user_id, event_type, title, description, metadata
  )
  values (
    owner_id,
    current_user_id,
    requested_event_type,
    case requested_event_type when 'login' then 'Login' else 'Logout' end,
    coalesce(actor_name, 'User')
      || case requested_event_type when 'login' then ' logged in.' else ' logged out.' end,
    jsonb_build_object('username', coalesce(actor_name, ''))
  );
end;
$$;

revoke all on function public.record_pharmacy_session_activity(text) from public, anon;
grant execute on function public.record_pharmacy_session_activity(text) to authenticated;

create or replace function public.get_pharmacy_activity_for_day(
  requested_start timestamptz,
  requested_end timestamptz
)
returns table (
  id uuid,
  event_type text,
  title text,
  description text,
  metadata jsonb,
  created_at timestamptz,
  actor_username text,
  actor_photo_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not exists (
    select 1
    from public.user_profiles as owner
    where owner.id = current_user_id
      and owner.role = 'pharmacy_user'
      and owner.approval_status = 'approved'
  ) then
    raise exception 'An approved pharmacy owner account is required to view activity';
  end if;
  if requested_start is null or requested_end is null or requested_start >= requested_end then
    raise exception 'A valid activity date range is required';
  end if;

  return query
  select feed.id,
         feed.event_type,
         feed.title,
         feed.description,
         feed.metadata,
         feed.created_at,
         coalesce(nullif(profile.username, ''), nullif(profile.full_name, ''), 'User'),
         coalesce(
           auth_user.raw_user_meta_data ->> 'avatar_url',
           auth_user.raw_user_meta_data ->> 'picture',
           auth_user.raw_user_meta_data ->> 'profile_photo_url',
           auth_user.raw_user_meta_data ->> 'photo_url'
         )
  from public.pharmacy_activity_feed as feed
  left join public.user_profiles as profile on profile.id = feed.actor_user_id
  left join auth.users as auth_user on auth_user.id = feed.actor_user_id
  where feed.owner_user_id = current_user_id
    and feed.created_at >= requested_start
    and feed.created_at < requested_end
  order by feed.created_at desc;
end;
$$;

revoke all on function public.get_pharmacy_activity_for_day(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_pharmacy_activity_for_day(timestamptz, timestamptz)
  to authenticated;

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
      and tablename = 'pharmacy_activity_feed'
  ) then
    alter publication supabase_realtime
      add table public.pharmacy_activity_feed;
  end if;
end
$$;
