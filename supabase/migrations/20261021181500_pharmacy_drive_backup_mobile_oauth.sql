alter table public.pharmacy_drive_backup_settings
  add column if not exists oauth_return_url text;
