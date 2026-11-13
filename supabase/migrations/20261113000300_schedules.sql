-- GEO OPTIMIZER AI scheduled measurements: one schedule per project, run by the daily cron. Additive only.

create table if not exists public.geo_app_schedules (
  project_id text primary key references public.geo_app_projects(id) on delete cascade,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  frequency text not null default 'off',
  surfaces jsonb not null default '[]'::jsonb,
  samples integer not null default 1,
  grounded boolean not null default false,
  notify text not null default 'change',
  threshold integer not null default 5,
  next_run_at timestamptz,
  last_run_at timestamptz,
  measurement_id text,
  last_status text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists geo_app_schedules_due_idx on public.geo_app_schedules (next_run_at) where frequency <> 'off';
create index if not exists geo_app_schedules_active_idx on public.geo_app_schedules (measurement_id) where measurement_id is not null;

alter table public.geo_app_schedules enable row level security;
revoke all on public.geo_app_schedules from anon, authenticated;
grant select, insert, update, delete on public.geo_app_schedules to service_role;
drop policy if exists "service role manages geo_app_schedules" on public.geo_app_schedules;
create policy "service role manages geo_app_schedules" on public.geo_app_schedules for all to service_role using (true) with check (true);
