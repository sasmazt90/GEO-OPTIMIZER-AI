-- GEO OPTIMIZER AI SEO suite: Search Console connections, tracked keywords,
-- full-site crawls and audit history. Additive only.

create table if not exists public.geo_app_gsc_connections (
  user_id text primary key references public.geo_app_users(id) on delete cascade,
  google_email text not null default '',
  refresh_token text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.geo_app_keywords (
  id text primary key,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  site_url text not null,
  query text not null,
  created_at timestamptz not null default now(),
  unique (user_id, site_url, query)
);
create index if not exists geo_app_keywords_site_idx on public.geo_app_keywords (user_id, site_url, created_at);

create table if not exists public.geo_app_crawls (
  id text primary key,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  start_url text not null,
  host text not null,
  status text not null default 'running',
  config jsonb not null default '{}'::jsonb,
  summary jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists geo_app_crawls_user_idx on public.geo_app_crawls (user_id, created_at desc);

create table if not exists public.geo_app_crawl_pages (
  id text primary key,
  crawl_id text not null references public.geo_app_crawls(id) on delete cascade,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  url text not null,
  depth integer not null default 0,
  source text not null default 'link',
  found_on text not null default '',
  linked boolean not null default false,
  status text not null default 'pending',
  claimed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (crawl_id, url)
);
create index if not exists geo_app_crawl_pages_status_idx on public.geo_app_crawl_pages (crawl_id, status);

create table if not exists public.geo_app_audits (
  id text primary key,
  user_id text not null references public.geo_app_users(id) on delete cascade,
  url text not null,
  host text not null,
  score integer not null default 0,
  counts jsonb not null default '{}'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  rendered boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists geo_app_audits_user_idx on public.geo_app_audits (user_id, host, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['geo_app_gsc_connections', 'geo_app_keywords', 'geo_app_crawls', 'geo_app_crawl_pages', 'geo_app_audits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('drop policy if exists "service role manages %s" on public.%I', t, t);
    execute format('create policy "service role manages %s" on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;
