-- GEO OPTIMIZER AI platform v2: plans, billing, monthly usage metering, projects, tracked
-- prompts and measured AI visibility runs. Additive only.

alter table public.geo_app_users add column if not exists plan text not null default 'free';
alter table public.geo_app_users add column if not exists stripe_customer_id text;
alter table public.geo_app_users add column if not exists stripe_subscription_id text;
alter table public.geo_app_users add column if not exists subscription_status text;
alter table public.geo_app_users add column if not exists billing_flag text;
create unique index if not exists geo_app_users_stripe_customer_idx on public.geo_app_users (stripe_customer_id) where stripe_customer_id is not null;

create table if not exists public.geo_app_usage (
  user_id text not null references public.geo_app_users(id) on delete cascade,
  period date not null,
  kind text not null,
  count integer not null default 0,
  primary key (user_id, period, kind)
);

create table if not exists public.geo_app_projects (
  id text primary key,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  name text not null,
  brand text not null,
  aliases jsonb not null default '[]'::jsonb,
  domain text not null default '',
  competitors jsonb not null default '[]'::jsonb,
  country text not null default 'Worldwide',
  language text not null default 'English',
  created_at timestamptz not null default now()
);
create index if not exists geo_app_projects_user_idx on public.geo_app_projects (user_id, created_at);

create table if not exists public.geo_app_prompts (
  id text primary key,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  project_id text not null references public.geo_app_projects(id) on delete cascade,
  text text not null,
  category text not null default 'general',
  created_at timestamptz not null default now()
);
create index if not exists geo_app_prompts_project_idx on public.geo_app_prompts (project_id, created_at);

create table if not exists public.geo_app_measurements (
  id text primary key,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  project_id text not null references public.geo_app_projects(id) on delete cascade,
  status text not null default 'running',
  config jsonb not null default '{}'::jsonb,
  total integer not null default 0,
  summary jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists geo_app_measurements_project_idx on public.geo_app_measurements (project_id, created_at desc);

create table if not exists public.geo_app_samples (
  id text primary key,
  measurement_id text not null references public.geo_app_measurements(id) on delete cascade,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  prompt_id text,
  prompt_text text not null,
  surface text not null,
  sample_index integer not null default 0,
  status text not null default 'pending',
  claimed_at timestamptz,
  answer text,
  citations jsonb not null default '[]'::jsonb,
  model text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists geo_app_samples_measurement_idx on public.geo_app_samples (measurement_id, status);

create or replace function public.geo_app_increment_usage(p_user text, p_period date, p_kind text, p_amount integer)
returns integer
language sql
set search_path = ''
as $$
  insert into public.geo_app_usage (user_id, period, kind, count)
  values (p_user, p_period, p_kind, p_amount)
  on conflict (user_id, period, kind) do update set count = public.geo_app_usage.count + excluded.count
  returning count;
$$;

revoke all on function public.geo_app_increment_usage(text, date, text, integer) from public, anon, authenticated;
grant execute on function public.geo_app_increment_usage(text, date, text, integer) to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['geo_app_usage', 'geo_app_projects', 'geo_app_prompts', 'geo_app_measurements', 'geo_app_samples'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('drop policy if exists "service role manages %s" on public.%I', t, t);
    execute format('create policy "service role manages %s" on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;
