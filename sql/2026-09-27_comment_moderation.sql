-- Modération des commentaires par Claude (centre de publication du board).
--
-- - media_publications.published_by : qui a cliqué « Publier » (prévenu en cas de commentaire haineux).
-- - comment_moderation : chaque commentaire lu sur Facebook/Instagram/YouTube n'est analysé qu'une
--   fois (unique network + comment_id) ; verdict de Claude, action faite (masqué…), alertes envoyées.
-- - board_settings.moderation_recipient_ids : personnes choisies en plus (admins et auteur de la
--   publication sont toujours prévenus).
-- - profiles.hate_alert_email / hate_alert_push : canaux choisis par chacun dans ses paramètres.
-- - notification_type 'hateful_comment' : alerte dans la cloche / push de l'app.

begin;

alter table public.media_publications add column if not exists published_by uuid references public.profiles(id) on delete set null;

create table if not exists public.comment_moderation (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.media_publications(id) on delete cascade,
  network text not null,
  comment_id text not null,
  author text,
  text text,
  commented_at timestamptz,
  verdict text not null check (verdict in ('ok', 'hateful', 'review')),
  severity text check (severity in ('low', 'medium', 'high')),
  categories text[] not null default '{}',
  reason text,
  action text not null default 'none' check (action in ('none', 'hidden', 'unhidden', 'deleted', 'hide_failed')),
  action_error text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (network, comment_id)
);

create index if not exists comment_moderation_publication_idx on public.comment_moderation (publication_id);
create index if not exists comment_moderation_flagged_idx on public.comment_moderation (verdict) where verdict <> 'ok';

alter table public.comment_moderation enable row level security;
drop policy if exists comment_moderation_select on public.comment_moderation;
create policy comment_moderation_select on public.comment_moderation for select using (auth.uid() is not null);
drop policy if exists comment_moderation_update on public.comment_moderation;
create policy comment_moderation_update on public.comment_moderation for update using (auth.uid() is not null) with check (auth.uid() is not null);

alter table public.board_settings add column if not exists moderation_recipient_ids uuid[] not null default '{}';

alter table public.profiles add column if not exists hate_alert_email boolean not null default true;
alter table public.profiles add column if not exists hate_alert_push boolean not null default true;

commit;

-- Hors transaction (ALTER TYPE … ADD VALUE ne peut pas être utilisé dans la même transaction).
alter type public.notification_type add value if not exists 'hateful_comment';
