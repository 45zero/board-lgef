-- Annuaire des Pages Facebook à mentionner dans les publications (fenêtre « Publier » : taper
-- « metz » propose les Pages correspondantes ; un clic ajoute la mention @[id], la Page est notifiée).
-- Meta ne permet pas de chercher une Page par son nom sans « Page Public Metadata Access » : l'annuaire
-- est rempli par le board —
--   * 'tagged'  : Pages qui identifient les Pages LGEF dans leurs publications (/tagged, chaque nuit) ;
--   * 'mention' : Pages mentionnées dans une publication du board ;
--   * 'manual'  : Page ajoutée une fois par son identifiant numérique.
-- Lecture et écriture uniquement par les actions serveur (service role) : RLS sans politique.

create table if not exists public.facebook_pages_directory (
  id text primary key,                 -- identifiant numérique de la Page
  name text not null,
  search text not null,                -- nom en minuscules sans accents (recherche)
  source text not null default 'tagged' check (source in ('tagged', 'mention', 'manual')),
  tag_count integer not null default 0, -- publications où elle identifie la LGEF (classement)
  mention_count integer not null default 0, -- mentions faites depuis le board (classement)
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists facebook_pages_directory_search_idx on public.facebook_pages_directory (search);
alter table public.facebook_pages_directory enable row level security;

-- Mise à jour de l'annuaire chaque nuit (nouvelles Pages qui identifient la LGEF).
-- <CRON_SECRET> remplacé à l'application, comme pour les autres tâches.
select cron.schedule(
  'facebook-directory',
  '35 3 * * *',
  $$
    select net.http_get(
      url     := 'https://board-lgef.vercel.app/api/cron/facebook-directory',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      timeout_milliseconds := 300000
    );
  $$
);
