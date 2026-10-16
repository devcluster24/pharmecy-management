do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pharmacy_app_data'
  ) then
    alter publication supabase_realtime
      add table public.pharmacy_app_data;
  end if;
end
$$;
