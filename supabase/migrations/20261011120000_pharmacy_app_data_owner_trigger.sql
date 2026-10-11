create or replace function public.enforce_pharmacy_staff_data_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  page_name text := public.pharmacy_data_page(old.data_key);
  is_staff boolean := (
    select public.pharmacy_staff_owner_id((select auth.uid())) = old.owner_user_id
  );
begin
  if is_staff is distinct from true then
    return new;
  end if;

  if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'view') then
    raise exception 'Staff access denied: view permission is required for this page';
  end if;

  if old.payload = new.payload then
    return new;
  end if;

  if new.payload @> old.payload then
    if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'create') then
      raise exception 'Staff access denied: create permission is required for this page';
    end if;
    return new;
  end if;

  if old.payload @> new.payload then
    if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'delete') then
      raise exception 'Staff access denied: delete permission is required for this page';
    end if;
    return new;
  end if;

  if not public.pharmacy_staff_has_permission(old.owner_user_id, page_name, 'edit') then
    raise exception 'Staff access denied: edit permission is required for this page';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_pharmacy_staff_data_action() from public, anon;
