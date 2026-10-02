create or replace function public.get_admin_catalog_manufacturers()
returns table (pharmaceutical_company text, product_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    min(btrim(c.pharmaceutical_company))::text,
    count(*)::bigint
  from public.admin_medicine_catalog as c
  where btrim(c.pharmaceutical_company) <> ''
    and btrim(c.pharmaceutical_company) <> '-'
    and not exists (
      select 1
      from public.pharmacy_catalog_products as p
      where p.owner_user_id = (select auth.uid())
        and (
          p.source_catalog_id = c.id
          or (
            lower(regexp_replace(normalize(p.medicine_name, NFKC), '[[:space:][:punct:]]+', '', 'g'))
              = lower(regexp_replace(normalize(case when c.brand_name <> '-' then c.brand_name else c.generic_name end, NFKC), '[[:space:][:punct:]]+', '', 'g'))
            and lower(regexp_replace(normalize(p.strength, NFKC), '[[:space:][:punct:]]+', '', 'g'))
              = lower(regexp_replace(normalize(c.strength, NFKC), '[[:space:][:punct:]]+', '', 'g'))
            and lower(regexp_replace(normalize(p.dosage_form, NFKC), '[[:space:][:punct:]]+', '', 'g'))
              = lower(regexp_replace(normalize(c.dosage_form_description, NFKC), '[[:space:][:punct:]]+', '', 'g'))
            and lower(regexp_replace(normalize(p.manufacturer, NFKC), '[[:space:][:punct:]]+', '', 'g'))
              = lower(regexp_replace(normalize(c.pharmaceutical_company, NFKC), '[[:space:][:punct:]]+', '', 'g'))
          )
        )
    )
  group by lower(btrim(c.pharmaceutical_company))
  order by lower(btrim(c.pharmaceutical_company));
$$;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'pharmacy_catalog_products'
    ) then
      alter publication supabase_realtime
        add table public.pharmacy_catalog_products;
    end if;
  end if;
end
$$;
