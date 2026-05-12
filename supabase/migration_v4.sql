-- Migration v4 : Sessions exclusives (un seul appareil par commercial)
-- À exécuter dans l'éditeur SQL de Supabase

create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  commercial_id uuid unique references public.commercials(id) on delete cascade,
  token         text not null,
  last_seen     timestamptz not null default now(),
  created_at    timestamptz default now()
);

-- Accès public (pas d'auth Supabase, juste le token comme preuve)
alter table public.sessions enable row level security;
create policy "sessions_all" on public.sessions
  for all using (true) with check (true);

-- Nettoyage automatique des sessions expirées (> 10 minutes) via pg_cron si disponible
-- Sinon, les sessions sont simplement ignorées si last_seen > 3 minutes dans le code
