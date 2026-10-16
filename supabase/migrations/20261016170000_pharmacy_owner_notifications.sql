create table if not exists public.pharmacy_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

insert into public.pharmacy_notifications (user_id, title, body)
select
  profile.id,
  'Welcome to Pharmacy Cluster',
  'Your pharmacy workspace is ready to get started.'
from public.user_profiles as profile
where profile.role = 'pharmacy_user'
  and not exists (
    select 1
    from public.pharmacy_notifications as notification
    where notification.user_id = profile.id
      and notification.title = 'Welcome to Pharmacy Cluster'
  );

create index if not exists pharmacy_notifications_user_created_idx
  on public.pharmacy_notifications (user_id, created_at desc);

alter table public.pharmacy_notifications enable row level security;
revoke all on public.pharmacy_notifications from anon, authenticated;

grant select on public.pharmacy_notifications to authenticated;
grant update (read_at) on public.pharmacy_notifications to authenticated;

drop policy if exists pharmacy_notifications_owner_read
  on public.pharmacy_notifications;
create policy pharmacy_notifications_owner_read
on public.pharmacy_notifications
for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);

drop policy if exists pharmacy_notifications_owner_update
  on public.pharmacy_notifications;
create policy pharmacy_notifications_owner_update
on public.pharmacy_notifications
for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'pharmacy_user'
      and profile.approval_status = 'approved'
  )
);

create or replace function public.create_pharmacy_owner_welcome_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'pharmacy_user' then
    insert into public.pharmacy_notifications (user_id, title, body)
    values (
      new.id,
      'Welcome to Pharmacy Cluster',
      'Your pharmacy workspace is ready to get started.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists pharmacy_owner_welcome_notification
  on public.user_profiles;
create trigger pharmacy_owner_welcome_notification
after insert on public.user_profiles
for each row
execute function public.create_pharmacy_owner_welcome_notification();
