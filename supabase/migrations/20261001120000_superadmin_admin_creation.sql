create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_email text := lower(coalesce(new.email, ''));
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  registration_type text := coalesce(metadata ->> 'registration_type', 'pharmacy_user');
  new_user_name text := lower(trim(coalesce(metadata ->> 'username', '')));
begin
  if registration_type <> 'pharmacy_user' then
    raise exception 'Admin users must be created by an approved superadmin';
  end if;

  if new_user_name = '' then
    new_user_name := split_part(new_email, '@', 1) || '_' || left(replace(new.id::text, '-', ''), 6);
  end if;

  insert into public.user_profiles (
    id, email, username, full_name, phone, role, approval_status
  ) values (
    new.id,
    new_email,
    new_user_name,
    coalesce(nullif(trim(metadata ->> 'full_name'), ''), split_part(new_email, '@', 1)),
    trim(coalesce(metadata ->> 'phone', '')),
    'pharmacy_user',
    'pending'
  );

  return new;
end;
$$;

drop function if exists public.add_admin_user(text);
drop table if exists public.admin_invites;
