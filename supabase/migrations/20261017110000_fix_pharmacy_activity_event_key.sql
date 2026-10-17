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
