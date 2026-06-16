-- Migration v3 : Push notifications + table subscriptions
-- À exécuter dans l'éditeur SQL de Supabase

-- Table des abonnements push (un par appareil)
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text unique not null,
  auth        text not null,
  p256dh      text not null,
  commercial_id uuid references public.commercials(id) on delete set null,
  created_at  timestamptz default now()
);

-- RLS : tout le monde peut s'inscrire/se mettre à jour
alter table public.push_subscriptions enable row level security;

create policy "push_sub_all" on public.push_subscriptions
  for all using (true) with check (true);

-- Variables d'environnement à configurer dans Supabase :
--   VAPID_PUBLIC_KEY  = BDsKUhkLNBdS8f9sx1kg2RBJHPqFcMdvKLbZyvsCCy49s0vx4NY1ubBx7dvV1aTOw8xOLCZju9iXeBOrA_dl6Gw
--   VAPID_PRIVATE_KEY = 9mNxNi9_0u16ieWQlKSAjdiTLuVZpHIfGPPkysjVJbk
