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

create or replace function public.audit_pharmacy_app_data_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_payload jsonb := '[]'::jsonb;
  activity_item jsonb;
  event_id text;
  event_time timestamptz;
  v_event_key text;
begin
  if tg_op = 'UPDATE' then
    if old.payload is not distinct from new.payload then
      return new;
    end if;
    old_payload := case
      when jsonb_typeof(old.payload) = 'array' then old.payload
      else '[]'::jsonb
    end;
  end if;

  if jsonb_typeof(new.payload) <> 'array' then
    return new;
  end if;

  if new.data_key = 'pharmacy-sales-list-v1' then
    for activity_item in select value from jsonb_array_elements(new.payload)
    loop
      event_id := coalesce(activity_item ->> 'id', activity_item ->> 'invoice', '');
      if event_id = '' or exists (
        select 1
        from jsonb_array_elements(old_payload) as previous(value)
        where coalesce(previous.value ->> 'id', previous.value ->> 'invoice', '') = event_id
      ) then
        continue;
      end if;

      v_event_key := 'sale:' || event_id;
      event_time := now();
      if coalesce(activity_item ->> 'createdAt', '') ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        event_time := (activity_item ->> 'createdAt')::timestamptz;
      end if;

      insert into public.pharmacy_activity_feed (
        owner_user_id, actor_user_id, event_type, title, description, event_key, metadata, created_at
      )
      values (
        new.owner_user_id,
        (select auth.uid()),
        'sale',
        'Sale',
        coalesce(activity_item ->> 'invoice', 'Invoice')
          || ' · ' || coalesce(activity_item ->> 'customer', 'Walk-in customer')
          || ' · ৳' || coalesce(activity_item ->> 'amount', '0'),
        v_event_key,
        jsonb_build_object(
          'invoice', activity_item ->> 'invoice',
          'customer', activity_item ->> 'customer',
          'amount', activity_item ->> 'amount'
        ),
        event_time
      )
      on conflict (owner_user_id, event_key) do nothing;
    end loop;
  elsif new.data_key = 'pharmacy-purchase-list-v1' then
    for activity_item in select value from jsonb_array_elements(new.payload)
    loop
      event_id := coalesce(activity_item ->> 'id', '');
      if event_id = '' or exists (
        select 1
        from jsonb_array_elements(old_payload) as previous(value)
        where coalesce(previous.value ->> 'id', '') = event_id
      ) then
        continue;
      end if;

      v_event_key := 'purchase-received:' || event_id;
      event_time := now();
      if coalesce(activity_item ->> 'updatedAt', '') ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        event_time := (activity_item ->> 'updatedAt')::timestamptz;
      end if;

      insert into public.pharmacy_activity_feed (
        owner_user_id, actor_user_id, event_type, title, description, event_key, metadata, created_at
      )
      values (
        new.owner_user_id,
        (select auth.uid()),
        'purchase_received',
        'Purchase Received',
        coalesce(activity_item ->> 'brand', 'Product')
          || ' received from ' || coalesce(activity_item ->> 'supplier', 'supplier')
          || ' · ' || coalesce(activity_item ->> 'order', 'Purchase'),
        v_event_key,
        jsonb_build_object(
          'order', activity_item ->> 'order',
          'supplier', activity_item ->> 'supplier',
          'product', activity_item ->> 'brand',
          'quantity', activity_item ->> 'quantity'
        ),
        event_time
      )
      on conflict (owner_user_id, event_key) do nothing;
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

insert into public.pharmacy_activity_feed (
  owner_user_id, event_type, title, description, event_key, metadata, created_at
)
select
  data.owner_user_id,
  'sale',
  'Sale',
  coalesce(sale.value ->> 'invoice', 'Invoice')
    || ' · ' || coalesce(sale.value ->> 'customer', 'Walk-in customer')
    || ' · ৳' || coalesce(sale.value ->> 'amount', '0'),
  'sale:' || coalesce(sale.value ->> 'id', sale.value ->> 'invoice'),
  jsonb_build_object(
    'invoice', sale.value ->> 'invoice',
    'customer', sale.value ->> 'customer',
    'amount', sale.value ->> 'amount'
  ),
  case
    when coalesce(sale.value ->> 'createdAt', '') ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      then (sale.value ->> 'createdAt')::timestamptz
    else now()
  end
from public.pharmacy_app_data as data
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(data.payload) = 'array' then data.payload else '[]'::jsonb end
) as sale(value)
where data.data_key = 'pharmacy-sales-list-v1'
  and coalesce(sale.value ->> 'id', sale.value ->> 'invoice', '') <> ''
on conflict (owner_user_id, event_key) do nothing;

insert into public.pharmacy_activity_feed (
  owner_user_id, event_type, title, description, event_key, metadata, created_at
)
select
  data.owner_user_id,
  'purchase_received',
  'Purchase Received',
  coalesce(purchase.value ->> 'brand', 'Product')
    || ' received from ' || coalesce(purchase.value ->> 'supplier', 'supplier')
    || ' · ' || coalesce(purchase.value ->> 'order', 'Purchase'),
  'purchase-received:' || (purchase.value ->> 'id'),
  jsonb_build_object(
    'order', purchase.value ->> 'order',
    'supplier', purchase.value ->> 'supplier',
    'product', purchase.value ->> 'brand',
    'quantity', purchase.value ->> 'quantity'
  ),
  case
    when coalesce(purchase.value ->> 'updatedAt', '') ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      then (purchase.value ->> 'updatedAt')::timestamptz
    else now()
  end
from public.pharmacy_app_data as data
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(data.payload) = 'array' then data.payload else '[]'::jsonb end
) as purchase(value)
where data.data_key = 'pharmacy-purchase-list-v1'
  and coalesce(purchase.value ->> 'id', '') <> ''
on conflict (owner_user_id, event_key) do nothing;

update public.pharmacy_activity_feed as feed
set created_at = (sale.value ->> 'createdAt')::timestamptz
from public.pharmacy_app_data as data
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(data.payload) = 'array' then data.payload else '[]'::jsonb end
) as sale(value)
where data.data_key = 'pharmacy-sales-list-v1'
  and feed.owner_user_id = data.owner_user_id
  and feed.event_type = 'sale'
  and feed.event_key = 'sale:' || coalesce(sale.value ->> 'id', sale.value ->> 'invoice')
  and coalesce(sale.value ->> 'createdAt', '') ~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  and feed.created_at is distinct from (sale.value ->> 'createdAt')::timestamptz;

update public.pharmacy_activity_feed as feed
set created_at = (purchase.value ->> 'updatedAt')::timestamptz
from public.pharmacy_app_data as data
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(data.payload) = 'array' then data.payload else '[]'::jsonb end
) as purchase(value)
where data.data_key = 'pharmacy-purchase-list-v1'
  and feed.owner_user_id = data.owner_user_id
  and feed.event_type = 'purchase_received'
  and feed.event_key = 'purchase-received:' || (purchase.value ->> 'id')
  and coalesce(purchase.value ->> 'updatedAt', '') ~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  and feed.created_at is distinct from (purchase.value ->> 'updatedAt')::timestamptz;
