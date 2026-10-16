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

create or replace function public.record_pharmacy_inventory_alerts(
  requested_owner_id uuid,
  requested_actor_id uuid,
  purchase_payload jsonb,
  low_stock_threshold numeric default 10
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inventory_item jsonb;
  item_id text;
  item_brand text;
  batch_number text;
  quantity_text text;
  available_quantity numeric;
  expiration_text text;
  expiration_date date;
  alert_type text;
  alert_title text;
  alert_description text;
begin
  if jsonb_typeof(purchase_payload) <> 'array' then
    return;
  end if;

  for inventory_item in
    select value from jsonb_array_elements(purchase_payload)
  loop
    item_id := coalesce(inventory_item ->> 'id', '');
    item_brand := coalesce(
      nullif(inventory_item ->> 'brand', ''),
      nullif(inventory_item ->> 'genericName', ''),
      'Product'
    );
    batch_number := coalesce(nullif(inventory_item ->> 'batchNumber', ''), 'N/A');
    quantity_text := coalesce(
      nullif(inventory_item ->> 'availableQuantity', ''),
      nullif(inventory_item ->> 'quantity', '')
    );
    available_quantity := null;

    if quantity_text ~ '^-?[0-9]+([.][0-9]+)?$' then
      available_quantity := quantity_text::numeric;
    end if;

    if available_quantity is not null then
      if available_quantity <= 0 then
        alert_type := 'out_of_stock';
        alert_title := 'Out of Stock';
        alert_description := item_brand || ' (Batch ' || batch_number || ') has no available stock.';
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          requested_owner_id, requested_actor_id, alert_type, alert_title, alert_description,
          'stock:' || alert_type || ':' || item_id,
          jsonb_build_object('product_id', item_id, 'brand', item_brand, 'batch_number', batch_number, 'quantity', available_quantity)
        )
        on conflict (owner_user_id, event_key) do nothing;
      elsif available_quantity <= greatest(coalesce(low_stock_threshold, 10), 0) then
        alert_type := 'low_stock';
        alert_title := 'Low Stock';
        alert_description := item_brand || ' (Batch ' || batch_number || ') has ' || available_quantity || ' units remaining.';
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          requested_owner_id, requested_actor_id, alert_type, alert_title, alert_description,
          'stock:' || alert_type || ':' || item_id,
          jsonb_build_object('product_id', item_id, 'brand', item_brand, 'batch_number', batch_number, 'quantity', available_quantity)
        )
        on conflict (owner_user_id, event_key) do nothing;
      end if;
    end if;

    expiration_text := coalesce(inventory_item ->> 'expDate', '');
    if (available_quantity is null or available_quantity > 0)
       and expiration_text ~ '^[0-9]{4}-[0-9]{2}$'
       and substring(expiration_text from 6 for 2)::integer between 1 and 12 then
      expiration_date := to_date(expiration_text || '-01', 'YYYY-MM-DD');

      if expiration_date < date_trunc('month', current_date)::date then
        alert_type := 'expired';
        alert_title := 'Expired';
        alert_description := item_brand || ' (Batch ' || batch_number || ') expired in ' || expiration_text || '.';
      elsif expiration_date <= date_trunc('month', current_date + interval '3 months')::date then
        alert_type := 'expire_soon';
        alert_title := 'Expire Soon';
        alert_description := item_brand || ' (Batch ' || batch_number || ') expires in ' || expiration_text || '.';
      else
        continue;
      end if;

      insert into public.pharmacy_activity_feed (
        owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
      )
      values (
        requested_owner_id, requested_actor_id, alert_type, alert_title, alert_description,
        'stock:' || alert_type || ':' || item_id,
        jsonb_build_object('product_id', item_id, 'brand', item_brand, 'batch_number', batch_number, 'expiration', expiration_text)
      )
      on conflict (owner_user_id, event_key) do nothing;
    end if;
  end loop;
end;
$$;

revoke all on function public.record_pharmacy_inventory_alerts(uuid, uuid, jsonb, numeric)
  from public, anon, authenticated;

create or replace function public.audit_pharmacy_app_data_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  actor_id uuid;
  previous_payload jsonb := '[]'::jsonb;
  current_payload jsonb;
  activity_item jsonb;
  previous_item jsonb;
  event_id text;
  event_title text;
  event_description text;
  event_amount text;
  collection_entry record;
  due_item jsonb;
  inventory_payload jsonb;
  threshold_payload jsonb;
  low_stock_threshold numeric := 10;
  row_found boolean;
begin
  owner_id := new.owner_user_id;
  actor_id := (select auth.uid());
  current_payload := new.payload;
  if tg_op = 'UPDATE' then
    previous_payload := old.payload;
  end if;

  if tg_op = 'UPDATE' then
    if old.payload is not distinct from new.payload then
      return new;
    end if;
  end if;

  if new.data_key = 'pharmacy-sales-list-v1'
     and jsonb_typeof(current_payload) = 'array' then
    for activity_item in select value from jsonb_array_elements(current_payload)
    loop
      event_id := coalesce(activity_item ->> 'id', activity_item ->> 'invoice', '');
      select value into previous_item
      from jsonb_array_elements(previous_payload)
      where coalesce(value ->> 'id', value ->> 'invoice', '') = event_id
      limit 1;
      row_found := found;

      if not row_found then
        event_title := 'Sale';
        event_description := coalesce(activity_item ->> 'invoice', 'Invoice')
          || ' · ' || coalesce(activity_item ->> 'customer', 'Walk-in customer')
          || ' · ৳' || coalesce(activity_item ->> 'amount', '0');
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          owner_id, actor_id, 'sale', event_title, event_description,
          'sale:' || event_id,
          jsonb_build_object('invoice', activity_item ->> 'invoice', 'customer', activity_item ->> 'customer', 'amount', activity_item ->> 'amount')
        )
        on conflict (owner_user_id, event_key) do nothing;
      elsif coalesce((activity_item ->> 'paidAmount')::numeric, 0)
            > coalesce((previous_item ->> 'paidAmount')::numeric, (previous_item ->> 'amount')::numeric, 0) then
        event_amount := (
          coalesce((activity_item ->> 'paidAmount')::numeric, 0)
          - coalesce((previous_item ->> 'paidAmount')::numeric, (previous_item ->> 'amount')::numeric, 0)
        )::text;
        event_title := 'Customer Adjust Amount';
        event_description := coalesce(activity_item ->> 'customer', 'Customer')
          || ' paid ৳' || event_amount || ' for invoice '
          || coalesce(activity_item ->> 'invoice', event_id) || '.';
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          owner_id, actor_id, 'customer_adjust_amount', event_title, event_description,
          'customer-adjust:' || event_id || ':' || coalesce(activity_item ->> 'paidAmount', ''),
          jsonb_build_object('invoice', activity_item ->> 'invoice', 'customer', activity_item ->> 'customer', 'amount', event_amount)
        )
        on conflict (owner_user_id, event_key) do nothing;
      end if;
    end loop;
  elsif new.data_key = 'pharmacy-place-order-list-v1'
        and jsonb_typeof(current_payload) = 'array' then
    for activity_item in select value from jsonb_array_elements(current_payload)
    loop
      event_id := coalesce(activity_item ->> 'order', activity_item ->> 'id', '');
      select exists (
        select 1 from jsonb_array_elements(previous_payload) as previous(value)
        where coalesce(previous.value ->> 'order', previous.value ->> 'id', '') = event_id
      ) into row_found;
      if not row_found then
        event_title := 'Purchase Order';
        event_description := coalesce(activity_item ->> 'order', 'Order')
          || ' placed with ' || coalesce(activity_item ->> 'supplier', 'supplier') || '.';
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          owner_id, actor_id, 'purchase_order', event_title, event_description,
          'purchase-order:' || event_id,
          jsonb_build_object('order', activity_item ->> 'order', 'supplier', activity_item ->> 'supplier')
        )
        on conflict (owner_user_id, event_key) do nothing;
      end if;
    end loop;
  elsif new.data_key = 'pharmacy-purchase-list-v1'
        and jsonb_typeof(current_payload) = 'array' then
    for activity_item in select value from jsonb_array_elements(current_payload)
    loop
      event_id := coalesce(activity_item ->> 'id', '');
      select exists (
        select 1 from jsonb_array_elements(previous_payload) as previous(value)
        where coalesce(previous.value ->> 'id', '') = event_id
      ) into row_found;
      if not row_found then
        event_title := 'Purchase Received';
        event_description := coalesce(activity_item ->> 'brand', 'Product')
          || ' received from ' || coalesce(activity_item ->> 'supplier', 'supplier')
          || ' · ' || coalesce(activity_item ->> 'order', 'Purchase');
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          owner_id, actor_id, 'purchase_received', event_title, event_description,
          'purchase-received:' || event_id,
          jsonb_build_object('order', activity_item ->> 'order', 'supplier', activity_item ->> 'supplier', 'product', activity_item ->> 'brand', 'quantity', activity_item ->> 'quantity')
        )
        on conflict (owner_user_id, event_key) do nothing;
      end if;
    end loop;

    select data.payload into inventory_payload
    from public.pharmacy_app_data as data
    where data.owner_user_id = owner_id and data.data_key = 'pharmacy-low-stock-threshold-v1';
    if inventory_payload is not null then
      event_amount := inventory_payload #>> '{}';
      if event_amount ~ '^[0-9]+([.][0-9]+)?$' then
        low_stock_threshold := event_amount::numeric;
      end if;
    end if;
    perform public.record_pharmacy_inventory_alerts(owner_id, actor_id, current_payload, low_stock_threshold);
  elsif new.data_key = 'pharmacy-return-records-v1'
        and jsonb_typeof(current_payload) = 'array' then
    for activity_item in select value from jsonb_array_elements(current_payload)
    loop
      event_id := coalesce(activity_item ->> 'id', '');
      select exists (
        select 1 from jsonb_array_elements(previous_payload) as previous(value)
        where coalesce(previous.value ->> 'id', '') = event_id
      ) into row_found;
      if not row_found then
        event_title := 'Return';
        event_description := coalesce(activity_item ->> 'product', 'Product')
          || ' returned for invoice ' || coalesce(activity_item ->> 'invoice', 'N/A') || '.';
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          owner_id, actor_id, 'return', event_title, event_description,
          'return:' || event_id,
          jsonb_build_object('invoice', activity_item ->> 'invoice', 'product', activity_item ->> 'product', 'quantity', activity_item ->> 'quantity', 'amount', activity_item ->> 'amount')
        )
        on conflict (owner_user_id, event_key) do nothing;
      end if;
    end loop;
  elsif new.data_key = 'pharmacy-expenses-v1'
        and jsonb_typeof(current_payload) = 'array' then
    for activity_item in select value from jsonb_array_elements(current_payload)
    loop
      event_id := coalesce(activity_item ->> 'id', '');
      select exists (
        select 1 from jsonb_array_elements(previous_payload) as previous(value)
        where coalesce(previous.value ->> 'id', '') = event_id
      ) into row_found;
      if not row_found then
        event_title := 'Expense';
        event_description := coalesce(activity_item ->> 'category', 'Expense')
          || ' · ' || coalesce(activity_item ->> 'description', '')
          || ' · ৳' || coalesce(activity_item ->> 'amount', '0');
        insert into public.pharmacy_activity_feed (
          owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
        )
        values (
          owner_id, actor_id, 'expense', event_title, event_description,
          'expense:' || event_id,
          jsonb_build_object('category', activity_item ->> 'category', 'description', activity_item ->> 'description', 'amount', activity_item ->> 'amount')
        )
        on conflict (owner_user_id, event_key) do nothing;
      end if;
    end loop;
  elsif new.data_key in ('pharmacy-supplier-due-adjustments-v1', 'pharmacy-supplier-due-payments-v1')
        and jsonb_typeof(current_payload) = 'object' then
    for collection_entry in
      select key, value from jsonb_each(current_payload)
    loop
      if jsonb_typeof(collection_entry.value) <> 'array' then continue; end if;
      for due_item in select value from jsonb_array_elements(collection_entry.value)
      loop
        select exists (
          select 1
          from jsonb_array_elements(coalesce(previous_payload -> collection_entry.key, '[]'::jsonb)) as previous(value)
          where previous.value = due_item
        ) into row_found;
        if not row_found then
          event_title := case
            when new.data_key = 'pharmacy-supplier-due-adjustments-v1' then 'Supplier Due Amount Added'
            else 'Supplier Due Payment'
          end;
          event_description := event_title || ' · '
            || coalesce(nullif(collection_entry.key::jsonb ->> 0, ''), 'Supplier')
            || ' · ৳' || coalesce(due_item ->> 'amount', '0') || '.';
          insert into public.pharmacy_activity_feed (
            owner_user_id, actor_user_id, event_type, title, description, event_key, metadata
          )
          values (
            owner_id, actor_id,
            case when new.data_key = 'pharmacy-supplier-due-adjustments-v1' then 'supplier_due_added' else 'supplier_due_payment' end,
            event_title, event_description,
            new.data_key || ':' || collection_entry.key || ':' || coalesce(due_item ->> 'createdAt', '') || ':' || coalesce(due_item ->> 'amount', ''),
            jsonb_build_object('supplier_key', collection_entry.key, 'amount', due_item ->> 'amount', 'payment_method', due_item ->> 'paymentMethod')
          )
          on conflict (owner_user_id, event_key) do nothing;
        end if;
      end loop;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.audit_pharmacy_app_data_activity() from public, anon, authenticated;

drop trigger if exists pharmacy_app_data_activity_audit on public.pharmacy_app_data;
create trigger pharmacy_app_data_activity_audit
after insert or update on public.pharmacy_app_data
for each row
execute function public.audit_pharmacy_app_data_activity();

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
    coalesce(nullif(new.brand, ''), nullif(new.generic_name, ''), new.medicine_name) || ' added to product management.',
    'new-product:' || new.id,
    jsonb_build_object('product_id', new.id, 'brand', new.brand, 'generic_name', new.generic_name, 'manufacturer', new.manufacturer)
  )
  on conflict (owner_user_id, event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.audit_pharmacy_catalog_product_activity() from public, anon, authenticated;

drop trigger if exists pharmacy_catalog_product_activity_audit
  on public.pharmacy_catalog_products;
create trigger pharmacy_catalog_product_activity_audit
after insert on public.pharmacy_catalog_products
for each row
execute function public.audit_pharmacy_catalog_product_activity();

create or replace function public.record_pharmacy_staff_login_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  owner_id uuid;
  staff_name text;
begin
  if current_user_id is null then
    raise exception 'Sign in to record staff login activity';
  end if;

  select profile.full_name, public.pharmacy_staff_owner_id(profile.id)
  into staff_name, owner_id
  from public.user_profiles as profile
  where profile.id = current_user_id
    and profile.role = 'pharmacy_staff'
    and profile.approval_status = 'approved';

  if owner_id is null then
    return;
  end if;

  insert into public.pharmacy_activity_feed (
    owner_user_id, actor_user_id, event_type, title, description, metadata
  )
  values (
    owner_id, current_user_id, 'staff_login', 'Staff Login',
    coalesce(nullif(staff_name, ''), 'A staff member') || ' signed in.',
    jsonb_build_object('staff_name', coalesce(staff_name, ''))
  );
end;
$$;

revoke all on function public.record_pharmacy_staff_login_activity() from public, anon;
grant execute on function public.record_pharmacy_staff_login_activity() to authenticated;

create or replace function public.refresh_pharmacy_stock_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  purchase_payload jsonb;
  threshold_payload jsonb;
  threshold numeric := 10;
  threshold_text text;
begin
  if current_user_id is null or not exists (
    select 1
    from public.user_profiles as profile
    where profile.id = current_user_id
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  ) then
    raise exception 'An approved pharmacy owner account is required to refresh stock activity';
  end if;

  select data.payload into purchase_payload
  from public.pharmacy_app_data as data
  where data.owner_user_id = current_user_id
    and data.data_key = 'pharmacy-purchase-list-v1';

  select data.payload into threshold_payload
  from public.pharmacy_app_data as data
  where data.owner_user_id = current_user_id
    and data.data_key = 'pharmacy-low-stock-threshold-v1';

  threshold_text := threshold_payload #>> '{}';
  if threshold_text ~ '^[0-9]+([.][0-9]+)?$' then
    threshold := threshold_text::numeric;
  end if;

  perform public.record_pharmacy_inventory_alerts(
    current_user_id,
    current_user_id,
    coalesce(purchase_payload, '[]'::jsonb),
    threshold
  );
end;
$$;

revoke all on function public.refresh_pharmacy_stock_activity() from public, anon;
grant execute on function public.refresh_pharmacy_stock_activity() to authenticated;
