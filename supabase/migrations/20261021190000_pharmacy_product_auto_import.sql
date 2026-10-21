alter table public.pharmacy_app_data
  drop constraint if exists pharmacy_app_data_data_key_check;

alter table public.pharmacy_app_data
  add constraint pharmacy_app_data_data_key_check check (
    data_key in (
      'pharmacy-sales-list-v1',
      'pharmacy-purchase-list-v1',
      'pharmacy-place-order-list-v1',
      'pharmacy-expenses-v1',
      'pharmacy-return-records-v1',
      'pharmacy-low-stock-threshold-v1',
      'pharmacy-payment-methods-v1',
      'pharmacy-vat-tax-settings-v1',
      'pharmacy-return-deduction-settings-v1',
      'pharmacy-invoice-templates-v1',
      'pharmacy-supplier-status-v1',
      'pharmacy-supplier-due-adjustments-v1',
      'pharmacy-supplier-due-payments-v1',
      'pharmacy-product-auto-sync-v1'
    )
  );

create or replace function public.pharmacy_data_page(requested_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case requested_key
    when 'pharmacy-sales-list-v1' then 'sales'
    when 'pharmacy-purchase-list-v1' then 'purchase'
    when 'pharmacy-place-order-list-v1' then 'purchase'
    when 'pharmacy-expenses-v1' then 'expenses'
    when 'pharmacy-return-records-v1' then 'returns'
    when 'pharmacy-low-stock-threshold-v1' then 'settings'
    when 'pharmacy-payment-methods-v1' then 'settings'
    when 'pharmacy-vat-tax-settings-v1' then 'settings'
    when 'pharmacy-return-deduction-settings-v1' then 'settings'
    when 'pharmacy-invoice-templates-v1' then 'settings'
    when 'pharmacy-product-auto-sync-v1' then 'product-management'
    when 'pharmacy-supplier-status-v1' then 'suppliers'
    when 'pharmacy-supplier-due-adjustments-v1' then 'suppliers'
    when 'pharmacy-supplier-due-payments-v1' then 'suppliers'
  end;
$$;
