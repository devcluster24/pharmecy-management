create or replace function public.destroy_pharmacy_expired_inventory_batch(
  requested_batch_id text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  pharmacy_owner_id uuid;
  purchase_payload jsonb;
  expenses_payload jsonb;
  batch_row jsonb;
  expense_row jsonb;
  remaining_purchase_payload jsonb;
  batch_count integer;
  expiration text;
  expiration_year integer;
  expiration_month integer;
  pack_size text;
  normalized_pack_size text;
  pack_factors text[];
  pack_factor text;
  pack_multiplier numeric := 1;
  box_quantity numeric;
  total_quantity numeric;
  total_price numeric;
  unit_purchase_price numeric;
  expense_amount numeric;
begin
  if current_user_id is null then
    raise exception 'Sign in before destroying expired inventory';
  end if;
  if nullif(btrim(requested_batch_id), '') is null then
    raise exception 'A valid expired batch is required';
  end if;

  pharmacy_owner_id := public.pharmacy_staff_owner_id(current_user_id);
  if pharmacy_owner_id is null then
    pharmacy_owner_id := current_user_id;
  end if;

  if not public.pharmacy_user_can_access_page(pharmacy_owner_id, 'purchase', 'delete')
    or not public.pharmacy_user_can_access_page(pharmacy_owner_id, 'expenses', 'create') then
    raise exception 'You do not have permission to destroy inventory and create an expense';
  end if;

  perform 1
  from public.user_profiles
  where id = pharmacy_owner_id
  for update;

  select payload
  into purchase_payload
  from public.pharmacy_app_data
  where owner_user_id = pharmacy_owner_id
    and data_key = 'pharmacy-purchase-list-v1'
  for update;

  if not found or jsonb_typeof(purchase_payload) <> 'array' then
    raise exception 'Could not load the pharmacy inventory';
  end if;

  select count(*), min(value::text)::jsonb
  into batch_count, batch_row
  from jsonb_array_elements(purchase_payload) as inventory(value)
  where value ->> 'id' = requested_batch_id;

  if batch_count <> 1 then
    raise exception 'The inventory batch could not be found or is not unique';
  end if;

  expiration := batch_row ->> 'expDate';
  if expiration !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'The batch has an invalid expiration date';
  end if;
  expiration_year := substring(expiration from 1 for 4)::integer;
  expiration_month := substring(expiration from 6 for 2)::integer;
  if make_date(expiration_year, expiration_month, 1) >= date_trunc('month', current_date)::date then
    raise exception 'This batch is not expired';
  end if;

  pack_size := coalesce(batch_row ->> 'packSize', '');
  normalized_pack_size := regexp_replace(
    btrim(pack_size),
    '(''s[[:space:]]+pack|''s|[[:space:]]+pack)$',
    '',
    'i'
  );
  normalized_pack_size := regexp_replace(normalized_pack_size, '(’s[[:space:]]+pack|’s|[[:space:]]+pack)$', '', 'i');
  if normalized_pack_size = '' then
    raise exception 'Could not determine the batch pack size';
  end if;

  pack_factors := regexp_split_to_array(normalized_pack_size, '[[:space:]]*[xX×][[:space:]]*');
  foreach pack_factor in array pack_factors loop
    if pack_factor !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Could not determine the batch pack size';
    end if;
    pack_multiplier := pack_multiplier * pack_factor::numeric;
  end loop;
  if pack_multiplier <= 0 then
    raise exception 'Could not determine the batch pack size';
  end if;

  if batch_row ? 'availableQuantity' then
    if coalesce(batch_row ->> 'availableQuantity', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Could not determine the available batch quantity';
    end if;
    total_quantity := (batch_row ->> 'availableQuantity')::numeric;
  else
    if coalesce(batch_row ->> 'quantity', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Could not determine the available batch quantity';
    end if;
    box_quantity := (batch_row ->> 'quantity')::numeric;
    total_quantity := box_quantity * pack_multiplier;
  end if;

  if coalesce(batch_row ->> 'unitPurchasePrice', '') ~ '^[0-9]+([.][0-9]+)?$' then
    unit_purchase_price := (batch_row ->> 'unitPurchasePrice')::numeric;
  else
    if coalesce(batch_row ->> 'quantity', '') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(batch_row ->> 'totalPrice', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Could not determine the batch purchase price';
    end if;
    box_quantity := (batch_row ->> 'quantity')::numeric;
    total_price := (batch_row ->> 'totalPrice')::numeric;
    if box_quantity <= 0 then
      raise exception 'Could not determine the batch purchase price';
    end if;
    unit_purchase_price := total_price / box_quantity / pack_multiplier;
  end if;

  expense_amount := round(total_quantity * unit_purchase_price, 2);
  expense_row := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'date', current_date::text,
    'category', 'Destroy',
    'description', coalesce(nullif(btrim(batch_row ->> 'brand'), ''), nullif(btrim(batch_row ->> 'genericName'), ''), 'Expired inventory'),
    'amount', expense_amount,
    'paymentMethod', '',
    'createdAt', now()
  );

  select coalesce(jsonb_agg(inventory.value order by inventory.ordinality), '[]'::jsonb)
  into remaining_purchase_payload
  from jsonb_array_elements(purchase_payload) with ordinality as inventory(value, ordinality)
  where inventory.value ->> 'id' <> requested_batch_id;

  update public.pharmacy_app_data
  set payload = remaining_purchase_payload,
      updated_at = now()
  where owner_user_id = pharmacy_owner_id
    and data_key = 'pharmacy-purchase-list-v1';

  select payload
  into expenses_payload
  from public.pharmacy_app_data
  where owner_user_id = pharmacy_owner_id
    and data_key = 'pharmacy-expenses-v1'
  for update;

  if not found then
    insert into public.pharmacy_app_data (owner_user_id, data_key, payload, updated_at)
    values (pharmacy_owner_id, 'pharmacy-expenses-v1', jsonb_build_array(expense_row), now());
  else
    if jsonb_typeof(expenses_payload) <> 'array' then
      raise exception 'Saved expense data has an invalid format';
    end if;
    update public.pharmacy_app_data
    set payload = expenses_payload || jsonb_build_array(expense_row),
        updated_at = now()
    where owner_user_id = pharmacy_owner_id
      and data_key = 'pharmacy-expenses-v1';
  end if;

  return expense_amount;
end;
$$;

revoke all on function public.destroy_pharmacy_expired_inventory_batch(text) from public, anon;
grant execute on function public.destroy_pharmacy_expired_inventory_batch(text) to authenticated;
