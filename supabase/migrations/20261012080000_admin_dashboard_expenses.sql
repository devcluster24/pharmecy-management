create or replace function public.admin_get_dashboard_expenses()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expense_item jsonb;
  expense_totals jsonb := '{}'::jsonb;
  expense_date date;
  expense_amount numeric;
  raw_date text;
  raw_amount text;
  month_key text;
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can view platform expense totals';
  end if;

  for expense_item in
    select item.value
    from public.pharmacy_app_data as data
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(data.payload) = 'array' then data.payload
        else '[]'::jsonb
      end
    ) as item(value)
    where data.data_key = 'pharmacy-expenses-v1'
  loop
    raw_date := expense_item ->> 'date';
    raw_amount := expense_item ->> 'amount';
    if raw_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or raw_amount !~ '^[0-9]+([.][0-9]+)?$' then
      continue;
    end if;

    begin
      expense_date := raw_date::date;
      expense_amount := raw_amount::numeric;
    exception
      when invalid_datetime_format or datetime_field_overflow
        or invalid_text_representation or numeric_value_out_of_range then
        continue;
    end;

    if expense_amount <= 0 then
      continue;
    end if;

    month_key := to_char(expense_date, 'YYYY-MM');
    expense_totals := jsonb_set(
      expense_totals,
      array[month_key],
      to_jsonb(coalesce((expense_totals ->> month_key)::numeric, 0) + expense_amount),
      true
    );
  end loop;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('month', item.key, 'amount', item.value::numeric)
        order by item.key
      )
      from jsonb_each_text(expense_totals) as item
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.admin_get_dashboard_expenses() from public, anon;
grant execute on function public.admin_get_dashboard_expenses() to authenticated;
