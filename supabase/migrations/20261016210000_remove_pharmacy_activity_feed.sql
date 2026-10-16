drop trigger if exists pharmacy_app_data_activity_audit
  on public.pharmacy_app_data;

drop trigger if exists pharmacy_catalog_product_activity_audit
  on public.pharmacy_catalog_products;

drop function if exists public.audit_pharmacy_app_data_activity();
drop function if exists public.audit_pharmacy_catalog_product_activity();
drop function if exists public.record_pharmacy_staff_login_activity();
drop function if exists public.refresh_pharmacy_stock_activity();
drop function if exists public.record_pharmacy_inventory_alerts(uuid, uuid, jsonb, numeric);

drop policy if exists pharmacy_activity_feed_owner_read
  on public.pharmacy_activity_feed;

revoke all on public.pharmacy_activity_feed from anon, authenticated;
