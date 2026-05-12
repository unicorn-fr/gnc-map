-- =============================================================
-- GNC Map — Migration v2
-- À exécuter dans l'éditeur SQL de Supabase si vous avez déjà
-- installé la version précédente du schéma.
-- =============================================================

-- 1. Suppression douce (soft delete) sur les sites
alter table public.sites
  add column if not exists deleted boolean default false;

-- 2. Lien vers l'import source (pour pouvoir supprimer un import et ses sites)
alter table public.sites
  add column if not exists import_log_id uuid;

alter table public.sites
  drop constraint if exists sites_import_log_id_fkey;

alter table public.sites
  add constraint sites_import_log_id_fkey
  foreign key (import_log_id) references public.import_logs(id) on delete set null;

-- 3. Realtime sur les logs d'import
alter publication supabase_realtime add table public.import_logs;
