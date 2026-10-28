  create index if not exists pharmacy_catalog_products_purchase_lookup_idx
    on public.pharmacy_catalog_products (owner_user_id, manufacturer, brand, id);
