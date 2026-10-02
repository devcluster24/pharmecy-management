create or replace function public.normalize_catalog_product_identity(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(
    regexp_replace(
      normalize(coalesce(value, ''), NFKC),
      '[[:space:][:punct:]]+',
      '',
      'g'
    )
  );
$$;

revoke all on function public.normalize_catalog_product_identity(text) from public, anon;
grant execute on function public.normalize_catalog_product_identity(text) to authenticated;

create index if not exists pharmacy_catalog_products_identity_lookup_idx
  on public.pharmacy_catalog_products (
    owner_user_id,
    public.normalize_catalog_product_identity(medicine_name),
    public.normalize_catalog_product_identity(strength),
    public.normalize_catalog_product_identity(dosage_form),
    public.normalize_catalog_product_identity(manufacturer)
  );

create or replace function public.get_admin_catalog_manufacturers()
returns table (pharmaceutical_company text, product_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with catalog_rows as materialized (
    select
      c.id,
      btrim(c.pharmaceutical_company) as company,
      lower(btrim(c.pharmaceutical_company)) as company_key,
      public.normalize_catalog_product_identity(
        case when c.brand_name <> '-' then c.brand_name else c.generic_name end
      ) as name_key,
      public.normalize_catalog_product_identity(c.strength) as strength_key,
      public.normalize_catalog_product_identity(c.dosage_form_description) as dosage_form_key,
      public.normalize_catalog_product_identity(c.pharmaceutical_company) as company_identity_key
    from public.admin_medicine_catalog as c
    where btrim(c.pharmaceutical_company) <> ''
      and btrim(c.pharmaceutical_company) <> '-'
  ),
  new_products as (
    select distinct on (
      c.company_key,
      c.name_key,
      c.strength_key,
      c.dosage_form_key,
      c.company_identity_key
    )
      c.company,
      c.company_key,
      c.name_key,
      c.strength_key,
      c.dosage_form_key,
      c.company_identity_key
    from catalog_rows as c
    where not exists (
      select 1
      from public.pharmacy_catalog_products as p
      where p.owner_user_id = (select auth.uid())
        and p.source_catalog_id = c.id
    )
    and not exists (
      select 1
      from public.pharmacy_catalog_products as p
      where p.owner_user_id = (select auth.uid())
        and public.normalize_catalog_product_identity(p.medicine_name) = c.name_key
        and public.normalize_catalog_product_identity(p.strength) = c.strength_key
        and public.normalize_catalog_product_identity(p.dosage_form) = c.dosage_form_key
        and public.normalize_catalog_product_identity(p.manufacturer) = c.company_identity_key
    )
    order by
      c.company_key,
      c.name_key,
      c.strength_key,
      c.dosage_form_key,
      c.company_identity_key,
      c.id
  )
  select min(company)::text, count(*)::bigint
  from new_products
  group by company_key
  order by company_key;
$$;

revoke all on function public.get_admin_catalog_manufacturers() from public, anon;
grant execute on function public.get_admin_catalog_manufacturers() to authenticated;
