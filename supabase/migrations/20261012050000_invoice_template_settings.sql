alter table public.pharmacy_app_data
  drop constraint if exists pharmacy_app_data_data_key_check;

alter table public.pharmacy_app_data
  add constraint pharmacy_app_data_data_key_check check (
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
      'pharmecy-invoice-templates-v1',
      'pharmecy-supplier-status-v1',
      'pharmecy-supplier-due-adjustments-v1',
      'pharmecy-supplier-due-payments-v1'
    )
  );

create or replace function public.pharmacy_data_page(requested_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case requested_key
    when 'pharmecy-sales-list-v1' then 'sales'
    when 'pharmecy-purchase-list-v1' then 'purchase'
    when 'pharmecy-place-order-list-v1' then 'purchase'
    when 'pharmecy-expenses-v1' then 'expenses'
    when 'pharmecy-return-records-v1' then 'returns'
    when 'pharmecy-low-stock-threshold-v1' then 'settings'
    when 'pharmecy-payment-methods-v1' then 'settings'
    when 'pharmecy-vat-tax-settings-v1' then 'settings'
    when 'pharmecy-return-deduction-settings-v1' then 'settings'
    when 'pharmecy-invoice-templates-v1' then 'settings'
    when 'pharmecy-supplier-status-v1' then 'suppliers'
    when 'pharmecy-supplier-due-adjustments-v1' then 'suppliers'
    when 'pharmecy-supplier-due-payments-v1' then 'suppliers'
  end;
$$;
