-- =============================================================
-- GNC Map v2 — Schéma SANS authentification
-- Accès direct, sélection du commercial par clic
-- Copiez-collez dans l'éditeur SQL de Supabase et exécutez
-- =============================================================

-- Extension UUID
create extension if not exists "uuid-ossp";

-- =============================================================
-- TABLES
-- =============================================================

-- Commerciaux (pas de mot de passe, juste des profils)
create table public.commercials (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  color      text not null default '#2563EB',
  created_at timestamptz default now()
);

-- Insérer les 3 commerciaux par défaut (modifiez les noms !)
insert into public.commercials (name, color) values
  ('Commercial 1', '#2563EB'),
  ('Commercial 2', '#16A34A'),
  ('Alternant',    '#D97706');

-- Sites : sièges sociaux et chantiers
create table public.sites (
  id            uuid default gen_random_uuid() primary key,
  commercial_id uuid references public.commercials(id) on delete cascade not null,
  name          text not null,
  company       text,
  type          text not null default 'chantier'
                check (type in ('siege', 'chantier')),
  status        text not null default 'prospect'
                check (status in ('prospect', 'client', 'en_cours', 'termine')),
  lat           double precision,          -- nullable (peut ne pas être géocodé)
  lng           double precision,
  address       text,
  postcode      text,
  city          text,
  phone         text,
  email         text,
  notes         text,
  external_id   text,                      -- ID unique pour les imports/MAJ Excel
  import_log_id uuid,                      -- lien vers l'import source (nullable)
  deleted       boolean default false,     -- suppression douce
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Index pour accélérer la déduplication lors des imports
create index sites_external_id_idx on public.sites (external_id)
  where external_id is not null;

-- Photos associées aux sites
create table public.photos (
  id            uuid default gen_random_uuid() primary key,
  site_id       uuid references public.sites(id) on delete cascade not null,
  commercial_id uuid references public.commercials(id) not null,
  url           text not null,
  created_at    timestamptz default now()
);

-- Rapports de visite
create table public.reports (
  id            uuid default gen_random_uuid() primary key,
  site_id       uuid references public.sites(id) on delete cascade not null,
  commercial_id uuid references public.commercials(id) not null,
  content       text not null,
  created_at    timestamptz default now()
);

-- Journal des imports Excel
create table public.import_logs (
  id         uuid default gen_random_uuid() primary key,
  filename   text,
  total      int  default 0,
  inserted   int  default 0,
  updated    int  default 0,
  skipped    int  default 0,
  created_at timestamptz default now()
);

-- Contrainte FK import_log_id (après création de import_logs)
alter table public.sites
  add constraint sites_import_log_id_fkey
  foreign key (import_log_id) references public.import_logs(id) on delete set null;

-- =============================================================
-- ACCÈS ANON (pas d'authentification requise)
-- Toutes les tables sont accessibles avec la clé anon
-- =============================================================

-- Désactiver RLS (application interne uniquement)
alter table public.commercials  disable row level security;
alter table public.sites        disable row level security;
alter table public.photos       disable row level security;
alter table public.reports      disable row level security;
alter table public.import_logs  disable row level security;

-- Donner tous les droits à l'utilisateur anon
grant usage  on schema public to anon;
grant all    on all tables    in schema public to anon;
grant all    on all sequences in schema public to anon;

-- =============================================================
-- STORAGE : bucket pour les photos
-- =============================================================

insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', true)
on conflict do nothing;

create policy "storage_insert_anon" on storage.objects
  for insert with check (bucket_id = 'site-photos');

create policy "storage_select_anon" on storage.objects
  for select using (bucket_id = 'site-photos');

create policy "storage_delete_anon" on storage.objects
  for delete using (bucket_id = 'site-photos');

-- =============================================================
-- REALTIME
-- =============================================================

alter publication supabase_realtime add table public.sites;
alter publication supabase_realtime add table public.photos;
alter publication supabase_realtime add table public.reports;
alter publication supabase_realtime add table public.import_logs;
