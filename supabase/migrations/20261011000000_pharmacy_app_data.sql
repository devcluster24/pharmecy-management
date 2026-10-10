create table if not exists public.pharmacy_app_data (
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  data_key text not null check (
    data_key in (
      'pharmecy-sales-list-v1',
      'pharmecy-purchase-list-v1',
      'pharmecy-place-order-list-v1',
      'pharmecy-expenses-v1',
      'pharmecy-return-records-v1',
      'pharmecy-low-stock-threshold-v1',
      'pharmecy-payment-methods-v1',
      'pharmecy-vat-tax-settings-v1',
      'pharmecy-return-deduction-settings-v1',
      'pharmecy-supplier-status-v1',
      'pharmecy-supplier-due-adjustments-v1',
      'pharmecy-supplier-due-payments-v1'
    )
  ),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, data_key)
);

alter table public.pharmacy_app_data enable row level security;

drop policy if exists pharmacy_app_data_owner_access
  on public.pharmacy_app_data;
create policy pharmacy_app_data_owner_access
on public.pharmacy_app_data
for all to authenticated
using (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
)
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);

grant select, insert, update, delete on public.pharmacy_app_data
  to authenticated;
