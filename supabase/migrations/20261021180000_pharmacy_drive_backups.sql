create table if not exists public.pharmacy_drive_backup_settings (
  owner_user_id uuid primary key references public.user_profiles(id) on delete cascade,
  drive_folder_id text,
  auto_backup_enabled boolean not null default false,
  interval_days integer not null default 1 check (interval_days between 1 and 3650),
  next_backup_at timestamptz,
  products_exported_at timestamptz,
  backup_lock_until timestamptz,
  oauth_state_hash text,
  oauth_state_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.pharmacy_drive_backup_secrets (
  owner_user_id uuid primary key references public.pharmacy_drive_backup_settings(owner_user_id) on delete cascade,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pharmacy_drive_backup_history (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  details text[] not null default '{}',
  status text not null check (status in ('Success', 'Partial', 'Failed')),
  message text not null default ''
);

create index if not exists pharmacy_drive_backup_history_owner_date_idx
  on public.pharmacy_drive_backup_history (owner_user_id, created_at desc);

alter table public.pharmacy_drive_backup_settings enable row level security;
alter table public.pharmacy_drive_backup_secrets enable row level security;
alter table public.pharmacy_drive_backup_history enable row level security;

drop policy if exists pharmacy_drive_backup_settings_owner_read
  on public.pharmacy_drive_backup_settings;
create policy pharmacy_drive_backup_settings_owner_read
on public.pharmacy_drive_backup_settings
for select to authenticated
using (owner_user_id = (select auth.uid()));

drop policy if exists pharmacy_drive_backup_history_owner_read
  on public.pharmacy_drive_backup_history;
create policy pharmacy_drive_backup_history_owner_read
on public.pharmacy_drive_backup_history
for select to authenticated
using (owner_user_id = (select auth.uid()));

revoke all on public.pharmacy_drive_backup_settings from public, anon, authenticated;
revoke all on public.pharmacy_drive_backup_secrets from public, anon, authenticated;
revoke all on public.pharmacy_drive_backup_history from public, anon, authenticated;
grant select on public.pharmacy_drive_backup_settings to authenticated;
grant select on public.pharmacy_drive_backup_history to authenticated;
grant all on public.pharmacy_drive_backup_settings to service_role;
grant all on public.pharmacy_drive_backup_secrets to service_role;
grant all on public.pharmacy_drive_backup_history to service_role;

create or replace function public.claim_pharmacy_drive_backup(requested_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pharmacy_drive_backup_settings
  set backup_lock_until = now() + interval '30 minutes',
      updated_at = now()
  where owner_user_id = requested_owner_id
    and (backup_lock_until is null or backup_lock_until < now());
  return found;
end;
$$;

create or replace function public.release_pharmacy_drive_backup(requested_owner_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pharmacy_drive_backup_settings
  set backup_lock_until = null,
      updated_at = now()
  where owner_user_id = requested_owner_id;
$$;

revoke all on function public.claim_pharmacy_drive_backup(uuid) from public, anon, authenticated;
revoke all on function public.release_pharmacy_drive_backup(uuid) from public, anon, authenticated;
grant execute on function public.claim_pharmacy_drive_backup(uuid) to service_role;
grant execute on function public.release_pharmacy_drive_backup(uuid) to service_role;
