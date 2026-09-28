-- Centre de publication : un album par événement. Les photos ajoutées à un événement (board ou
-- calendrier) rejoignent l'album « À publier » de cet événement au lieu de créer une publication
-- par photo. Les vidéos restent des publications séparées (Facebook refuse les vidéos dans un
-- album, YouTube n'en prend qu'une). Remplace la fonction de sql/2026-09-28_queue_event_media.sql.
-- Appliquée à la main sur le projet Supabase partagé.
--
-- Album d'un événement = sa plus ancienne publication « À publier » photo/galerie rattachée à
-- l'événement (pas une publication autonome). Une fois l'album programmé ou publié, les photos
-- suivantes ouvrent un nouvel album.

create or replace function public.queue_event_media_for_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  album_id uuid;
begin
  if new.event_id is null
     or coalesce(new.content_type, '') not similar to '(image|video)%' then
    return new;
  end if;

  if exists (
    select 1 from public.media_publications m
    where m.event_file_id = new.id or new.id = any(m.file_ids)
  ) then
    return new;
  end if;

  if new.content_type like 'image%' then
    -- Plusieurs photos envoyées en même temps : un seul album, pas un par transaction concurrente.
    perform pg_advisory_xact_lock(hashtext('event_album:' || new.event_id::text));

    select m.id into album_id
    from public.media_publications m
    where m.event_id = new.event_id
      and m.status = 'to_publish'
      and m.media = '[]'::jsonb
      and m.kind in ('photo', 'gallery')
    order by m.created_at
    limit 1;

    if album_id is not null then
      update public.media_publications
      set file_ids = file_ids || new.id,
          event_file_id = coalesce(event_file_id, new.id),
          kind = case when cardinality(file_ids) >= 1 then 'gallery' else 'photo' end
      where id = album_id;
      return new;
    end if;
  end if;

  insert into public.media_publications (event_file_id, event_id, file_ids, kind, status)
  values (
    new.id,
    new.event_id,
    array[new.id],
    case when new.content_type like 'video%' then 'video' else 'photo' end,
    'to_publish'
  );
  return new;
end;
$$;

-- Photos déjà en attente : les publications « À publier » photo/galerie d'un même événement
-- (sans texte rédigé) sont fusionnées dans la plus ancienne, fichiers dans l'ordre d'envoi.
begin;

create temporary table album_merge on commit drop as
select
  m.event_id,
  (array_agg(m.id order by m.created_at))[1] as keep_id,
  array_agg(m.id order by m.created_at) as pub_ids
from public.media_publications m
where m.event_id is not null
  and m.status = 'to_publish'
  and m.media = '[]'::jsonb
  and m.kind in ('photo', 'gallery')
  and coalesce(m.caption, '') = ''
group by m.event_id
having count(*) > 1;

update public.media_publications m
set file_ids = merged.ids,
    event_file_id = merged.ids[1],
    kind = 'gallery'
from (
  select a.keep_id, array_agg(f.id order by f.created_at, f.filename) as ids
  from album_merge a
  join lateral (
    select distinct unnest(p.file_ids) as fid
    from public.media_publications p
    where p.id = any(a.pub_ids)
  ) u on true
  join public.event_files f on f.id = u.fid
  group by a.keep_id
) merged
where m.id = merged.keep_id;

delete from public.media_publications m
using album_merge a
where m.id = any(a.pub_ids) and m.id <> a.keep_id;

commit;
