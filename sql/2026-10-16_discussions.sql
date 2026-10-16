-- Discussions des événements (bulle « Discussions » et onglet Discussion de la fiche) :
-- - pièces jointes et messages vocaux d'un message (fichiers dans le bucket event-files,
--   dossier discussions/<event_id>/) ;
-- - archivage d'une discussion, propre à chaque personne (elle réapparaît au message suivant).
-- Lecture et écriture uniquement par les actions serveur (service role) après contrôle de l'accès
-- à l'événement : RLS activée sans politique pour les rôles anon / authenticated.
-- Tables existantes non modifiées (likes : event_comment_reactions ; réponses : event_comments.parent_id).

create table if not exists public.event_comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.event_comments(id) on delete cascade,
  path text not null,
  filename text not null,
  content_type text,
  size_bytes bigint,
  kind text not null default 'file' check (kind in ('file', 'image', 'audio')),
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists event_comment_attachments_comment_idx on public.event_comment_attachments (comment_id);
alter table public.event_comment_attachments enable row level security;

create table if not exists public.event_discussion_archives (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.event_discussion_archives enable row level security;
