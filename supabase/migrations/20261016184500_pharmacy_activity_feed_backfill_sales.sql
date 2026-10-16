insert into public.pharmacy_activity_feed (
  owner_user_id,
  event_type,
  title,
  description,
  event_key,
  metadata
)
select
  app_data.owner_user_id,
  'sale',
  'Sale',
  coalesce(sale ->> 'invoice', 'Invoice')
    || ' · ' || coalesce(sale ->> 'customer', 'Walk-in customer')
    || ' · ৳' || coalesce(sale ->> 'amount', '0'),
  'sale:' || coalesce(sale ->> 'id', sale ->> 'invoice'),
  jsonb_build_object(
    'invoice', sale ->> 'invoice',
    'customer', sale ->> 'customer',
    'amount', sale ->> 'amount'
  )
from public.pharmacy_app_data as app_data
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(app_data.payload) = 'array' then app_data.payload
    else '[]'::jsonb
  end
) as sales(sale)
where app_data.data_key = 'pharmacy-sales-list-v1'
  and coalesce(sale ->> 'id', sale ->> 'invoice', '') <> ''
on conflict (owner_user_id, event_key) do nothing;
