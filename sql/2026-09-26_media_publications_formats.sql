-- Centre de publication : galeries, posts texte et publications autonomes (sans événement).
-- Appliquée à la main sur le projet Supabase partagé (schéma public, table créée hors Prisma).
--
-- - event_file_id / event_id deviennent facultatifs : une publication créée depuis le centre peut
--   n'appartenir à aucun événement du planning.
-- - kind : video | photo | gallery | text.
-- - file_ids : TOUS les fichiers d'événement de la publication, dans l'ordre (event_file_id = le
--   premier, gardé pour la cascade de suppression et la compatibilité).
-- - media : fichiers d'une publication autonome, stockés sur le Drive du board
--   [{ drive_file_id, filename, content_type, web_view_link }].
-- - title / category : titre et catégorie (event_type) d'une publication autonome.
-- - publish_info : état de publication par réseau (source de vérité ; recopié dans
--   event_files.publish_info quand la publication ne porte que sur un fichier d'événement).

begin;

alter table public.media_publications
  alter column event_file_id drop not null,
  alter column event_id drop not null,
  add column if not exists kind text check (kind in ('video', 'photo', 'gallery', 'text')),
  add column if not exists file_ids uuid[] not null default '{}',
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists title text,
  add column if not exists category text,
  add column if not exists publish_info jsonb;

update public.media_publications m
set
  kind = case when f.content_type like 'video%' then 'video' else 'photo' end,
  file_ids = array[m.event_file_id],
  publish_info = f.publish_info
from public.event_files f
where f.id = m.event_file_id and m.kind is null;

drop policy if exists media_publications_delete on public.media_publications;
create policy media_publications_delete on public.media_publications
  for delete using (auth.uid() is not null);

commit;
