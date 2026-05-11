-- =============================================================
-- GNC Map — Schéma de base de données Supabase
-- Copiez-collez ce fichier dans l'éditeur SQL de Supabase
-- =============================================================

-- Extension UUID (normalement déjà activée)
create extension if not exists "uuid-ossp";

-- =============================================================
-- TABLES
-- =============================================================

-- Profils des commerciaux (liés aux utilisateurs Supabase Auth)
create table public.profiles (
  id          uuid references auth.users on delete cascade primary key,
  name        text not null,
  created_at  timestamptz default now()
);

-- Sites : sièges sociaux et chantiers
create table public.sites (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  name        text not null,
  company     text,
  type        text not null check (type in ('siege', 'chantier')),
  status      text not null default 'prospect'
              check (status in ('prospect', 'client', 'en_cours', 'termine')),
  lat         double precision not null,
  lng         double precision not null,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Photos associées aux sites
create table public.photos (
  id          uuid default gen_random_uuid() primary key,
  site_id     uuid references public.sites(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) not null,
  url         text not null,
  created_at  timestamptz default now()
);

-- Rapports de visite
create table public.reports (
  id          uuid default gen_random_uuid() primary key,
  site_id     uuid references public.sites(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) not null,
  content     text not null,
  created_at  timestamptz default now()
);

-- =============================================================
-- TRIGGER : création automatique du profil à l'inscription
-- =============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =============================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================

alter table public.profiles enable row level security;
alter table public.sites    enable row level security;
alter table public.photos   enable row level security;
alter table public.reports  enable row level security;

-- Profils : tous les connectés peuvent voir, chacun modifie le sien
create policy "profiles_select" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id);

-- Sites : tout le monde voit, on insère/modifie/supprime le sien
create policy "sites_select" on public.sites
  for select using (auth.role() = 'authenticated');

create policy "sites_insert" on public.sites
  for insert with check (auth.uid() = user_id);

create policy "sites_update" on public.sites
  for update using (auth.uid() = user_id);

create policy "sites_delete" on public.sites
  for delete using (auth.uid() = user_id);

-- Photos
create policy "photos_select" on public.photos
  for select using (auth.role() = 'authenticated');

create policy "photos_insert" on public.photos
  for insert with check (auth.uid() = user_id);

create policy "photos_delete" on public.photos
  for delete using (auth.uid() = user_id);

-- Rapports
create policy "reports_select" on public.reports
  for select using (auth.role() = 'authenticated');

create policy "reports_insert" on public.reports
  for insert with check (auth.uid() = user_id);

create policy "reports_update" on public.reports
  for update using (auth.uid() = user_id);

create policy "reports_delete" on public.reports
  for delete using (auth.uid() = user_id);

-- =============================================================
-- STORAGE : bucket pour les photos
-- =============================================================

insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', true)
on conflict do nothing;

create policy "storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'site-photos' and auth.role() = 'authenticated'
  );

create policy "storage_select" on storage.objects
  for select using (bucket_id = 'site-photos');

create policy "storage_delete" on storage.objects
  for delete using (
    bucket_id = 'site-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- =============================================================
-- REALTIME : activer les tables pour la synchronisation live
-- =============================================================

alter publication supabase_realtime add table public.sites;
alter publication supabase_realtime add table public.photos;
alter publication supabase_realtime add table public.reports;
