create table if not exists public.pharmacy_product_sequences (
  owner_user_id uuid primary key references public.user_profiles(id) on delete cascade,
  next_number bigint not null check (next_number > 0)
);

revoke all on public.pharmacy_product_sequences from public, anon, authenticated;

create or replace function public.reserve_pharmacy_product_identifiers()
returns table (serial_number text, product_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_next_number bigint;
begin
  if v_owner is null or not exists (
    select 1
    from public.user_profiles as profile
    where profile.id = v_owner
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  ) then
    raise exception 'Only an approved pharmacy user can reserve product identifiers.';
  end if;

  insert into public.pharmacy_product_sequences (owner_user_id, next_number)
  values (
    v_owner,
    greatest(
      coalesce((
        select max(((regexp_match(product.id, '^MED-([0-9]+)$'))[1])::bigint)
        from public.pharmacy_catalog_products as product
        where product.owner_user_id = v_owner
      ), 0),
      coalesce((
        select max(((regexp_match(product.serial_number, '^(SL-)?([0-9]+)$'))[2])::bigint)
        from public.pharmacy_catalog_products as product
        where product.owner_user_id = v_owner
      ), 0)
    ) + 1
  )
  on conflict (owner_user_id) do nothing;

  update public.pharmacy_product_sequences as sequence
  set next_number = sequence.next_number + 1
  where sequence.owner_user_id = v_owner
  returning sequence.next_number - 1 into v_next_number;

  return query
  select
    ('SL-' || lpad(v_next_number::text, 4, '0'))::text,
    ('MED-' || lpad(v_next_number::text, 4, '0'))::text;
end;
$$;

revoke all on function public.reserve_pharmacy_product_identifiers() from public, anon;
grant execute on function public.reserve_pharmacy_product_identifiers() to authenticated;
