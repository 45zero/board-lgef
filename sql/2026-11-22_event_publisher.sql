-- Personne chargée de publier les médias d'un événement, choisie sur l'événement même (avant toute
-- vidéo, sans captation acceptée). Ses publications lui sont attribuées par défaut.
--   • events.publisher_id ; par défaut le créateur s'il est dans board_settings.publication_self_assign_creators
--     (Anthony Drouhin), à la création et pour ses événements existants.
--   • publication_default_assignee : publisher_id de l'événement, sinon la règle précédente.
--   • Notification : « Vidéo à publier — Vous avez une vidéo à publier : <événement> » pour la personne attribuée.
-- Ajouts ; seules données remplies : publisher_id des événements d'Anthony qui n'en ont pas, et
-- assigned_to de leurs publications pas encore publiées et sans personne.

begin;

alter table public.events
  add column if not exists publisher_id uuid references public.profiles(id) on delete set null;

-- Par défaut à la création d'un événement.
create or replace function public.event_default_publisher()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.publisher_id is null and new.created_by is not null and exists (
    select 1 from board_settings s where new.created_by = any(s.publication_self_assign_creators)
  ) then
    new.publisher_id := new.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_event_default_publisher on public.events;
create trigger trg_event_default_publisher
  before insert on public.events
  for each row execute function public.event_default_publisher();

-- Événements existants d'Anthony.
update public.events e
set publisher_id = e.created_by
where e.publisher_id is null
  and exists (select 1 from board_settings s where e.created_by = any(s.publication_self_assign_creators));

-- Publications pas encore publiées de ces événements, encore sans personne.
update public.media_publications m
set assigned_to = e.publisher_id
from public.events e
where e.id = m.event_id and m.assigned_to is null and m.status <> 'published' and e.publisher_id is not null;

-- Attribution par défaut d'une nouvelle publication : la personne choisie sur l'événement.
create or replace function public.publication_default_assignee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ev record;
begin
  if new.assigned_to is not null or new.event_id is null then return new; end if;
  select e.publisher_id, e.created_by into ev from events e where e.id = new.event_id;
  if ev.publisher_id is not null then
    new.assigned_to := ev.publisher_id;
  elsif ev.created_by is not null and exists (
    select 1 from board_settings s where ev.created_by = any(s.publication_self_assign_creators)
  ) then
    new.assigned_to := ev.created_by;
  end if;
  return new;
end;
$$;

-- « Vidéo à publier — Vous avez une vidéo à publier : … » (personne attribuée), sinon tous les publicateurs.
create or replace function public.notify_publishers_to_publish()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  label text;
  what text;
begin
  if new.status is distinct from 'to_publish' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'to_publish' then return new; end if;

  select title into label from events where id = new.event_id;
  label := coalesce(label, new.title, 'Publication directe');
  what := case new.kind when 'video' then 'une vidéo' when 'photo' then 'une photo' when 'gallery' then 'des photos' else 'un média' end;

  insert into notifications (user_id, type, title, message, event_id, data)
  select p.id,
         'publication_to_publish',
         case when new.assigned_to is not null
              then case new.kind when 'video' then 'Vidéo à publier' when 'photo' then 'Photo à publier' when 'gallery' then 'Photos à publier' else 'Média à publier' end
              else 'Média à publier' end,
         case when new.assigned_to is not null
              then 'Vous avez ' || what || ' à publier : ' || label || '.'
              else label || ' — de nouveaux médias attendent dans le centre de publication.' end,
         new.event_id,
         jsonb_build_object('publication_id', new.id, 'event_id', new.event_id)
  from profiles p
  where (
      (new.assigned_to is not null and p.id = new.assigned_to)
      or (new.assigned_to is null
          and exists (select 1 from module_access m where m.module_id = 'audiovisuel')
          and public.module_rule_matches(p.id, 'audiovisuel'))
    )
    and p.id is distinct from new.created_by
    and not exists (
      select 1 from notifications n
      where n.user_id = p.id
        and n.type = 'publication_to_publish'
        and n.read is not true
        and n.event_id is not distinct from new.event_id
        -- « Publication attribuée » (choix sur l'événement, sans média) n'empêche pas « Vidéo à publier ».
        and n.data ? 'publication_id'
    );
  return new;
end;
$function$;

commit;
