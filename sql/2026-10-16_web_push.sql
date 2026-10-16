-- Notifications sur ordinateur (Mac : board ajouté au Dock depuis Safari, ou installé depuis
-- Chrome/Edge) : un abonnement Web Push par navigateur, activé dans Paramètres > Notifications.
-- Lu par src/lib/push/webPush.ts, appelé par sendPush en plus des téléphones (fcm_tokens).
-- Appliquée à la main sur le projet Supabase partagé.

create table if not exists public.web_push_subscriptions (
  endpoint text primary key,            -- adresse du service push du navigateur (unique par navigateur)
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists web_push_subscriptions_user_id_idx on public.web_push_subscriptions (user_id);

-- Lue et écrite seulement par le serveur (aucun accès depuis le navigateur).
alter table public.web_push_subscriptions enable row level security;
