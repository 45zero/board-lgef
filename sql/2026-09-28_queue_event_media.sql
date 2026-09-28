-- Centre de publication : toute photo/vidéo ajoutée à un événement rejoint la file « À publier »,
-- quelle que soit l'appli qui l'envoie (board ou calendrier). Jusqu'ici la mise en file était faite
-- côté navigateur par le board seul (useEventFiles) : les envois du calendrier n'y arrivaient pas.
-- Appliquée à la main sur le projet Supabase partagé.
--
-- security definer : l'insertion ne dépend pas des policies de media_publications de l'appli
-- appelante. On ne crée rien si le fichier appartient déjà à une publication.

create or replace function public.queue_event_media_for_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists queue_event_media_for_publication_trigger on public.event_files;
create trigger queue_event_media_for_publication_trigger
  after insert on public.event_files
  for each row execute function public.queue_event_media_for_publication();
