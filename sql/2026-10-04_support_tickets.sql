-- Centre d'aide : « Signaler un problème » depuis le board (ordinateur et mobile).
-- Texte + photos / captures, contexte technique capté automatiquement (page, appareil, version,
-- dernières erreurs). Les tickets sont lus et traités depuis Claude Code (scripts/support-tickets.mjs).
-- Photos dans un bucket PRIVÉ « support » : déposées et lues par URL signée côté serveur.
-- Appliquée à la main sur le projet Supabase partagé.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  message text not null check (length(message) between 3 and 5000),
  -- Module ouvert au moment du signalement (calendrier, frais…).
  app text,
  -- Page, appareil, taille d'écran, version déployée, dernières erreurs du navigateur.
  context jsonb not null default '{}'::jsonb,
  -- Chemins dans le bucket « support ».
  attachments text[] not null default '{}',
  status text not null default 'nouveau' check (status in ('nouveau', 'en_cours', 'regle', 'sans_suite')),
  -- Réponse visible par l'auteur (ce qui a été corrigé).
  resolution text,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index if not exists support_tickets_author_idx on public.support_tickets (created_by, created_at desc);

alter table public.support_tickets enable row level security;

-- Chacun voit ses signalements ; admins et super users voient tout. Écritures par les server
-- actions (service role) uniquement.
drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select using (
  created_by = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'super_user'))
);

-- Notifications du circuit : nouveau ticket (super users), ticket réglé (auteur).
alter type public.notification_type add value if not exists 'support_ticket';
alter type public.notification_type add value if not exists 'support_resolved';

-- Bucket privé, 10 Mo par fichier, images seulement (aucune policy : accès via service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support', 'support', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
on conflict (id) do nothing;
