with sale_times as (
  select
    data.owner_user_id,
    'sale:' || coalesce(sale.value ->> 'id', sale.value ->> 'invoice') as event_key,
    (sale.value ->> 'createdAt')::timestamptz as event_time
  from public.pharmacy_app_data as data
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(data.payload) = 'array' then data.payload
      else '[]'::jsonb
    end
  ) as sale(value)
  where data.data_key = 'pharmacy-sales-list-v1'
    and coalesce(sale.value ->> 'createdAt', '')
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
)
update public.pharmacy_activity_feed as feed
set created_at = sale_times.event_time
from sale_times
where feed.owner_user_id = sale_times.owner_user_id
  and feed.event_key = sale_times.event_key
  and feed.event_type = 'sale'
  and feed.created_at is distinct from sale_times.event_time;

with purchase_times as (
  select
    data.owner_user_id,
    case data.data_key
      when 'pharmacy-place-order-list-v1'
        then 'purchase-order:' || coalesce(item.value ->> 'order', item.value ->> 'id')
      else 'purchase-received:' || coalesce(item.value ->> 'id', '')
    end as event_key,
    (item.value ->> 'updatedAt')::timestamptz as event_time,
    case data.data_key
      when 'pharmacy-place-order-list-v1' then 'purchase_order'
      else 'purchase_received'
    end as event_type
  from public.pharmacy_app_data as data
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(data.payload) = 'array' then data.payload
      else '[]'::jsonb
    end
  ) as item(value)
  where data.data_key in ('pharmacy-place-order-list-v1', 'pharmacy-purchase-list-v1')
    and coalesce(item.value ->> 'updatedAt', '')
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
)
update public.pharmacy_activity_feed as feed
set created_at = purchase_times.event_time
from purchase_times
where feed.owner_user_id = purchase_times.owner_user_id
  and feed.event_key = purchase_times.event_key
  and feed.event_type = purchase_times.event_type
  and feed.created_at is distinct from purchase_times.event_time;
