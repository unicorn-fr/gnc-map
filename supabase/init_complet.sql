-- =============================================================
-- GNC Map — Script d'initialisation complet
-- À copier-coller dans l'éditeur SQL de Supabase et exécuter
-- =============================================================

-- Extension UUID
create extension if not exists "uuid-ossp";

-- ── Tables ────────────────────────────────────────────────────

create table if not exists public.commercials (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  color      text not null default '#2563EB',
  created_at timestamptz default now()
);

create table if not exists public.import_logs (
  id         uuid default gen_random_uuid() primary key,
  filename   text,
  total      int  default 0,
  inserted   int  default 0,
  updated    int  default 0,
  skipped    int  default 0,
  created_at timestamptz default now()
);

create table if not exists public.sites (
  id            uuid default gen_random_uuid() primary key,
  commercial_id uuid references public.commercials(id) on delete cascade not null,
  name          text not null,
  company       text,
  type          text not null default 'chantier'
                check (type in ('siege', 'chantier')),
  status        text not null default 'prospect'
                check (status in ('prospect', 'client', 'en_cours', 'termine')),
  lat           double precision,
  lng           double precision,
  address       text,
  postcode      text,
  city          text,
  phone         text,
  email         text,
  notes         text,
  external_id   text,
  import_log_id uuid references public.import_logs(id) on delete set null,
  deleted       boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists sites_external_id_idx on public.sites (external_id)
  where external_id is not null;

create table if not exists public.photos (
  id            uuid default gen_random_uuid() primary key,
  site_id       uuid references public.sites(id) on delete cascade not null,
  commercial_id uuid references public.commercials(id) not null,
  url           text not null,
  created_at    timestamptz default now()
);

create table if not exists public.reports (
  id            uuid default gen_random_uuid() primary key,
  site_id       uuid references public.sites(id) on delete cascade not null,
  commercial_id uuid references public.commercials(id) not null,
  content       text not null,
  created_at    timestamptz default now()
);

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  endpoint      text unique not null,
  auth          text not null,
  p256dh        text not null,
  commercial_id uuid references public.commercials(id) on delete set null,
  created_at    timestamptz default now()
);

create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  commercial_id uuid unique references public.commercials(id) on delete cascade,
  token         text not null,
  last_seen     timestamptz not null default now(),
  created_at    timestamptz default now()
);

-- ── Commerciaux ───────────────────────────────────────────────
-- UUIDs fixes : doivent correspondre exactement à ceux dans src/lib/commercials.js

insert into public.commercials (id, name, color)
values
  ('c1000000-0000-0000-0000-000000000001', 'Cédric',   '#2563EB'),
  ('c1000000-0000-0000-0000-000000000002', 'Enzo',     '#16A34A'),
  ('c1000000-0000-0000-0000-000000000003', 'Laëtitia', '#D97706')
on conflict (id) do update set name = excluded.name, color = excluded.color;

-- ── Accès sans authentification ───────────────────────────────

alter table public.commercials       disable row level security;
alter table public.sites             disable row level security;
alter table public.photos            disable row level security;
alter table public.reports           disable row level security;
alter table public.import_logs       disable row level security;

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_sub_all" on public.push_subscriptions;
create policy "push_sub_all" on public.push_subscriptions
  for all using (true) with check (true);

alter table public.sessions enable row level security;
drop policy if exists "sessions_all" on public.sessions;
create policy "sessions_all" on public.sessions
  for all using (true) with check (true);

grant usage  on schema public to anon;
grant all    on all tables    in schema public to anon;
grant all    on all sequences in schema public to anon;

-- ── Storage photos ────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', true)
on conflict do nothing;

drop policy if exists "storage_insert_anon" on storage.objects;
drop policy if exists "storage_select_anon" on storage.objects;
drop policy if exists "storage_delete_anon" on storage.objects;

create policy "storage_insert_anon" on storage.objects
  for insert with check (bucket_id = 'site-photos');
create policy "storage_select_anon" on storage.objects
  for select using (bucket_id = 'site-photos');
create policy "storage_delete_anon" on storage.objects
  for delete using (bucket_id = 'site-photos');

-- ── Realtime ──────────────────────────────────────────────────

alter publication supabase_realtime add table public.sites;
alter publication supabase_realtime add table public.photos;
alter publication supabase_realtime add table public.reports;
alter publication supabase_realtime add table public.import_logs;
