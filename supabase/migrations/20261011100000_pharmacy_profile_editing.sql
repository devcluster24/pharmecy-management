create or replace function public.update_my_pharmacy_profile(
  requested_full_name text,
  requested_phone text,
  requested_photo_url text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_full_name text := trim(coalesce(requested_full_name, ''));
  normalized_phone text := trim(coalesce(requested_phone, ''));
begin
  if current_user_id is null then
    raise exception 'Sign in before updating your profile';
  end if;

  if normalized_full_name = '' or length(normalized_full_name) > 120 then
    raise exception 'Full name must contain between 1 and 120 characters';
  end if;

  if length(normalized_phone) > 32 then
    raise exception 'Phone number cannot exceed 32 characters';
  end if;

  if requested_photo_url is not null and (
    length(requested_photo_url) > 2048
    or requested_photo_url !~ (
      '^https?://[^/]+/storage/v1/object/public/user-profile-photos/'
      || current_user_id::text
      || '/[A-Za-z0-9._-]+(\?v=[0-9]+)?$'
    )
  ) then
    raise exception 'Invalid profile photo URL';
  end if;

  update public.user_profiles
  set full_name = normalized_full_name,
      phone = normalized_phone,
      updated_at = now()
  where id = current_user_id;

  if not found then
    raise exception 'Your account profile could not be found';
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('full_name', normalized_full_name)
    || case
      when requested_photo_url is null then '{}'::jsonb
      else jsonb_build_object(
        'avatar_url', requested_photo_url,
        'profile_photo_url', requested_photo_url
      )
    end
  where id = current_user_id;
end;
$$;

revoke all on function public.update_my_pharmacy_profile(text, text, text) from public, anon;
grant execute on function public.update_my_pharmacy_profile(text, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-profile-photos',
  'user-profile-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists user_profile_photos_public_read on storage.objects;
create policy user_profile_photos_public_read
on storage.objects
for select to anon, authenticated
using (bucket_id = 'user-profile-photos');

drop policy if exists user_profile_photos_owner_insert on storage.objects;
create policy user_profile_photos_owner_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'user-profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists user_profile_photos_owner_update on storage.objects;
create policy user_profile_photos_owner_update
on storage.objects
for update to authenticated
using (
  bucket_id = 'user-profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'user-profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists user_profile_photos_owner_delete on storage.objects;
create policy user_profile_photos_owner_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'user-profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
