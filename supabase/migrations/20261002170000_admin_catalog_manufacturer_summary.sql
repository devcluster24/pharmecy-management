create index if not exists admin_medicine_catalog_company_summary_idx
  on public.admin_medicine_catalog (lower(btrim(pharmaceutical_company)))
  where btrim(pharmaceutical_company) <> ''
    and btrim(pharmaceutical_company) <> '-';

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
  group by lower(btrim(c.pharmaceutical_company))
  order by lower(btrim(c.pharmaceutical_company));
$$;

revoke all on function public.get_admin_catalog_manufacturers() from public, anon;
grant execute on function public.get_admin_catalog_manufacturers() to authenticated;
