create table if not exists public.admin_operating_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (length(btrim(category)) between 1 and 60),
  description text not null check (length(btrim(description)) between 1 and 160),
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text not null check (length(btrim(payment_method)) between 1 and 40),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists admin_operating_expenses_date_idx
  on public.admin_operating_expenses (expense_date desc, created_at desc);

alter table public.admin_operating_expenses enable row level security;
revoke all on public.admin_operating_expenses from public, anon, authenticated;

create or replace function public.admin_get_operating_expenses()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can view platform expenses';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', expense.id,
          'date', expense.expense_date,
          'category', expense.category,
          'description', expense.description,
          'amount', expense.amount,
          'payment_method', expense.payment_method,
          'created_at', expense.created_at
        )
        order by expense.expense_date desc, expense.created_at desc
      )
      from public.admin_operating_expenses as expense
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_add_operating_expense(
  requested_date date,
  requested_category text,
  requested_description text,
  requested_amount numeric,
  requested_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_expense public.admin_operating_expenses%rowtype;
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can add platform expenses';
  end if;

  if requested_date is null then
    raise exception 'Expense date is required';
  end if;
  if requested_category is null or length(btrim(requested_category)) not between 1 and 60 then
    raise exception 'Expense category must contain between 1 and 60 characters';
  end if;
  if requested_description is null or length(btrim(requested_description)) not between 1 and 160 then
    raise exception 'Expense description must contain between 1 and 160 characters';
  end if;
  if requested_amount is null or requested_amount <= 0 or requested_amount > 9999999999.99 then
    raise exception 'Expense amount must be greater than zero and within the supported limit';
  end if;
  if requested_payment_method is null or length(btrim(requested_payment_method)) not between 1 and 40 then
    raise exception 'Payment method must contain between 1 and 40 characters';
  end if;

  insert into public.admin_operating_expenses (
    expense_date,
    category,
    description,
    amount,
    payment_method,
    created_by
  ) values (
    requested_date,
    btrim(requested_category),
    btrim(requested_description),
    requested_amount,
    btrim(requested_payment_method),
    (select auth.uid())
  )
  returning * into inserted_expense;

  return jsonb_build_object(
    'id', inserted_expense.id,
    'date', inserted_expense.expense_date,
    'category', inserted_expense.category,
    'description', inserted_expense.description,
    'amount', inserted_expense.amount,
    'payment_method', inserted_expense.payment_method,
    'created_at', inserted_expense.created_at
  );
end;
$$;

create or replace function public.admin_get_dashboard_expenses()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_subscription_admin() then
    raise exception 'Only an approved administrator can view platform expense totals';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'month', to_char(monthly.expense_month, 'YYYY-MM'),
          'amount', monthly.amount
        )
        order by monthly.expense_month
      )
      from (
        select date_trunc('month', expense.expense_date)::date as expense_month,
               sum(expense.amount) as amount
        from public.admin_operating_expenses as expense
        group by date_trunc('month', expense.expense_date)::date
      ) as monthly
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.admin_get_operating_expenses() from public, anon;
revoke all on function public.admin_add_operating_expense(date, text, text, numeric, text) from public, anon;
revoke all on function public.admin_get_dashboard_expenses() from public, anon;
grant execute on function public.admin_get_operating_expenses() to authenticated;
grant execute on function public.admin_add_operating_expense(date, text, text, numeric, text) to authenticated;
grant execute on function public.admin_get_dashboard_expenses() to authenticated;
