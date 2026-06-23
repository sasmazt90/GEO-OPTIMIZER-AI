create table if not exists public.geo_app_users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.geo_app_runs (
  id text primary key,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists geo_app_runs_user_created_idx
  on public.geo_app_runs (user_id, created_at desc);

grant select, insert, update, delete on public.geo_app_users to service_role;
grant select, insert, update, delete on public.geo_app_runs to service_role;

alter table public.geo_app_users enable row level security;
alter table public.geo_app_runs enable row level security;

drop policy if exists "service role manages geo app users" on public.geo_app_users;
create policy "service role manages geo app users"
  on public.geo_app_users
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manages geo app runs" on public.geo_app_runs;
create policy "service role manages geo app runs"
  on public.geo_app_runs
  for all
  to service_role
  using (true)
  with check (true);
